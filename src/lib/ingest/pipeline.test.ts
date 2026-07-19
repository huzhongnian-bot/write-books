import { describe, it, expect, beforeEach } from "vitest";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  projects,
  sourceWorks,
  chapters,
  ingestJobs,
  bibleEntries,
  sceneDrafts,
  sceneNodes,
  storylines,
} from "@/lib/db/schema";
import {
  startIngest,
  drainIngest,
  retryFailedChapter,
  getIngestStatus,
} from "./pipeline";

async function createFixtureWork() {
  const [project] = await db
    .insert(projects)
    .values({ name: "Pipeline Test" })
    .returning();

  const [work] = await db
    .insert(sourceWorks)
    .values({
      projectId: project.id,
      title: "测试小说",
      author: "测试作者",
      ingestStatus: "idle",
    })
    .returning();

  const chapterList = await db
    .insert(chapters)
    .values([
      {
        workId: work.id,
        seq: 1,
        title: "第1回 测试开篇",
        content:
          "第1回 测试开篇\n\n话说天地间有一块奇石，受日月精华，化作一只石猴。\n",
        charCount: 30,
      },
      {
        workId: work.id,
        seq: 2,
        title: "第2回 拜师学艺",
        content:
          "第2回 拜师学艺\n\n石猴远渡重洋，访遍名山大川，终于拜得菩提祖师为师。\n",
        charCount: 30,
      },
    ])
    .returning();

  return { project, work, chapters: chapterList };
}

describe("ingest pipeline (MOCK_AI=1)", () => {
  beforeEach(async () => {
    // Delete in reverse dependency order
    await db.delete(sceneDrafts);
    await db.delete(sceneNodes);
    await db.delete(storylines);
    await db.delete(bibleEntries);
    await db.delete(ingestJobs);
    await db.delete(chapters);
    await db.delete(sourceWorks);
    await db.delete(projects);
  });

  it("runs full ingest flow and creates bible entries", async () => {
    const { work } = await createFixtureWork();

    await startIngest(work.id);

    const status = await getIngestStatus(work.id);
    expect(status.workStatus).toBe("done");

    const entries = await db
      .select()
      .from(bibleEntries)
      .where(eq(bibleEntries.workId, work.id));
    expect(entries.length).toBeGreaterThan(0);
  });

  it("retries a failed chapter and completes", async () => {
    const { work, chapters } = await createFixtureWork();

    await startIngest(work.id);

    // Simulate one chapter failing
    const targetChapter = chapters[0];
    await db
      .update(ingestJobs)
      .set({ status: "failed", error: "mock failure" })
      .where(
        and(
          eq(ingestJobs.workId, work.id),
          eq(ingestJobs.chapterId, targetChapter.id)
        )
      );

    await db
      .update(sourceWorks)
      .set({ ingestStatus: "failed" })
      .where(eq(sourceWorks.id, work.id));

    await retryFailedChapter(work.id, targetChapter.id);

    const status = await getIngestStatus(work.id);
    expect(status.workStatus).toBe("done");

    const failedJobs = status.jobs.filter((j) => j.status === "failed");
    expect(failedJobs).toHaveLength(0);
  });

  it("does not duplicate bible entries when drain runs again", async () => {
    const { work } = await createFixtureWork();

    await startIngest(work.id);
    const before = await db
      .select()
      .from(bibleEntries)
      .where(eq(bibleEntries.workId, work.id));
    expect(before.length).toBeGreaterThan(0);

    // summary 已 done 后再次 drain 应走 resume 分支，不重跑汇总、不重插 bible
    await drainIngest(work.id);

    const after = await db
      .select()
      .from(bibleEntries)
      .where(eq(bibleEntries.workId, work.id));
    expect(after).toHaveLength(before.length);
  });

  it("resumes from existing results without re-calling AI", async () => {
    const { work, chapters } = await createFixtureWork();

    await startIngest(work.id);

    // Simulate crash: running job with result already written
    const targetChapter = chapters[0];
    await db
      .update(ingestJobs)
      .set({
        status: "running",
        result: {
          summary: "已存在的结果",
          characters: ["石猴"],
          events: ["石化"],
          settingClues: ["花果山"],
        },
      })
      .where(
        and(
          eq(ingestJobs.workId, work.id),
          eq(ingestJobs.chapterId, targetChapter.id)
        )
      );

    await db
      .update(sourceWorks)
      .set({ ingestStatus: "running" })
      .where(eq(sourceWorks.id, work.id));

    // Re-run drain; it should mark the running job as done without AI call
    await drainIngest(work.id);

    const status = await getIngestStatus(work.id);
    expect(status.workStatus).toBe("done");

    const resumedJob = status.jobs.find((j) => j.chapterId === targetChapter.id);
    expect(resumedJob?.status).toBe("done");
    expect(resumedJob?.hasResult).toBe(true);
  });
});


