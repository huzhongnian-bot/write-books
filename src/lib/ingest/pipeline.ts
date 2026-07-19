import { eq, and, inArray, lt, count, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  ingestJobs,
  sourceWorks,
  bibleEntries,
  chapters,
  type IngestJob,
  extractChapterResultSchema,
  summaryResultSchema,
  type InsertBibleEntry,
} from "@/lib/db/schema";
import { callStructured } from "@/lib/ai/client";
import {
  EXTRACT_CHAPTER_SYSTEM,
  buildExtractChapterUserPrompt,
} from "@/lib/ai/prompts/extract-chapter";
import {
  SUMMARIZE_ARC_SYSTEM,
  buildSummarizeArcUserPrompt,
} from "@/lib/ai/prompts/summarize-arc";

const EXTRACT_CONCURRENCY = 2;
const RUNNING_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ------------------------------------------------------------------
// Job lifecycle
// ------------------------------------------------------------------

export async function createExtractJobs(workId: number): Promise<void> {
  const chapterList = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(eq(chapters.workId, workId))
    .orderBy(chapters.seq);

  if (chapterList.length === 0) {
    throw new Error(`No chapters found for workId=${workId}`);
  }

  await db
    .update(sourceWorks)
    .set({ ingestStatus: "running", ingestError: null })
    .where(eq(sourceWorks.id, workId));

  await db.insert(ingestJobs).values(
    chapterList.map((chapter) => ({
      workId,
      chapterId: chapter.id,
      kind: "extract" as const,
      status: "pending" as const,
    }))
  );
}

export async function resetTimedOutRunningJobs(workId: number): Promise<void> {
  // Crash recovery: running jobs that already have a result were interrupted
  // after the AI call succeeded; mark them done without re-calling AI.
  await db
    .update(ingestJobs)
    .set({ status: "done", updatedAt: new Date() })
    .where(
      and(
        eq(ingestJobs.workId, workId),
        eq(ingestJobs.status, "running"),
        isNotNull(ingestJobs.result)
      )
    );

  const cutoff = new Date(Date.now() - RUNNING_TIMEOUT_MS);

  await db
    .update(ingestJobs)
    .set({
      status: "failed",
      error: "Timed out while running",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(ingestJobs.workId, workId),
        eq(ingestJobs.status, "running"),
        lt(ingestJobs.updatedAt, cutoff)
      )
    );
}

async function claimPendingJobs(
  workId: number,
  kind: "extract" | "summary",
  limit: number
): Promise<IngestJob[]> {
  const candidates = await db
    .select({ id: ingestJobs.id })
    .from(ingestJobs)
    .where(
      and(
        eq(ingestJobs.workId, workId),
        eq(ingestJobs.kind, kind),
        eq(ingestJobs.status, "pending")
      )
    )
    .orderBy(ingestJobs.id)
    .limit(limit);

  if (candidates.length === 0) return [];

  // Atomic claim (CAS): only rows still 'pending' are flipped, so a concurrent
  // drain that selected the same candidates gets zero rows back and will not
  // double-process (and double-bill) them. better-sqlite3 serializes
  // statements, which makes this UPDATE the single point of mutual exclusion.
  return db
    .update(ingestJobs)
    .set({ status: "running", updatedAt: new Date() })
    .where(
      and(
        inArray(
          ingestJobs.id,
          candidates.map((c) => c.id)
        ),
        eq(ingestJobs.status, "pending")
      )
    )
    .returning();
}

// ------------------------------------------------------------------
// Layer 1: per-chapter extraction
// ------------------------------------------------------------------

async function processExtractJob(job: IngestJob): Promise<void> {
  // Resume: if result already exists (e.g., crash after write), mark done without re-calling AI
  if (job.result) {
    await db
      .update(ingestJobs)
      .set({ status: "done", updatedAt: new Date() })
      .where(eq(ingestJobs.id, job.id));
    return;
  }

  const chapter = await db
    .select()
    .from(chapters)
    .where(eq(chapters.id, job.chapterId!))
    .then((rows) => rows[0]);

  if (!chapter) {
    await markJobFailed(job.id, "Chapter not found");
    return;
  }

  try {
    const result = await callStructured({
      model: "claude-opus-4-8",
      purpose: "extract-chapter",
      system: EXTRACT_CHAPTER_SYSTEM,
      messages: [
        {
          role: "user",
          content: buildExtractChapterUserPrompt(chapter.content),
        },
      ],
      schema: extractChapterResultSchema,
    });

    await db
      .update(ingestJobs)
      .set({
        status: "done",
        result,
        updatedAt: new Date(),
      })
      .where(eq(ingestJobs.id, job.id));
  } catch (err) {
    await markJobFailed(
      job.id,
      err instanceof Error ? err.message : "Unknown extraction error"
    );
  }
}

