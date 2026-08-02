import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, sceneDrafts, sceneNodes, storylines } from "@/lib/db/schema";

// 导出小说 TXT：默认剧情线（第一条）下所有场景节点按 seq 排序，
// 每个节点取最新一条 scene_draft，节点标题作章节标题 + 正文；无草稿的节点跳过
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return Response.json({ error: "无效的项目 ID" }, { status: 400 });
  }

  const project = (
    await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
  )[0];
  if (!project) {
    return Response.json({ error: "项目不存在" }, { status: 404 });
  }

  const storyline = (
    await db
      .select()
      .from(storylines)
      .where(eq(storylines.projectId, projectId))
      .orderBy(asc(storylines.id))
      .limit(1)
  )[0];
  if (!storyline) {
    return Response.json({ error: "项目还没有剧情线，无内容可导出" }, { status: 404 });
  }

  const nodes = await db
    .select()
    .from(sceneNodes)
    .where(eq(sceneNodes.storylineId, storyline.id))
    .orderBy(asc(sceneNodes.seq), asc(sceneNodes.id));

  const parts: string[] = [];
  for (const node of nodes) {
    const draft = (
      await db
        .select()
        .from(sceneDrafts)
        .where(eq(sceneDrafts.sceneNodeId, node.id))
        .orderBy(desc(sceneDrafts.id))
        .limit(1)
    )[0];
    if (!draft) continue; // 无草稿的节点跳过
    parts.push(`${node.title}\n\n${draft.content}`);
  }

  if (parts.length === 0) {
    return Response.json({ error: "该项目还没有任何场景草稿，无内容可导出" }, { status: 404 });
  }

  // 中文文件名走 RFC5987 filename*；filename 回退为纯 ASCII 名
  const filename = `${project.name}.txt`;
  const contentDisposition = `attachment; filename="export.txt"; filename*=UTF-8''${encodeURIComponent(filename)}`;

  return new Response(parts.join("\n\n\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": contentDisposition,
    },
  });
}
