import { and, asc, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  bibleEntries,
  sceneDrafts,
  sceneNodes,
  sourceWorks,
  storylines,
  type SceneDraft,
} from "@/lib/db/schema";
import {
  assembleContext,
  type PriorScene,
} from "@/lib/ai/assemble-context";
import { callStreaming } from "@/lib/ai/client";

// Spec: docs/specs/generate.md §2.2 — SSE 三类事件 delta/done/error；
// done 时落库 scene_drafts（ai_calls 由 client.ts 在完成时统一落库），
// 客户端断开（request.signal aborted）即停止生成，半成品不落库。

const GENERATE_MODEL = "claude-opus-4-8";
const GENERATE_PURPOSE = "generate-scene";

const requestBodySchema = z.object({
  mode: z.enum(["instruct", "continue", "rewrite"]),
  instruction: z.string().min(1),
  baseDraftId: z.number().int().positive().optional(),
});

async function getCurrentDraft(sceneNodeId: number): Promise<SceneDraft | null> {
  const rows = await db
    .select()
    .from(sceneDrafts)
    .where(eq(sceneDrafts.sceneNodeId, sceneNodeId))
    .orderBy(desc(sceneDrafts.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sceneNodeId = Number(id);
  if (!Number.isInteger(sceneNodeId) || sceneNodeId <= 0) {
    return Response.json({ error: "无效的场景 ID" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const parsed = requestBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "请求参数不合法", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const { mode, instruction, baseDraftId } = parsed.data;

  const sceneNode = (
    await db.select().from(sceneNodes).where(eq(sceneNodes.id, sceneNodeId))
  )[0];
  if (!sceneNode) {
    return Response.json({ error: "场景不存在" }, { status: 404 });
  }

  const storyline = (
    await db
      .select()
      .from(storylines)
      .where(eq(storylines.id, sceneNode.storylineId))
  )[0];
  if (!storyline) {
    return Response.json({ error: "场景所属故事线不存在" }, { status: 404 });
  }

  // 百科条目：该场景所属 work 的全部（spec §2.2）
  const work = (
    await db
      .select()
      .from(sourceWorks)
      .where(eq(sourceWorks.projectId, storyline.projectId))
  )[0];
  const bible = work
    ? await db.select().from(bibleEntries).where(eq(bibleEntries.workId, work.id))
    : [];

  const currentDraft = await getCurrentDraft(sceneNodeId);

  // baseDraftId 显式指定时必须属于本节点
  let baseDraft: SceneDraft | null = null;
  if (baseDraftId !== undefined) {
    const row = (
      await db.select().from(sceneDrafts).where(eq(sceneDrafts.id, baseDraftId))
    )[0];
    if (!row || row.sceneNodeId !== sceneNodeId) {
      return Response.json({ error: "baseDraftId 无效" }, { status: 400 });
    }
    baseDraft = row;
  }

  // 同 storyline 前序节点（按 seq 升序）及其当前稿（spec §2.2）
  const priorNodes = await db
    .select()
    .from(sceneNodes)
    .where(
      and(
        eq(sceneNodes.storylineId, sceneNode.storylineId),
        lt(sceneNodes.seq, sceneNode.seq)
      )
    )
    .orderBy(asc(sceneNodes.seq));
  const priorScenes: PriorScene[] = [];
  for (const node of priorNodes) {
    priorScenes.push({ node, currentDraft: await getCurrentDraft(node.id) });
  }

  const { system, messages } = assembleContext({
    bibleEntries: bible,
    sceneNode,
    currentDraft,
    priorScenes,
    mode,
    instruction,
    baseDraft,
  });

  // spec §2.2: parentDraftId = baseDraftId ?? 该节点此前当前稿 id ?? null
  const parentDraftId = baseDraftId ?? currentDraft?.id ?? null;

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

      const gen = callStreaming({
        model: GENERATE_MODEL,
        system,
        messages,
        purpose: GENERATE_PURPOSE,
      });

      let accumulated = "";
      let completed: { draftContent: string; usage: unknown } | null = null;
      try {
        while (true) {
          if (clientGone) break;
          const step = await gen.next();
          if (step.done) {
            completed = step.value;
            break;
          }
          accumulated += step.value;
          send("delta", { text: step.value });
        }

        if (clientGone || !completed) {
          // 中断：半成品不落库，版本链只存完成稿
          close();
          return;
        }

        const [draft] = await db
          .insert(sceneDrafts)
          .values({
            sceneNodeId,
            parentDraftId,
            content: completed.draftContent || accumulated,
            instruction,
            model: GENERATE_MODEL,
          })
          .returning();

        send("done", { draftId: draft.id, usage: completed.usage ?? {} });
        close();
      } catch (err) {
        if (!clientGone) {
          try {
            send("error", {
              message: err instanceof Error ? err.message : "生成失败",
            });
          } catch {
            // 流已关闭，无法再通知客户端
          }
        }
        close();
      } finally {
        if (!completed) {
          // 终止上游生成器（mock 定时器 / 真实 API 流）
          try {
            await gen.return({ draftContent: "", usage: {} });
          } catch {
            // 生成器已结束
          }
        }
      }
    },
    cancel() {
      // Response 流被消费端取消（客户端断开）
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