async function markJobFailed(jobId: number, error: string): Promise<void> {
  await db
    .update(ingestJobs)
    .set({
      status: "failed",
      error,
      attemptCount: sql`${ingestJobs.attemptCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(ingestJobs.id, jobId));
}

// ------------------------------------------------------------------
// Layer 2: entity merge (code-based, exact match only)
// ------------------------------------------------------------------
// NOTE: tech-plan degradation list item #5 is in effect — exact-match dedup,
// no alias table, no haiku adjudication. Recorded 2026-07-18.

type ExtractChapterResult = z.infer<typeof extractChapterResultSchema>;

interface ExtractResultWithSeq {
  seq: number;
  result: ExtractChapterResult;
}

function mergeEntities(
  extractResults: ExtractResultWithSeq[]
): ExtractResultWithSeq[] {
  // P0: simple deduplication pass; aliases and fuzzy matching can be added later
  const seenCharacters = new Set<string>();
  const merged: ExtractResultWithSeq[] = [];

  for (const { seq, result } of extractResults) {
    const uniqueCharacters = result.characters.filter((name: string) => {
      if (seenCharacters.has(name)) return false;
      seenCharacters.add(name);
      return true;
    });

    merged.push({
      seq,
      result: {
        ...result,
        characters: uniqueCharacters,
      },
    });
  }

  return merged;
}

// ------------------------------------------------------------------
// Layer 3: summary -> bible entries
// ------------------------------------------------------------------

async function createSummaryJob(workId: number): Promise<void> {
  await db.insert(ingestJobs).values({
    workId,
    kind: "summary",
    status: "pending",
  });
}

async function processSummaryJob(workId: number): Promise<void> {
  const extractJobsDone = await db
    .select()
    .from(ingestJobs)
    .where(
      and(
        eq(ingestJobs.workId, workId),
        eq(ingestJobs.kind, "extract"),
        eq(ingestJobs.status, "done")
      )
    )
    .orderBy(ingestJobs.id);

  // The summary prompt numbers chapters by chapters.seq, not job id — anchors
  // produced by the model must point at real chapter numbers.
  const chapterSeqById = new Map(
    (
      await db
        .select({ id: chapters.id, seq: chapters.seq })
        .from(chapters)
        .where(eq(chapters.workId, workId))
    ).map((c) => [c.id, c.seq])
  );

  const extractResults: ExtractResultWithSeq[] = extractJobsDone
    .map((job) => {
      const chapterId = job.chapterId;
      const parse = extractChapterResultSchema.safeParse(job.result);
      if (!parse.success || !chapterId) return null;
      const seq = chapterSeqById.get(chapterId);
      if (seq === undefined) return null;
      return { seq, result: parse.data };
    })
    .filter((r): r is ExtractResultWithSeq => r !== null);

  const merged = mergeEntities(extractResults);

  const summary = await callStructured({
    model: "claude-opus-4-8",
    purpose: "summarize-arc",
    system: SUMMARIZE_ARC_SYSTEM,
    messages: [
      {
        role: "user",
        content: buildSummarizeArcUserPrompt(
          merged.map((m) => ({
            seq: m.seq,
            summary: m.result.summary,
            characters: m.result.characters,
            events: m.result.events,
            settingClues: m.result.settingClues,
          }))
        ),
      },
    ],
    schema: summaryResultSchema,
  });

  const summaryJob = await db
    .select()
    .from(ingestJobs)
    .where(
      and(
        eq(ingestJobs.workId, workId),
        eq(ingestJobs.kind, "summary"),
        eq(ingestJobs.status, "running")
      )
    )
    .then((rows) => rows[0]);

  const bibleRows: InsertBibleEntry[] = summary.bibleEntries.map((entry) => ({
    workId,
    kind: entry.kind,
    name: entry.name,
    data: entry.data,
    anchors: entry.anchors,
    confidence: entry.confidence,
  }));

  // 「标 summary done + 写 result」与「插 bible_entries」必须在同一事务：
  // 崩溃在两者之间时，重启后 drainIngest 看到 summary done 会直接置 work
  // done，bible_entries 永久丢失且不重试（docs/reviews/kimi-k3-review.md
  // 缺陷 #1）。事务失败则 job 保持 running 且无 result，超时后由
  // resetTimedOutRunningJobs 标 failed，下次 drain 重建 job 重跑。
  db.transaction((tx) => {
    if (summaryJob) {
      tx.update(ingestJobs)
        .set({ status: "done", result: summary, updatedAt: new Date() })
        .where(eq(ingestJobs.id, summaryJob.id))
        .run();
    }

    if (bibleRows.length > 0) {
      tx.insert(bibleEntries).values(bibleRows).run();
    }
  });
}

// ------------------------------------------------------------------
// Drain orchestration
// ------------------------------------------------------------------

export async function drainIngest(workId: number): Promise<void> {
  await resetTimedOutRunningJobs(workId);

  // Layer 1: drain all extract jobs
  while (true) {
    const jobs = await claimPendingJobs(workId, "extract", EXTRACT_CONCURRENCY);
    if (jobs.length === 0) break;
    await Promise.all(jobs.map((job) => processExtractJob(job)));
  }

  // If any extract failed, stop and mark work failed
  const failedExtractsResult = await db
    .select({ count: count() })
    .from(ingestJobs)
    .where(
      and(
        eq(ingestJobs.workId, workId),
        eq(ingestJobs.kind, "extract"),
        eq(ingestJobs.status, "failed")
      )
    );
  const failedExtracts = failedExtractsResult[0]?.count ?? 0;

  if (failedExtracts > 0) {
    await db
      .update(sourceWorks)
      .set({ ingestStatus: "failed" })
      .where(eq(sourceWorks.id, workId));
    return;
  }

  // Check if summary already exists and is done (resume)
  const existingSummary = await db
    .select()
    .from(ingestJobs)
    .where(
      and(
        eq(ingestJobs.workId, workId),
        eq(ingestJobs.kind, "summary"),
        eq(ingestJobs.status, "done")
      )
    )
    .then((rows) => rows[0]);

  if (existingSummary) {
    await db
      .update(sourceWorks)
      .set({ ingestStatus: "done" })
      .where(eq(sourceWorks.id, workId));
    return;
  }

  // Layer 3: create and drain summary job
  const pendingSummary = await claimPendingJobs(workId, "summary", 1);
  if (pendingSummary.length === 0) {
    await createSummaryJob(workId);
    await claimPendingJobs(workId, "summary", 1);
  }

  await processSummaryJob(workId);

  await db
    .update(sourceWorks)
    .set({ ingestStatus: "done" })
    .where(eq(sourceWorks.id, workId));
}

// ------------------------------------------------------------------
// Status and retry
// ------------------------------------------------------------------

export async function getIngestStatus(workId: number) {
  const work = await db
    .select()
    .from(sourceWorks)
    .where(eq(sourceWorks.id, workId))
    .then((rows) => rows[0]);

  const jobs = await db
    .select()
    .from(ingestJobs)
    .where(eq(ingestJobs.workId, workId))
    .orderBy(ingestJobs.id);

  return {
    workStatus: work?.ingestStatus ?? "idle",
    workError: work?.ingestError,
    jobs: jobs.map((job) => ({
      id: job.id,
      kind: job.kind,
      status: job.status,
      chapterId: job.chapterId,
      error: job.error,
      attemptCount: job.attemptCount,
      hasResult: job.result != null,
    })),
  };
}

export async function retryFailedChapter(
  workId: number,
  chapterId: number
): Promise<void> {
  await db
    .update(ingestJobs)
    .set({
      status: "pending",
      error: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(ingestJobs.workId, workId),
        eq(ingestJobs.chapterId, chapterId),
        eq(ingestJobs.kind, "extract"),
        eq(ingestJobs.status, "failed")
      )
    );

  await db
    .update(sourceWorks)
    .set({ ingestStatus: "running" })
    .where(eq(sourceWorks.id, workId));

  await drainIngest(workId);
}

export async function startIngest(workId: number): Promise<void> {
  await createExtractJobs(workId);
  await drainIngest(workId);
}
