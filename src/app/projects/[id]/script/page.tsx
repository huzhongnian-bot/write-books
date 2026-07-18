import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  bibleEntries,
  projects,
  sceneNodes,
  sourceWorks,
  storylines,
} from "@/lib/db/schema";

import {
  ScriptEditor,
  type BibleEntryOption,
  type SceneNodeDTO,
} from "./script-editor";

// 直接查库且进入页面可能自动创建剧情线，必须每次请求动态渲染
export const dynamic = "force-dynamic";

// DB json 列在 drizzle 中类型为 unknown，入库前已按 name 数组写入，这里做兜底解析
const stringArraySchema = z.array(z.string()).catch([]);

export default async function ScriptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);

  const projectId = Number(id);
  if (!Number.isInteger(projectId) || projectId <= 0) notFound();

  const project = (
    await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
  )[0];
  if (!project) notFound();

  // P0：每项目单条剧情线，进入脚本页时不存在则自动创建（spec script.md §2.1）
  let storyline = (
    await db
      .select()
      .from(storylines)
      .where(eq(storylines.projectId, projectId))
      .orderBy(asc(storylines.id))
      .limit(1)
  )[0];
  if (!storyline) {
    storyline = (
      await db
        .insert(storylines)
        .values({ projectId, title: "默认剧情线" })
        .returning()
    )[0];
  }

  const nodeRows = await db
    .select()
    .from(sceneNodes)
    .where(eq(sceneNodes.storylineId, storyline.id))
    .orderBy(asc(sceneNodes.seq), asc(sceneNodes.id));

  const nodes: SceneNodeDTO[] = nodeRows.map((row) => ({
    id: row.id,
    seq: row.seq,
    title: row.title,
    pov: row.pov,
    characterIds: stringArraySchema.parse(row.characterIds),
    time: row.time,
    place: row.place,
    beats: row.beats,
    foreshadowRefs: stringArraySchema.parse(row.foreshadowRefs),
  }));

  // 百科条目经 sourceWorks 关联到项目；characterIds/foreshadowRefs 均存 name，此处按 name 去重
  const entryRows = await db
    .select({ name: bibleEntries.name, kind: bibleEntries.kind })
    .from(bibleEntries)
    .innerJoin(sourceWorks, eq(bibleEntries.workId, sourceWorks.id))
    .where(eq(sourceWorks.projectId, projectId))
    .orderBy(asc(bibleEntries.name));

  const seen = new Set<string>();
  const entries: BibleEntryOption[] = [];
  for (const entry of entryRows) {
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    entries.push(entry);
  }

  // 选中态由 ?node=<id> 驱动；参数缺失/非法/指向不存在节点时回落到第一个节点
  const nodeParam = Array.isArray(sp.node) ? sp.node[0] : sp.node;
  const requestedId = Number(nodeParam);
  const selectedNodeId = nodes.some((n) => n.id === requestedId)
    ? requestedId
    : (nodes[0]?.id ?? null);

  return (
    <ScriptEditor
      projectId={projectId}
      storylineTitle={storyline.title}
      nodes={nodes}
      bibleEntries={entries}
      selectedNodeId={selectedNodeId}
    />
  );
}
