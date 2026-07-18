import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { db } from "@/lib/db";
import { bibleEntries, projects, sourceWorks } from "@/lib/db/schema";

import { AnchorDialog } from "./anchor-dialog";
import { CreateEntryDialog } from "./create-entry-dialog";
import { EditEntryDialog } from "./edit-entry-dialog";
import {
  anchorDTOSchema,
  bibleKindEnum,
  bibleKindLabels,
  bibleKinds,
  type BibleEntryDTO,
  type BibleKind,
} from "./shared";

export const metadata: Metadata = { title: "原作百科" };

// 直接读 sqlite，禁止构建期预渲染（与 src/app/projects/[id]/page.tsx 一致）
export const dynamic = "force-dynamic";

export default async function BiblePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    notFound();
  }

  const project = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .then((rows) => rows[0]);
  if (!project) {
    notFound();
  }

  const work = await db
    .select()
    .from(sourceWorks)
    .where(eq(sourceWorks.projectId, project.id))
    .limit(1)
    .then((rows) => rows[0]);
  if (!work) {
    notFound();
  }

  const rows = await db
    .select()
    .from(bibleEntries)
    .where(eq(bibleEntries.workId, work.id))
    .orderBy(asc(bibleEntries.id));

  const entriesByKind = new Map<BibleKind, BibleEntryDTO[]>(
    bibleKinds.map((kind) => [kind, []])
  );
  for (const row of rows) {
    const entry = toEntryDTO(row);
    if (entry) entriesByKind.get(entry.kind)?.push(entry);
  }
  const total = [...entriesByKind.values()].reduce(
    (sum, list) => sum + list.length,
    0
  );

  return (
    <main className="container mx-auto max-w-5xl px-4 py-10">
      <Link
        href={`/projects/${project.id}`}
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        ← 返回项目
      </Link>

      <header className="mt-4 space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">原作百科</h1>
        <p className="text-sm text-muted-foreground">
          {work.title}
          {work.author ? ` · ${work.author}` : ""}，共 {total}{" "}
          条。「已校订」为修正抽取结果，「二创设定」为偏离原作的自建设定。
        </p>
      </header>

      <Tabs defaultValue="setting" className="mt-6">
        <TabsList className="flex-wrap">
          {bibleKinds.map((kind) => (
            <TabsTrigger key={kind} value={kind}>
              {bibleKindLabels[kind]}（{entriesByKind.get(kind)?.length ?? 0}）
            </TabsTrigger>
          ))}
        </TabsList>

        {bibleKinds.map((kind) => {
          const entries = entriesByKind.get(kind) ?? [];
          return (
            <TabsContent key={kind} value={kind} className="space-y-4 pt-2">
              <div className="flex justify-end">
                <CreateEntryDialog
                  projectId={project.id}
                  workId={work.id}
                  kind={kind}
                />
              </div>

              {entries.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  该分类暂无条目，可手动新建二创设定。
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {entries.map((entry) => (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      projectId={project.id}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </main>
  );
}

// ------------------------------------------------------------------
// 渲染辅助
// ------------------------------------------------------------------

type BibleEntryRow = typeof bibleEntries.$inferSelect;

function toEntryDTO(row: BibleEntryRow): BibleEntryDTO | null {
  const kind = bibleKindEnum.safeParse(row.kind);
  if (!kind.success) return null;

  const anchors = z.array(anchorDTOSchema).safeParse(row.anchors ?? []);
  return {
    id: row.id,
    workId: row.workId,
    kind: kind.data,
    name: row.name,
    data: (row.data ?? {}) as Record<string, unknown>,
    anchors: anchors.success ? anchors.data : [],
    confidence: row.confidence,
    origin: row.origin === "user" ? "user" : "extracted",
    editedByUser: row.editedByUser,
  };
}

/** 卡片摘要：按 data 中常见的文本字段取第一条非空值 */
function entrySummary(entry: BibleEntryDTO): string | null {
  const keys = ["content", "summary", "personality", "event", "evolution"];
  for (const key of keys) {
    const value = entry.data[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function EntryCard({
  entry,
  projectId,
}: {
  entry: BibleEntryDTO;
  projectId: number;
}) {
  const summary = entrySummary(entry);

  return (
    <Card className="gap-4 py-4">
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{entry.name}</CardTitle>
          <EditEntryDialog entry={entry} projectId={projectId} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{bibleKindLabels[entry.kind]}</Badge>
          {entry.confidence < 0.7 && (
            <Badge variant="destructive">待确认</Badge>
          )}
          {entry.editedByUser && <Badge variant="outline">已校订</Badge>}
          {entry.origin === "user" && <Badge>二创设定</Badge>}
          <span className="text-xs text-muted-foreground">
            置信度 {entry.confidence.toFixed(2)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {summary && (
          <p className="line-clamp-3 text-sm text-muted-foreground">
            {summary}
          </p>
        )}
        {entry.anchors.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              出处锚点
            </p>
            <div className="flex flex-col items-start gap-1.5">
              {entry.anchors.map((anchor, index) => (
                <AnchorDialog
                  key={`${anchor.chapterSeq}-${index}`}
                  workId={entry.workId}
                  anchor={anchor}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
