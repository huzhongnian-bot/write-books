import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chapters, projects, sourceWorks } from "@/lib/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

// 章节概述查看页（docs/specs/ingest.md §2.4）：纯 RSC 只读列表，
// 概述在项目页「生成章节概述/生成所选概述」产生，这里只负责呈现。

export const dynamic = "force-dynamic";

export default async function ChapterSummariesPage({
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

  const chapterRows = work
    ? await db
        .select({
          seq: chapters.seq,
          title: chapters.title,
          summary: chapters.summary,
        })
        .from(chapters)
        .where(eq(chapters.workId, work.id))
        .orderBy(asc(chapters.seq))
    : [];

  const summarizedCount = chapterRows.filter((c) => c.summary !== null).length;

  return (
    <main className="container mx-auto max-w-4xl px-4 py-10">
      <Link
        href={`/projects/${project.id}`}
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        ← 返回项目
      </Link>
      <div className="mt-4">
        <h1 className="text-2xl font-bold tracking-tight">
          《{work?.title ?? project.name}》章节概述
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          已生成 {summarizedCount}/{chapterRows.length}
          章。概述用于章节级检索与 AI 场景草案，在项目页可勾选章节重新生成。
        </p>
      </div>

      {!work ? (
        <p className="mt-8 text-sm text-muted-foreground">
          该项目还没有上传原作。
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {chapterRows.map((chapter, i) => (
            <section key={chapter.seq}>
              {i > 0 && <Separator className="mb-6" />}
              <h2 className="text-base font-semibold">
                第 {chapter.seq} 章{chapter.title ? ` ${chapter.title}` : ""}
              </h2>
              {chapter.summary ? (
                <p className="mt-2 text-sm leading-7 whitespace-pre-wrap">
                  {chapter.summary}
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  （未生成概述）
                </p>
              )}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
