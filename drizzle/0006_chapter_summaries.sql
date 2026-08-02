-- 章节概述全文检索索引（两级 RAG 的章节级检索面，见 docs/specs/ingest.md §2.4）。
-- FTS5 虚拟表无法由 drizzle schema 建模，故本迁移为手写 SQL；
-- 所有读写收口在 src/lib/retrieval/chunks.ts。
-- summary_spaced 是唯一索引列：与 chapter_chunks 相同的 CJK 逐字空格策略。
CREATE VIRTUAL TABLE `chapter_summaries` USING fts5(
  `summary` UNINDEXED,
  `summary_spaced`,
  `work_id` UNINDEXED,
  `chapter_seq` UNINDEXED,
  `chapter_title` UNINDEXED,
  tokenize='unicode61'
);
