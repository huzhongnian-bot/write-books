-- 章节分块全文检索索引（无模型 RAG，见 docs/specs/generate.md §2.1）。
-- FTS5 虚拟表无法由 drizzle schema 建模，故本迁移为手写 SQL；
-- 所有读写收口在 src/lib/retrieval/chunks.ts。
-- text_spaced 是唯一索引列：unicode61 会把整段中文当作一个 token，
-- 建索引与查询时对 CJK 字符逐字加空格（spaceCjkChars），退化为字级 BM25。
CREATE VIRTUAL TABLE `chapter_chunks` USING fts5(
  `text` UNINDEXED,
  `text_spaced`,
  `work_id` UNINDEXED,
  `chapter_seq` UNINDEXED,
  `chapter_title` UNINDEXED,
  tokenize='unicode61'
);
