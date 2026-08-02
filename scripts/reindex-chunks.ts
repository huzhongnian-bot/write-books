import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chapters, sourceWorks } from "@/lib/db/schema";
import {
  deleteChunksForWorks,
  deleteSummariesForWorks,
  indexChapterSummary,
  indexWorkChunks,
} from "@/lib/retrieval/chunks";

// 从 chapters 重建 chapter_chunks + chapter_summaries（FTS 索引）。用于：
// - 分块索引功能上线前上传的旧作品补建索引（旧数据 chunks 缺失，RAG 检索永远空集）
// - 分块策略/分词策略调整后全量重建
// 用法：npm run db:reindex [workId]（缺省重建全部作品；幂等，先删后建）
// better-sqlite3 事务回调必须同步（.run()/.all() 终结）。

const workIdArg = process.argv[2];
const onlyWorkId = workIdArg !== undefined ? Number(workIdArg) : null;
if (onlyWorkId !== null && (!Number.isInteger(onlyWorkId) || onlyWorkId <= 0)) {
  console.error(`无效的 workId: ${workIdArg}`);
  process.exit(1);
}

const works = db
  .select()
  .from(sourceWorks)
  .where(onlyWorkId !== null ? eq(sourceWorks.id, onlyWorkId) : undefined)
  .orderBy(asc(sourceWorks.id))
  .all();

if (works.length === 0) {
  console.log(onlyWorkId !== null ? `作品 ${onlyWorkId} 不存在` : "没有作品");
  process.exit(0);
}

for (const work of works) {
  const chapterList = db
    .select()
    .from(chapters)
    .where(eq(chapters.workId, work.id))
    .orderBy(asc(chapters.seq))
    .all();

  const counts = db.transaction((tx) => {
    deleteChunksForWorks(tx, [work.id]);
    deleteSummariesForWorks(tx, [work.id]);
    const chunkCount = indexWorkChunks(tx, work.id, chapterList);
    let summaryCount = 0;
    for (const chapter of chapterList) {
      if (chapter.summary) {
        indexChapterSummary(tx, work.id, {
          seq: chapter.seq,
          title: chapter.title,
          summary: chapter.summary,
        });
        summaryCount++;
      }
    }
    return { chunkCount, summaryCount };
  });

  console.log(
    `work ${work.id}「${work.title}」: ${chapterList.length} 章 → ${counts.chunkCount} 块 + ${counts.summaryCount} 条概述索引`
  );
}
