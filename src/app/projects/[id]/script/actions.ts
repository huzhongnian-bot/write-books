"use server";

import { asc, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { sceneNodes, storylines } from "@/lib/db/schema";

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

    // 上下移动即交换 seq（spec script.md §2.1）
    const current = nodes[index];
    await db
      .update(sceneNodes)
      .set({ seq: neighbor.seq })
      .where(eq(sceneNodes.id, current.id));
    await db
      .update(sceneNodes)
      .set({ seq: current.seq })
      .where(eq(sceneNodes.id, neighbor.id));

    revalidatePath(scriptPath(projectId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "移动失败" };
  }
}
