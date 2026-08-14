import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bibleEntries, projects, sourceWorks } from "@/lib/db/schema";
import { bibleEntryToCharaCard } from "@/lib/sillytavern/map";

// Spec: docs/specs/sillytavern.md §2.2 — character 条目导出为
// charaCard V2 角色卡 JSON 文件下载。只读，零 AI。

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const { id, entryId } = await params;
  const projectId = Number(id);
  const bibleEntryId = Number(entryId);
  if (
    !Number.isInteger(projectId) ||
    projectId <= 0 ||
    !Number.isInteger(bibleEntryId) ||
    bibleEntryId <= 0
  ) {
    return Response.json({ error: "无效的 ID" }, { status: 400 });
  }

  const project = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .then((rows) => rows[0]);
  if (!project) {
    return Response.json({ error: "项目不存在" }, { status: 404 });
  }

  const work = await db
    .select()
    .from(sourceWorks)
    .where(eq(sourceWorks.projectId, project.id))
    .then((rows) => rows[0]);
  if (!work) {
    return Response.json({ error: "该项目还没有上传原作" }, { status: 404 });
  }

  const entry = await db
    .select()
    .from(bibleEntries)
    .where(
      and(eq(bibleEntries.id, bibleEntryId), eq(bibleEntries.workId, work.id))
    )
    .then((rows) => rows[0]);
  if (!entry) {
    return Response.json({ error: "条目不存在" }, { status: 404 });
  }
  if (entry.kind !== "character") {
    return Response.json(
      { error: "只有角色条目可以导出角色卡" },
      { status: 400 }
    );
  }

  const card = bibleEntryToCharaCard(entry, work.title);
  return new Response(JSON.stringify(card, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        `${entry.name}.json`
      )}`,
    },
  });
}
