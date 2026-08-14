import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bibleEntries, projects, sourceWorks } from "@/lib/db/schema";
import { buildLorebook } from "@/lib/sillytavern/map";

// Spec: docs/specs/sillytavern.md §2.1 — 整本百科导出为 ST 世界书
// （lorebook JSON）文件下载。只读，零 AI。

function contentDisposition(filename: string): string {
  // RFC 5987：兼容中文作品名
  return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return Response.json({ error: "无效的项目 ID" }, { status: 400 });
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

  const entries = await db
    .select()
    .from(bibleEntries)
    .where(eq(bibleEntries.workId, work.id))
    .orderBy(asc(bibleEntries.id));

  const lorebook = buildLorebook(entries);
  return new Response(JSON.stringify(lorebook, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": contentDisposition(`${work.title}-lorebook.json`),
    },
  });
}
