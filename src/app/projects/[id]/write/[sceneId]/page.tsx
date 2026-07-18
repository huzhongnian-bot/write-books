import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { sceneDrafts, sceneNodes, storylines } from "@/lib/db/schema";
import { WriteWorkbench } from "./write-workbench";

// Spec: docs/specs/generate.md §2.3 — RSC 取数 + client 岛。
// 直接读 better-sqlite3，必须每次请求时渲染，不能静态化。
export const dynamic = "force-dynamic";

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

export default async function WritePage({
  params,
}: {
  params: Promise<{ id: string; sceneId: string }>;
}) {
  const { id, sceneId } = await params;
  const projectId = Number(id);
  const sceneNodeId = Number(sceneId);
  if (
    !Number.isInteger(projectId) ||
    projectId <= 0 ||
    !Number.isInteger(sceneNodeId) ||
    sceneNodeId <= 0
  ) {
    notFound();
  }

  const node = (
    await db.select().from(sceneNodes).where(eq(sceneNodes.id, sceneNodeId))
  )[0];
  if (!node) notFound();

  const storyline = (
    await db
      .select()
      .from(storylines)
      .where(eq(storylines.id, node.storylineId))
  )[0];
  if (!storyline || storyline.projectId !== projectId) notFound();

  // 版本链：新 → 旧（spec §2.3）
  const drafts = await db
    .select()
    .from(sceneDrafts)
    .where(eq(sceneDrafts.sceneNodeId, node.id))
    .orderBy(desc(sceneDrafts.id));

  return (
    <WriteWorkbench
      projectId={projectId}
      scene={{
        id: node.id,
        seq: node.seq,
        title: node.title,
        pov: node.pov,
        time: node.time,
        place: node.place,
        beats: node.beats,
        characterIds: asStringArray(node.characterIds),
        foreshadowRefs: asStringArray(node.foreshadowRefs),
      }}
      initialDrafts={drafts.map((d) => ({
        id: d.id,
        content: d.content,
        instruction: d.instruction,
        model: d.model,
        parentDraftId: d.parentDraftId,
        createdAt: d.createdAt.toISOString(),
      }))}
    />
  );
}
