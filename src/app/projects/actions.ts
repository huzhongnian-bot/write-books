"use server";

import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  bibleEntries,
  chapters,
  projects,
  projectThemeEnum,
  sceneDrafts,
  sceneNodes,
  sourceWorks,
  storylines,
} from "@/lib/db/schema";
import { deleteChunksForWorks, deleteSummariesForWorks } from "@/lib/retrieval/chunks";

export type SetProjectThemeResult = { ok: true } | { ok: false; error: string };

/** 设置项目的文学主题皮肤（docs/specs/theme.md） */
export async function setProjectTheme(
  input: unknown
): Promise<SetProjectThemeResult> {
  const parsed = z
    .object({ projectId: z.number().int().positive(), theme: projectThemeEnum })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "参数无效" };
  const { projectId, theme } = parsed.data;

  try {
    const updated = await db
      .update(projects)
      .set({ theme })
      .where(eq(projects.id, projectId));
    if (updated.changes === 0) return { ok: false, error: "项目不存在" };
    // layout 级 revalidate：换肤由 [id]/layout 读库驱动
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "主题保存失败",
    };
  }
}

export type DeleteProjectResult = { ok: true } | { ok: false; error: string };

export async function deleteProject(input: unknown): Promise<DeleteProjectResult> {
  const parsed = z
    .object({ projectId: z.number().int().positive() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "参数无效" };
  const { projectId } = parsed.data;

  try {
    // 按依赖顺序（先子表后父表）单事务删除：
    // scene_drafts（经 scene_nodes→storylines 子查询）→ scene_nodes → storylines
    // → bible_entries → chapter_chunks(FTS) → chapters → source_works → projects
    // drizzle + better-sqlite3 事务回调必须同步（.all()/.run() 终结）
    db.transaction((tx) => {
      const storylineIds = tx
        .select({ id: storylines.id })
        .from(storylines)
        .where(eq(storylines.projectId, projectId))
        .all()
        .map((row) => row.id);
      if (storylineIds.length > 0) {
        const nodeIds = tx
          .select({ id: sceneNodes.id })
          .from(sceneNodes)
          .where(inArray(sceneNodes.storylineId, storylineIds))
          .all()
          .map((row) => row.id);
        if (nodeIds.length > 0) {
          tx.delete(sceneDrafts)
            .where(inArray(sceneDrafts.sceneNodeId, nodeIds))
            .run();
        }
        tx.delete(sceneNodes)
          .where(inArray(sceneNodes.storylineId, storylineIds))
          .run();
      }
      tx.delete(storylines).where(eq(storylines.projectId, projectId)).run();

      const workIds = tx
        .select({ id: sourceWorks.id })
        .from(sourceWorks)
        .where(eq(sourceWorks.projectId, projectId))
        .all()
        .map((row) => row.id);
      if (workIds.length > 0) {
        tx.delete(bibleEntries).where(inArray(bibleEntries.workId, workIds)).run();
        // FTS 索引表无 FK，随 chapters 一并显式清理（src/lib/retrieval/chunks.ts）
        deleteChunksForWorks(tx, workIds);
        deleteSummariesForWorks(tx, workIds);
        tx.delete(chapters).where(inArray(chapters.workId, workIds)).run();
      }
      tx.delete(sourceWorks).where(eq(sourceWorks.projectId, projectId)).run();

      const deleted = tx
        .delete(projects)
        .where(eq(projects.id, projectId))
        .run();
      if (deleted.changes === 0) {
        throw new Error("项目不存在");
      }
    });

    revalidatePath("/projects");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "删除失败" };
  }
}
