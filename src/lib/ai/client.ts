import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { aiCalls } from "@/lib/db/schema";
import { mockClient } from "./mock";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MOCK_AI = process.env.MOCK_AI === "1";

function createRealClient() {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required when MOCK_AI is not set");
  }

  return new Anthropic({ apiKey: ANTHROPIC_API_KEY });
}

export const aiClient = MOCK_AI ? mockClient : createRealClient();

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

async function logUsage(
  purpose: string,
  model: string,
  usage: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  }
) {
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

  const client = createRealClient();
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

  const json = JSON.parse(text);
  return req.schema.parse(json);
}

export async function* callStreaming(
  req: StreamingRequest
): AsyncGenerator<string, { draftContent: string; usage: unknown }, void> {
  if (MOCK_AI) {
    yield* mockClient.callStreaming(req);
    return { draftContent: "", usage: {} };
  }

  const client = createRealClient();
  const stream = await client.messages.create({
    model: req.model,
    max_tokens: req.maxTokens ?? 4096,
    system: req.system,
    messages: req.messages as Anthropic.Messages.MessageParam[],
    stream: true,
  });

  let fullText = "";
  let lastUsage: unknown;

  for await (const event of stream as unknown as AsyncIterable<{
    type: string;
    delta?: { text?: string };
    usage?: unknown;
  }>) {
    if (event.type === "content_block_delta" && event.delta?.text) {
      fullText += event.delta.text;
      yield event.delta.text;
    }
    if (event.type === "message_stop" && event.usage) {
      lastUsage = event.usage;
    }
  }

  return { draftContent: fullText, usage: lastUsage };
}
