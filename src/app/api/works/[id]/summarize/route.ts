import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chapters, sourceWorks } from "@/lib/db/schema";
import { callStreaming, DEFAULT_MODEL } from "@/lib/ai/client";
import { SUMMARIZE_CHAPTER_SYSTEM } from "@/lib/ai/prompts/summarize-chapter";
import { indexChapterSummary } from "@/lib/retrieval/chunks";

// Spec: docs/specs/ingest.md §2.4 — 逐章生成概述，SSE 事件：
// progress（每章落库后）/ done / error。默认只补 summary 为空的章（断点
// 续跑：客户端断开或单章失败后重跑，已完成章节不重复生成、不重复计费）；
// 请求体带 { seqs } 时只处理所选章节（含已有概述的，用于强制重生成）。
// 每章「更新 chapters + 概述 FTS 索引」在一个同步事务内。

const SUMMARIZE_PURPOSE = "summarize-chapter";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const workId = Number(id);
  if (!Number.isInteger(workId) || workId <= 0) {
    return Response.json({ error: "无效的作品 ID" }, { status: 400 });
  }

  const work = (
    await db.select().from(sourceWorks).where(eq(sourceWorks.id, workId))
  )[0];
  if (!work) {
    return Response.json({ error: "作品不存在" }, { status: 404 });
  }

  // 可选请求体 { seqs: number[] }：只生成所选章节（含已有概述的，即强制
  // 重生成）；不带 body 时维持原行为——只补 summary 为空的章。
  const body = (await request.json().catch(() => null)) as {
    seqs?: unknown;
  } | null;
  let selectedSeqs: Set<number> | null = null;
  if (body != null && body.seqs !== undefined) {
    if (
      !Array.isArray(body.seqs) ||
      body.seqs.length === 0 ||
      !body.seqs.every((s) => Number.isInteger(s) && (s as number) > 0)
    ) {
      return Response.json(
        { error: "seqs 必须是非空的正整数数组" },
        { status: 400 }
      );
    }
    selectedSeqs = new Set(body.seqs as number[]);
  }

  const todo = await db
    .select()
    .from(chapters)
    .where(eq(chapters.workId, workId))
    .orderBy(asc(chapters.seq));
  const pending = selectedSeqs
    ? todo.filter((c) => selectedSeqs.has(c.seq))
    : todo.filter((c) => c.summary === null);
  if (selectedSeqs && pending.length !== selectedSeqs.size) {
    return Response.json(
      { error: "所选章节不存在于该作品" },
      { status: 400 }
    );
  }

  let clientGone = request.signal.aborted;
  request.signal.addEventListener("abort", () => {
    clientGone = true;
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };
      const close = () => {
        try {
          controller.close();
        } catch {
          // 流已关闭
        }
      };

      let summarized = 0;
      try {
        for (const chapter of pending) {
          if (clientGone) break;

          const gen = callStreaming({
            model: DEFAULT_MODEL,
            system: SUMMARIZE_CHAPTER_SYSTEM,
            messages: [
              {
                role: "user",
                content: `章节标题：${chapter.title ?? "（无）"}\n\n正文：\n${chapter.content}`,
              },
            ],
            purpose: SUMMARIZE_PURPOSE,
            maxTokens: 1024,
          });

          let summary = "";
          try {
            while (true) {
              if (clientGone) break;
              const step = await gen.next();
              if (step.done) {
                summary = step.value.draftContent.trim();
                break;
              }
            }
          } finally {
            if (!summary) {
              try {
                await gen.return({ draftContent: "", usage: {} });
              } catch {
                // 生成器已结束
              }
            }
          }
          if (clientGone) break;
          if (!summary) {
            throw new Error(`第 ${chapter.seq} 章概述生成结果为空`);
          }

          // 落库 + 概述 FTS 索引，同一同步事务（与 chapters 同生共死）
          db.transaction((tx) => {
            tx.update(chapters)
              .set({ summary })
              .where(eq(chapters.id, chapter.id))
              .run();
            indexChapterSummary(tx, workId, {
              seq: chapter.seq,
              title: chapter.title,
              summary,
            });
          });

          summarized++;
          send("progress", {
            seq: chapter.seq,
            title: chapter.title,
            summarized,
            total: pending.length,
          });
        }

        if (clientGone) {
          close();
          return;
        }
        send("done", { summarized, skipped: todo.length - pending.length });
        close();
      } catch (err) {
        if (!clientGone) {
          try {
            send("error", {
              message:
                err instanceof Error ? err.message : "概述生成失败，请重试",
              summarized,
            });
          } catch {
            // 流已关闭，无法再通知客户端
          }
        }
        close();
      }
    },
    cancel() {
      clientGone = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
