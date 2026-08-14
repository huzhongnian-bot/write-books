import OpenAI from "openai";
import { ProxyAgent } from "undici";
import { db } from "@/lib/db";
import { aiCalls } from "@/lib/db/schema";
import { mockClient } from "./mock";

const MOCK_AI = process.env.MOCK_AI === "1";

/**
 * 默认模型：env `AI_MODEL` 可覆盖。接入走 OpenAI 兼容协议，端点由 SDK 标准
 * `OPENAI_BASE_URL` 决定（当前用 ZenMux 聚合网关 `https://zenmux.ai/api/v1`，
 * 模型名为 `provider/model` 形式，可用列表见 `GET $OPENAI_BASE_URL/models`）；
 * 模型名必须与端点匹配。
 */
export const DEFAULT_MODEL = process.env.AI_MODEL ?? "anthropic/claude-sonnet-4.5";

// Lazy singleton: instantiating at import time would crash any module that
// transitively imports this file when no API key is present (e.g. UI-only dev).
let realClient: OpenAI | null = null;

/**
 * AI 调用专用代理：env `AI_PROXY_URL`（如本机 Clash `http://127.0.0.1:7897`，
 * ZenMux 等境外端点需要）。刻意不用全局 dispatcher / HTTP(S)_PROXY——
 * 进程级代理会波及 Next 自身的 fetch（如构建期 Google Fonts 下载），
 * 代理只挂给 OpenAI client 的 fetch，不配置时零影响。
 */
function buildProxyFetch(): typeof fetch | undefined {
  const proxyUrl = process.env.AI_PROXY_URL;
  if (!proxyUrl) return undefined;
  const dispatcher = new ProxyAgent(proxyUrl);
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, { ...init, dispatcher } as RequestInit)) as typeof fetch;
}

function getRealClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "未配置 OPENAI_API_KEY：请在 .env.local 填入真实 key，或用 MOCK_AI=1 开发"
    );
  }
  if (!realClient) {
    // 默认单次调用最坏耗时 = timeout × (1 + maxRetries) = 240s
    realClient = new OpenAI({
      apiKey,
      baseURL: process.env.OPENAI_BASE_URL,
      timeout: 120_000,
      maxRetries: 1,
      fetch: buildProxyFetch(),
    });
  }
  return realClient;
}

/**
 * 把 SDK/网络错误翻译成用户可行动的中文提示。AI 调用失败最终会以 SSE
 * error 事件呈现给用户——不能是 "Request timed out" 这种无法定位的原文。
 *
 * 注意：SDK 的超时/断连是 APIConnectionError（APIError 子类，status 为
 * undefined），必须先于 status 分支判断，否则会落进「未知」兜底。
 */
export function toReadableAiError(err: unknown): Error {
  if (err instanceof OpenAI.APIConnectionError) {
    return new Error(
      "无法连接 AI 服务（网络不通或请求超时）：请检查代理设置（HTTP(S)_PROXY），或更换 OPENAI_BASE_URL 端点",
      { cause: err }
    );
  }
  if (err instanceof OpenAI.APIError) {
    const status = err.status;
    let hint: string;
    if (status === 401) {
      hint = "API key 无效或未授权，请检查 .env.local 的 OPENAI_API_KEY";
    } else if (status === 403) {
      hint =
        "API key 无权访问该模型/端点：检查 OPENAI_API_KEY 权限或 AI_MODEL 是否与端点匹配";
    } else if (status === 429) {
      hint = "请求频率超限或额度不足，请稍后重试";
    } else if (status === 404) {
      hint = "模型不存在：检查 AI_MODEL 是否与 OPENAI_BASE_URL 端点的可用模型匹配";
    } else if (status !== undefined && status >= 500) {
      hint = `AI 服务端错误（${status}），请稍后重试`;
    } else {
      hint = `AI 请求失败（${status ?? "未知"}）：${err.message}`;
    }
    return new Error(hint, { cause: err });
  }
  // fetch 层网络错误（超时、连接拒绝、DNS 等）
  const message = err instanceof Error ? err.message : String(err);
  if (
    /timed?\s*out|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|fetch failed|network/i.test(
      message
    )
  ) {
    return new Error(
      "无法连接 AI 服务（网络不通）：请检查代理设置（HTTP(S)_PROXY），或更换 OPENAI_BASE_URL 端点",
      { cause: err }
    );
  }
  return err instanceof Error ? err : new Error(message);
}

export type AiMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

export interface StreamingRequest {
  model: string;
  messages: AiMessage[];
  system?: string;
  purpose: string;
  maxTokens?: number;
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

/**
 * 失败埋点：成功记 usage，失败记 error（tokens 留空）——ai_calls 同时是
 * 成本看板与健康看板（按 purpose 看失败率与原因分布）。埋点自身失败
 * 绝不能掩盖原始错误。
 */
async function logFailure(purpose: string, model: string, error: string) {
  try {
    await db.insert(aiCalls).values({ purpose, model, error });
  } catch (logErr) {
    console.error("ai_calls 失败埋点落库失败:", logErr);
  }
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
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    ...(req.system
      ? [{ role: "system" as const, content: req.system }]
      : []),
    ...req.messages,
  ];
  // Spec docs/specs/generate.md §2.1: system（写作规范 + 百科核心的合并前缀）
  // 是提示词缓存的稳定前缀；OpenAI 兼容协议下缓存由平台自动进行，
  // 命中率由 ai_calls.cache_read_input_tokens（来自 usage
  // .prompt_tokens_details.cached_tokens）持续观测（tech-plan §5.2）。
  let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
  try {
    stream = await client.chat.completions.create({
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      stream: true,
      // 流式响应默认不带 usage，须显式要求在末尾 chunk 返回
      stream_options: { include_usage: true },
      messages,
    });
  } catch (err) {
    const readable = toReadableAiError(err);
    await logFailure(req.purpose, req.model, readable.message);
    throw readable;
  }

  let fullText = "";
  // 最后一个带 usage 的 chunk 为准（choices 为空、usage 是整次调用的累计值）
  let usage: OpenAI.Chat.Completions.ChatCompletionChunk["usage"];

  try {
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) {
        fullText += text;
        yield text;
      }
      if (chunk.usage) {
        usage = chunk.usage;
      }
    }
  } catch (err) {
    const readable = toReadableAiError(err);
    await logFailure(req.purpose, req.model, readable.message);
    throw readable;
  }

  // 归并成 Anthropic 风格的 TokenUsage：下游埋点与 mock 共用同一形状
  const tokenUsage: TokenUsage = usage
    ? {
        input_tokens: usage.prompt_tokens,
        output_tokens: usage.completion_tokens,
        cache_read_input_tokens:
          usage.prompt_tokens_details?.cached_tokens ?? 0,
      }
    : {};

  // Only reached when the stream ran to completion; an aborted consumer
  // (generator.return) skips this, so interrupted calls are not logged.
  await logUsage(req.purpose, req.model, tokenUsage);
  return { draftContent: fullText, usage: tokenUsage };
}
