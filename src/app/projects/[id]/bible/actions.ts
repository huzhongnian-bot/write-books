"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { bibleEntries, chapters, sourceWorks } from "@/lib/db/schema";

import {
  createBibleEntryInputSchema,
  updateBibleEntryInputSchema,
  type ActionResult,
  type ChapterExcerpt,
} from "./shared";

function biblePath(projectId: number) {
  return `/projects/${projectId}/bible`;
}

/**
 * 编辑条目（spec bible.md §2.1）：
 * 校订语义 = extracted + editedByUser=true；原地更新，不新建条目。
 * origin=user 的条目保持二创语义（editedByUser 仍为 false）。
 */
export async function updateBibleEntry(input: unknown): Promise<ActionResult> {
  const parsed = updateBibleEntryInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "输入无效" };
  }
  const { entryId, projectId, name, confidence, data } = parsed.data;

  try {
    const existing = await db
      .select()
      .from(bibleEntries)
      .where(eq(bibleEntries.id, entryId))
      .limit(1);
    const entry = existing[0];
    if (!entry) return { ok: false, error: "条目不存在或已被删除" };

    await db
      .update(bibleEntries)
      .set({
        name,
        confidence,
        data,
        editedByUser: entry.origin === "user" ? entry.editedByUser : true,
      })
      .where(eq(bibleEntries.id, entryId));

    revalidatePath(biblePath(projectId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "保存失败" };
  }
}

/** 新建条目（spec bible.md §2.1）：origin=user、editedByUser=false，UI 文案为「二创设定」 */
export async function createBibleEntry(input: unknown): Promise<ActionResult> {
  const parsed = createBibleEntryInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "输入无效" };
  }
  const { projectId, workId, kind, name, confidence, data } = parsed.data;

  try {
    // Server Action 是公开入口，校验 work 归属该项目
    const works = await db
      .select({ id: sourceWorks.id, projectId: sourceWorks.projectId })
      .from(sourceWorks)
      .where(eq(sourceWorks.id, workId))
      .limit(1);
    if (!works[0] || works[0].projectId !== projectId) {
      return { ok: false, error: "作品不存在" };
    }

    await db.insert(bibleEntries).values({
      workId,
      kind,
      name,
      data,
      anchors: [],
      confidence,
      origin: "user",
      editedByUser: false,
    });

    revalidatePath(biblePath(projectId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "新建失败" };
  }
}

/** 出处锚点弹层：按章节序号取原文（spec bible.md §2.2） */
export async function getChapterExcerpt(
  workId: number,
  chapterSeq: number
): Promise<ChapterExcerpt | null> {
  if (!Number.isInteger(workId) || workId <= 0) return null;
  if (!Number.isInteger(chapterSeq) || chapterSeq <= 0) return null;

  const rows = await db
    .select({ title: chapters.title, content: chapters.content })
    .from(chapters)
    .where(and(eq(chapters.workId, workId), eq(chapters.seq, chapterSeq)))
    .limit(1);

  const chapter = rows[0];
  if (!chapter) return null;
  return { title: chapter.title, content: chapter.content };
}
