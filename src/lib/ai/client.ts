import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { aiCalls } from "@/lib/db/schema";
import { mockClient } from "./mock";

const MOCK_AI = process.env.MOCK_AI === "1";

// Lazy singleton: instantiating at import time would crash any module that
// transitively imports this file when no API key is present (e.g. UI-only dev).
let realClient: Anthropic | null = null;

function getRealClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required when MOCK_AI is not set");
  }
  if (!realClient) {
    realClient = new Anthropic({ apiKey });
  }
  return realClient;
}

export type AiMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

export interface StructuredRequest<T> {
  model: string;
  messages: AiMessage[];
  system?: string;
  purpose: string;
  schema: { parse: (data: unknown) => T };
  maxTokens?: number;
}

export interface StreamingRequest {
  model: string;
  messages: AiMessage[];
  system?: string;
  purpose: string;
  maxTokens?: number;
}

/**
 * Models are instructed to output raw JSON, but occasionally wrap it in a
 * markdown fence or add prose around it. Strip the fence, then fall back to
 * the outermost {...} span before giving up.
 */
function parseJsonLenient(text: string): unknown {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(stripped.slice(start, end + 1));
    }
    throw new Error("AI response did not contain valid JSON");
  }
}

type TokenUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

async function logUsage(purpose: string, model: string, usage: TokenUsage) {
  await db.insert(aiCalls).values({
    purpose,
    model,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
  });
}

export async function callStructured<T>(
  req: StructuredRequest<T>
): Promise<T> {
  if (MOCK_AI) {
    return mockClient.callStructured(req);
  }

  const client = getRealClient();
  const response = await client.messages.create({
    model: req.model,
    max_tokens: req.maxTokens ?? 4096,
    system: req.system,
    messages: req.messages as Anthropic.Messages.MessageParam[],
  });

  await logUsage(req.purpose, req.model, response.usage);

  const text = response.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");

  return req.schema.parse(parseJsonLenient(text));
}

export async function* callStreaming(
  req: StreamingRequest
): AsyncGenerator<string, { draftContent: string; usage: unknown }, void> {
  if (MOCK_AI) {
    // yield* evaluates to the inner generator's return value, so the mock
    // draftContent/usage pass through to the caller unchanged.
    const result = yield* mockClient.callStreaming(req);
    await logUsage(req.purpose, req.model, result.usage as TokenUsage);
    return result;
  }

  const client = getRealClient();
  // Spec docs/specs/generate.md §2.1: system（写作规范 + 百科核心的合并前缀）
  // 是唯一 cache 断点；不足 4096 token 时平台静默不缓存，
  // 命中率由 ai_calls.cache_read_input_tokens 持续观测（tech-plan §5.2）。
  const system: Anthropic.Messages.TextBlockParam[] | undefined = req.system
    ? [
        {
          type: "text",
          text: req.system,
          cache_control: { type: "ephemeral" },
        },
      ]
    : undefined;
  const stream = await client.messages.create({
    model: req.model,
    max_tokens: req.maxTokens ?? 4096,
    system,
    messages: req.messages as Anthropic.Messages.MessageParam[],
    stream: true,
  });

  let fullText = "";
  // message_stop 事件不带 usage；message_delta 的 usage 是累计值（含
  // cache_read/cache_creation 字段），取最后一个为准，message_start 兜底。
  let startUsage: Anthropic.Messages.Usage | null = null;
  let deltaUsage: Anthropic.Messages.MessageDeltaUsage | null = null;

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      fullText += event.delta.text;
      yield event.delta.text;
    }
    if (event.type === "message_start") {
      startUsage = event.message.usage;
    }
    if (event.type === "message_delta") {
      deltaUsage = event.usage;
    }
  }

  const usage = deltaUsage ?? startUsage;

  // Only reached when the stream ran to completion; an aborted consumer
  // (generator.return) skips this, so interrupted calls are not logged.
  await logUsage(req.purpose, req.model, (usage ?? {}) as TokenUsage);
  return { draftContent: fullText, usage };
}
