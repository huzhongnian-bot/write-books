import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chapters, projects, sourceWorks } from "@/lib/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { IngestProgress } from "./ingest-progress";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
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
    .then((rows) => rows[0]);

  return (
    <main className="container mx-auto max-w-4xl px-4 py-10">
      <Link
        href="/projects"
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        ← 返回项目列表
      </Link>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">{project.name}</h1>

      {!work ? (
        <p className="mt-8 text-sm text-muted-foreground">
          该项目还没有上传原作。
        </p>
      ) : (
        <WorkProgress workId={work.id} workTitle={work.title} />
      )}
    </main>
  );
}

async function WorkProgress({
  workId,
  workTitle,
}: {
  workId: number;
  workTitle: string;
}) {
  const chapterRows = await db
    .select({
      id: chapters.id,
      seq: chapters.seq,
      title: chapters.title,
      charCount: chapters.charCount,
    })
    .from(chapters)
    .where(eq(chapters.workId, workId))
    .orderBy(asc(chapters.seq));

  const totalChars = chapterRows.reduce((sum, c) => sum + c.charCount, 0);

  return (
    <IngestProgress
      workId={workId}
      workTitle={workTitle}
      chapters={chapterRows.map((c) => ({
        id: c.id,
        seq: c.seq,
        title: c.title,
      }))}
      totalChars={totalChars}
    />
  );
}
