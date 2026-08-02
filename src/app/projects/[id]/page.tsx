import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chapters, projects, sourceWorks } from "@/lib/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { SummarizePanel } from "./summarize-panel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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

  const chapterRows = work
    ? await db
        .select({
          seq: chapters.seq,
          title: chapters.title,
          charCount: chapters.charCount,
          summary: chapters.summary,
        })
        .from(chapters)
        .where(eq(chapters.workId, work.id))
        .orderBy(asc(chapters.seq))
    : [];

  const totalChars = chapterRows.reduce((sum, c) => sum + c.charCount, 0);
  const summarizedCount = chapterRows.filter((c) => c.summary !== null).length;

  return (
    <main className="container mx-auto max-w-4xl px-4 py-10">
      <Link
        href="/projects"
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        ← 返回项目列表
      </Link>
      <div className="mt-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
        {work && (
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={`/projects/${project.id}/summaries`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              章节概述
            </Link>
            <Link
              href={`/projects/${project.id}/bible`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              原作百科
            </Link>
            <Link
              href={`/projects/${project.id}/script`}
              className={buttonVariants({ size: "sm" })}
            >
              去编脚本 →
            </Link>
          </div>
        )}
      </div>

      {!work ? (
        <p className="mt-8 text-sm text-muted-foreground">
          该项目还没有上传原作。
        </p>
      ) : (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">《{work.title}》章节切分</CardTitle>
            <CardDescription>
              共 {chapterRows.length} 章，约{" "}
              {totalChars.toLocaleString("zh-CN")} 字。生成时按场景关键词从
              这些章节检索原作段落；切分不符合预期时请调整原文后重新上传。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SummarizePanel
              workId={work.id}
              summarized={summarizedCount}
              chapters={chapterRows.map((c) => ({
                seq: c.seq,
                title: c.title,
                charCount: c.charCount,
                hasSummary: c.summary !== null,
              }))}
            />
          </CardContent>
        </Card>
      )}
    </main>
  );
}
