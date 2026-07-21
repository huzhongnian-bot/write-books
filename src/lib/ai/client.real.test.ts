import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";

// 真实分支（MOCK_AI 关闭）测试：SDK 整体 mock，断言 cache_control 断点与
// 流式 usage 归并（message_stop 不带 usage，须取 message_delta 累计值）。
// 写库走默认 ./sqlite.db，与其他测试文件一致，用 test-% purpose 隔离清理。

const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = { create: createMock };
    constructor(public opts: unknown) {}
  }
  return { default: FakeAnthropic };
});

type StreamEvent =
  | { type: "message_start"; message: { usage: Record<string, unknown> } }
  | { type: "content_block_delta"; delta: { type: "text_delta"; text: string } }
  | { type: "message_delta"; usage: Record<string, unknown> }
  | { type: "message_stop" };

function fakeStream(events: StreamEvent[]) {
  return (async function* () {
    for (const event of events) yield event;
  })();
}

const STREAM_EVENTS: StreamEvent[] = [
  {
    type: "message_start",
    message: {
      usage: {
        input_tokens: 100,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 4200,
      },
    },
  },
  { type: "content_block_delta", delta: { type: "text_delta", text: "你好" } },
  { type: "content_block_delta", delta: { type: "text_delta", text: "世界" } },
  {
    type: "message_delta",
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 4200,
      cache_creation_input_tokens: 0,
    },
  },
  { type: "message_stop" },
];

let client: typeof import("./client");
let dbModule: typeof import("@/lib/db");

beforeAll(async () => {
  process.env.MOCK_AI = "0";
  process.env.ANTHROPIC_API_KEY = "test-key";
  vi.resetModules();
  client = await import("./client");
  dbModule = await import("@/lib/db");
});

afterAll(async () => {
  await dbModule.db
    .delete(dbModule.schema.aiCalls)
    .where(eq(dbModule.schema.aiCalls.purpose, "test-streaming"));
  process.env.MOCK_AI = "1";
  delete process.env.ANTHROPIC_API_KEY;
});

describe("AI client 真实分支（SDK mock）", () => {
  it("system 以 cache_control 断点数组发送，usage 取 message_delta 累计值", async () => {
    createMock.mockResolvedValueOnce(fakeStream(STREAM_EVENTS));

    const gen = client.callStreaming({
      model: "claude-opus-4-8",
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
      model: "claude-opus-4-8",
      max_tokens: 4096,
      stream: true,
      system: [
        {
          type: "text",
          text: "冻结写作规范+百科",
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: "写一段" }],
    });

    expect(deltas.join("")).toBe("你好世界");
    expect(step.value.draftContent).toBe("你好世界");
    // usage 必须来自 message_delta（累计值），而非 message_start 或不存在的
    // message_stop.usage：cache_read 4200 / output 50 只有 delta 里有
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

  it("无 message_delta 时回退 message_start 的 usage", async () => {
    createMock.mockResolvedValueOnce(fakeStream(STREAM_EVENTS.slice(0, 2)));

    const gen = client.callStreaming({
      model: "claude-opus-4-8",
      system: "sys",
      messages: [{ role: "user", content: "写一段" }],
      purpose: "test-streaming",
    });

    let step = await gen.next();
    while (!step.done) step = await gen.next();

    const usage = step.value.usage as Record<string, unknown>;
    expect(usage.cache_creation_input_tokens).toBe(4200);
    expect(usage.input_tokens).toBe(100);
  });
});
