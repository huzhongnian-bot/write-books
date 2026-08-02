import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";

// 真实分支（MOCK_AI 关闭）测试：SDK 整体 mock，断言 system 作为首条消息发送、
// 流式 usage 归并（末尾 chunk 的累计值，须 stream_options.include_usage）、
// 失败时的错误分类与 ai_calls 失败埋点。
// 写库走 test-setup.ts 下发的每 worker 独立临时库，不碰开发库 ./sqlite.db。

const createMock = vi.fn();

vi.mock("openai", async () => {
  const actual = await vi.importActual<typeof import("openai")>("openai");
  class FakeOpenAI {
    // 错误类用真实实现——client 的错误分类靠 instanceof 命中
    static APIError = actual.APIError;
    static APIConnectionError = actual.APIConnectionError;
    static APIConnectionTimeoutError = actual.APIConnectionTimeoutError;
    static AuthenticationError = actual.AuthenticationError;
    chat = { completions: { create: createMock } };
    constructor(public opts: unknown) {}
  }
  return { ...actual, default: FakeOpenAI };
});

const { APIConnectionTimeoutError, AuthenticationError } =
  await vi.importActual<typeof import("openai")>("openai");

type StreamChunk = {
  choices: { delta: { content?: string } }[];
  usage?: Record<string, unknown> | null;
};

function fakeStream(chunks: StreamChunk[]) {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
}

const STREAM_CHUNKS: StreamChunk[] = [
  { choices: [{ delta: { content: "你好" } }] },
  { choices: [{ delta: { content: "世界" } }] },
  { choices: [{ delta: {} }] },
  {
    choices: [],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      prompt_tokens_details: { cached_tokens: 4200 },
    },
  },
];

let client: typeof import("./client");
let dbModule: typeof import("@/lib/db");

beforeAll(async () => {
  process.env.MOCK_AI = "0";
  process.env.OPENAI_API_KEY = "test-key";
  vi.resetModules();
  client = await import("./client");
  dbModule = await import("@/lib/db");
});

afterAll(async () => {
  await dbModule.db.delete(dbModule.schema.aiCalls);
  process.env.MOCK_AI = "1";
  delete process.env.OPENAI_API_KEY;
});

describe("AI client 真实分支（SDK mock）", () => {
  it("system 作为首条消息发送，usage 取末尾 chunk 的累计值", async () => {
    createMock.mockResolvedValueOnce(fakeStream(STREAM_CHUNKS));

    const gen = client.callStreaming({
      model: "anthropic/claude-sonnet-4.5",
      system: "冻结写作规范+百科",
      messages: [{ role: "user", content: "写一段" }],
      purpose: "test-streaming",
    });

    const deltas: string[] = [];
    let step = await gen.next();
    while (!step.done) {
      deltas.push(step.value);
      step = await gen.next();
    }

    expect(createMock).toHaveBeenCalledWith({
      model: "anthropic/claude-sonnet-4.5",
      max_tokens: 4096,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: "冻结写作规范+百科" },
        { role: "user", content: "写一段" },
      ],
    });

    expect(deltas.join("")).toBe("你好世界");
    expect(step.value.draftContent).toBe("你好世界");
    // usage 必须来自末尾 usage chunk（OpenAI 形状已归并成内部 TokenUsage）：
    // cache_read 4200 只在 prompt_tokens_details.cached_tokens 里有
    const usage = step.value.usage as Record<string, unknown>;
    expect(usage.cache_read_input_tokens).toBe(4200);
    expect(usage.output_tokens).toBe(50);

    const rows = await dbModule.db
      .select()
      .from(dbModule.schema.aiCalls)
      .where(eq(dbModule.schema.aiCalls.purpose, "test-streaming"));
    expect(rows).toHaveLength(1);
    expect(rows[0].inputTokens).toBe(100);
    expect(rows[0].outputTokens).toBe(50);
    expect(rows[0].cacheReadTokens).toBe(4200);
  });

  it("流里没有 usage chunk 时 tokens 记 0", async () => {
    createMock.mockResolvedValueOnce(fakeStream(STREAM_CHUNKS.slice(0, 2)));

    const gen = client.callStreaming({
      model: "anthropic/claude-sonnet-4.5",
      system: "sys",
      messages: [{ role: "user", content: "写一段" }],
      purpose: "test-streaming-no-usage",
    });

    let step = await gen.next();
    while (!step.done) step = await gen.next();

    expect(step.value.draftContent).toBe("你好世界");
    expect(step.value.usage).toEqual({});

    const rows = await dbModule.db
      .select()
      .from(dbModule.schema.aiCalls)
      .where(eq(dbModule.schema.aiCalls.purpose, "test-streaming-no-usage"));
    expect(rows).toHaveLength(1);
    expect(rows[0].inputTokens).toBe(0);
    expect(rows[0].outputTokens).toBe(0);
  });

  it("连接超时：归类为「网络不通」并落失败埋点", async () => {
    createMock.mockRejectedValueOnce(
      new APIConnectionTimeoutError({ message: "Request timed out" })
    );

    const gen = client.callStreaming({
      model: "anthropic/claude-sonnet-4.5",
      messages: [{ role: "user", content: "x" }],
      purpose: "test-failure-timeout",
    });
    await expect(gen.next()).rejects.toThrow("无法连接 AI 服务");

    const rows = await dbModule.db
      .select()
      .from(dbModule.schema.aiCalls)
      .where(eq(dbModule.schema.aiCalls.purpose, "test-failure-timeout"));
    expect(rows).toHaveLength(1);
    expect(rows[0].error).toContain("无法连接 AI 服务");
    // 失败埋点不记 tokens（反向留空）
    expect(rows[0].inputTokens).toBeNull();
  });

  it("401：归类为「key 无效」并落失败埋点", async () => {
    createMock.mockRejectedValueOnce(
      new AuthenticationError(401, undefined, "invalid api key", new Headers())
    );

    const gen = client.callStreaming({
      model: "anthropic/claude-sonnet-4.5",
      messages: [{ role: "user", content: "x" }],
      purpose: "test-failure-401",
    });
    await expect(gen.next()).rejects.toThrow("API key 无效");

    const rows = await dbModule.db
      .select()
      .from(dbModule.schema.aiCalls)
      .where(eq(dbModule.schema.aiCalls.purpose, "test-failure-401"));
    expect(rows).toHaveLength(1);
    expect(rows[0].error).toContain("API key 无效");
  });
});
