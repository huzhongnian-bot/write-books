"use server";

import { asc, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { chapters, sceneNodes, sourceWorks, storylines } from "@/lib/db/schema";
import { callStreaming, DEFAULT_MODEL } from "@/lib/ai/client";
import { SCRIPT_DRAFT_SYSTEM } from "@/lib/ai/prompts/script-draft";

// ------------------------------------------------------------------
// 输入校验（spec script.md §2.1：characterIds / foreshadowRefs 存百科条目 name 数组）
// ------------------------------------------------------------------

const idSchema = z.number().int().positive();

/** 可空短文本：空串归一为 null */
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v === null || v === "" ? null : v));

const nameArraySchema = z.array(z.string().trim().min(1).max(100)).max(100);

const updateSceneNodeSchema = z.object({
  projectId: idSchema,
  nodeId: idSchema,
  title: z.string().trim().min(1, "标题不能为空").max(200),
  pov: nullableText(100),
  characterIds: nameArraySchema,
  time: nullableText(100),
  place: nullableText(200),
  beats: z.string().trim().max(5000),
  foreshadowRefs: nameArraySchema,
});

const nodeRefSchema = z.object({
  projectId: idSchema,
  nodeId: idSchema,
});

const moveSceneNodeSchema = nodeRefSchema.extend({
  direction: z.enum(["up", "down"]),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

function scriptPath(projectId: number) {
  return `/projects/${projectId}/script`;
}

/** P0：每项目单条剧情线，不存在则自动创建（spec script.md §2.1） */
async function getOrCreateStoryline(projectId: number) {
  const existing = await db
    .select()
    .from(storylines)
    .where(eq(storylines.projectId, projectId))
    .orderBy(asc(storylines.id))
    .limit(1);
  if (existing[0]) return existing[0];
  const created = await db
    .insert(storylines)
    .values({ projectId, title: "默认剧情线" })
    .returning();
  return created[0];
}

/** 校验节点存在且属于该项目（Server Action 是公开入口，必须做归属校验） */
async function assertNodeInProject(projectId: number, nodeId: number) {
  const rows = await db
    .select({
      id: sceneNodes.id,
      storylineId: sceneNodes.storylineId,
      projectId: storylines.projectId,
    })
    .from(sceneNodes)
    .innerJoin(storylines, eq(sceneNodes.storylineId, storylines.id))
    .where(eq(sceneNodes.id, nodeId))
    .limit(1);
  const row = rows[0];
  if (!row || row.projectId !== projectId) {
    throw new Error("场景节点不存在");
  }
  return row;
}

export async function createSceneNode(input: {
  projectId: number;
}): Promise<ActionResult & { nodeId?: number }> {
  const parsed = z.object({ projectId: idSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "参数无效" };
  const { projectId } = parsed.data;

  try {
    const storyline = await getOrCreateStoryline(projectId);
    const last = await db
      .select({ seq: sceneNodes.seq })
      .from(sceneNodes)
      .where(eq(sceneNodes.storylineId, storyline.id))
      .orderBy(desc(sceneNodes.seq))
      .limit(1);

    const created = await db
      .insert(sceneNodes)
      .values({
        storylineId: storyline.id,
        seq: (last[0]?.seq ?? 0) + 1,
        title: "新场景",
        characterIds: [],
        foreshadowRefs: [],
      })
      .returning({ id: sceneNodes.id });

    revalidatePath(scriptPath(projectId));
    return { ok: true, nodeId: created[0].id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "新建失败" };
  }
}

export async function updateSceneNode(input: unknown): Promise<ActionResult> {
  const parsed = updateSceneNodeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "输入无效" };
  }
  const { projectId, nodeId, ...data } = parsed.data;

  try {
    await assertNodeInProject(projectId, nodeId);
    await db.update(sceneNodes).set(data).where(eq(sceneNodes.id, nodeId));
    revalidatePath(scriptPath(projectId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "保存失败" };
  }
}

export async function deleteSceneNode(input: unknown): Promise<ActionResult> {
  const parsed = nodeRefSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "参数无效" };
  const { projectId, nodeId } = parsed.data;

  try {
    const node = await assertNodeInProject(projectId, nodeId);

    // 删除 + 重排 seq 必须在同一事务，中途失败会留下 1..n 不连续的 seq
    // （docs/reviews/kimi-k3-review.md 缺陷 #4）
    db.transaction((tx) => {
      tx.delete(sceneNodes).where(eq(sceneNodes.id, nodeId)).run();

      // 重排剩余节点 seq，保持 1..n 连续（spec §三：删除后列表与 seq 正确）
      const rest = tx
        .select({ id: sceneNodes.id })
        .from(sceneNodes)
        .where(eq(sceneNodes.storylineId, node.storylineId))
        .orderBy(asc(sceneNodes.seq), asc(sceneNodes.id))
        .all();
      for (let i = 0; i < rest.length; i++) {
        tx.update(sceneNodes)
          .set({ seq: i + 1 })
          .where(eq(sceneNodes.id, rest[i].id))
          .run();
      }
    });

    revalidatePath(scriptPath(projectId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "删除失败" };
  }
}

export async function moveSceneNode(input: unknown): Promise<ActionResult> {
  const parsed = moveSceneNodeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "参数无效" };
  const { projectId, nodeId, direction } = parsed.data;

  try {
    const node = await assertNodeInProject(projectId, nodeId);
    const nodes = await db
      .select({ id: sceneNodes.id, seq: sceneNodes.seq })
      .from(sceneNodes)
      .where(eq(sceneNodes.storylineId, node.storylineId))
      .orderBy(asc(sceneNodes.seq), asc(sceneNodes.id));

    const index = nodes.findIndex((n) => n.id === nodeId);
    const neighbor = nodes[direction === "up" ? index - 1 : index + 1];
    if (index === -1 || !neighbor) return { ok: true }; // 已在顶部/底部，无需移动

    // 上下移动即交换 seq（spec script.md §2.1）；两次 update 必须同事务，
    // 否则中途失败会留下重复 seq（事务回调须同步，.run() 终结）
    const current = nodes[index];
    db.transaction((tx) => {
      tx.update(sceneNodes)
        .set({ seq: neighbor.seq })
        .where(eq(sceneNodes.id, current.id))
        .run();
      tx.update(sceneNodes)
        .set({ seq: current.seq })
        .where(eq(sceneNodes.id, neighbor.id))
        .run();
    });

    revalidatePath(scriptPath(projectId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "移动失败" };
  }
}

// ------------------------------------------------------------------
// AI 场景草案（spec script.md §2.3）：全章节概述 → 场景节点序列
// ------------------------------------------------------------------

const draftNodeSchema = z.object({
  title: z.string().trim().min(1).max(200),
  beats: z.string().trim().min(1).max(5000),
  pov: z.string().trim().max(100).nullable().default(null),
  place: z.string().trim().max(200).nullable().default(null),
  characters: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
});

const draftResponseSchema = z.array(draftNodeSchema).min(1).max(100);

/** 从 AI 输出中取出 JSON 数组（容忍代码块围栏与前后多余文字） */
function extractJsonArray(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("AI 输出中未找到 JSON 数组");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function generateSceneDrafts(input: {
  projectId: number;
}): Promise<ActionResult & { created?: number }> {
  const parsed = z.object({ projectId: idSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "参数无效" };
  const { projectId } = parsed.data;

  try {
    const work = (
      await db
        .select()
        .from(sourceWorks)
        .where(eq(sourceWorks.projectId, projectId))
    )[0];
    if (!work) return { ok: false, error: "该项目还没有上传原作" };

    const chapterRows = await db
      .select({
        seq: chapters.seq,
        title: chapters.title,
        summary: chapters.summary,
      })
      .from(chapters)
      .where(eq(chapters.workId, work.id))
      .orderBy(asc(chapters.seq));
    const summarized = chapterRows.filter((c) => c.summary !== null);
    if (summarized.length === 0) {
      return {
        ok: false,
        error: "还没有章节概述：请先在项目页生成章节概述，再生成场景草案",
      };
    }

    const outline = summarized
      .map(
        (c) => `第${c.seq}章${c.title ? `「${c.title}」` : ""}：${c.summary}`
      )
      .join("\n");

    const gen = callStreaming({
      model: DEFAULT_MODEL,
      system: SCRIPT_DRAFT_SYSTEM,
      messages: [{ role: "user", content: `原作章节概述：\n${outline}` }],
      purpose: "script-draft",
    });
    let text = "";
    while (true) {
      const step = await gen.next();
      if (step.done) {
        text = step.value.draftContent;
        break;
      }
    }

    // AI 输出不可信：解析失败直接报错重试，不落半截数据
    const nodes = draftResponseSchema.parse(extractJsonArray(text));

    const storyline = await getOrCreateStoryline(projectId);
    db.transaction((tx) => {
      const last = tx
        .select({ seq: sceneNodes.seq })
        .from(sceneNodes)
        .where(eq(sceneNodes.storylineId, storyline.id))
        .orderBy(desc(sceneNodes.seq))
        .limit(1)
        .all();
      let seq = last[0]?.seq ?? 0;
      for (const node of nodes) {
        seq++;
        tx.insert(sceneNodes)
          .values({
            storylineId: storyline.id,
            seq,
            title: node.title,
            beats: node.beats,
            pov: node.pov || null,
            place: node.place || null,
            characterIds: node.characters,
            foreshadowRefs: [],
          })
          .run();
      }
    });

    revalidatePath(scriptPath(projectId));
    return { ok: true, created: nodes.length };
  } catch (err) {
    if (err instanceof SyntaxError || err instanceof z.ZodError) {
      return {
        ok: false,
        error: "AI 输出解析失败（不是合法的场景 JSON），请重试",
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "草案生成失败",
    };
  }
}
