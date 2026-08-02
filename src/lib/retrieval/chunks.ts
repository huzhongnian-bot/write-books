import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import type { RetrievedChunk, RetrievedSummary } from "@/lib/ai/assemble-context";

// 无模型 RAG（docs/specs/generate.md §2.1）：上传时把章节切成块写入
// chapter_chunks FTS5 虚拟表（0003 迁移，drizzle 不建模），生成时按场景
// 显式引用（角色/伏笔/地点/标题）做字级 BM25 检索，命中段落注入 messages。
//
// 中文分词：unicode61 会把整段中文当作一个 token，故索引与查询两侧都用
// spaceCjkChars 给 CJK 逐字加空格，退化为字级检索——角色名/地名等短词
// 以短语匹配命中，BM25 排序。FTS 表读写全部收口在本模块。

// ------------------------------------------------------------------
// 分块
// ------------------------------------------------------------------

/** 单块目标字数：攒够即封块（500 字 ≈ 650–800 token，3 块注入量可控） */
export const CHUNK_TARGET_CHARS = 500;
/** 单段超过此长度时按目标长度硬切（不跨段拼接超长段） */
export const CHUNK_MAX_CHARS = 800;

/** 把一章正文切成若干块：按段落贪心打包，超长段硬切。空内容返回 []。 */
export function chunkChapterText(content: string): string[] {
  const paragraphs = content
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push(current.join("\n"));
    current = [];
    currentLen = 0;
  };

  for (const para of paragraphs) {
    if (para.length > CHUNK_MAX_CHARS) {
      flush();
      for (let i = 0; i < para.length; i += CHUNK_TARGET_CHARS) {
        chunks.push(para.slice(i, i + CHUNK_TARGET_CHARS));
      }
      continue;
    }
    if (currentLen + para.length > CHUNK_TARGET_CHARS && current.length > 0) {
      flush();
    }
    current.push(para);
    currentLen += para.length;
  }
  flush();

  return chunks;
}

// ------------------------------------------------------------------
// CJK 字级分词
// ------------------------------------------------------------------

// CJK 统一表意文字：扩展 A 区 U+3400-4DBF + 基本区 U+4E00-9FFF + 兼容区 U+F900-FAFF（转义写法防编辑器/编码问题）
const CJK_CHAR_REGEX = /[㐀-䶿一-鿿豈-﫿]/g;

/** CJK 字符前后加空格并折叠空白：「第3章abc」→「第 3 章 abc」（拉丁词保持完整） */
export function spaceCjkChars(text: string): string {
  return text.replace(CJK_CHAR_REGEX, " $& ").replace(/\s+/g, " ").trim();
}

// ------------------------------------------------------------------
// 查询构建
// ------------------------------------------------------------------

const MAX_TERMS = 10;

export interface RetrievalTermInput {
  /** scene_nodes.character_ids（json，按 string[] 尽力解析） */
  characterIds: unknown;
  /** scene_nodes.foreshadow_refs（json，同上） */
  foreshadowRefs: unknown;
  place: string | null;
  title: string;
}

function asTermArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/**
 * 检索词 = 显式引用的并集：出场角色 + 伏笔/设定引用 + 地点 + 场景标题。
 * 去重、去短词（<2 字）、上限 MAX_TERMS；顺序即优先级（角色最前）。
 * P1 候选：从 beats 抽取内容词扩充（当前不做，避免噪声淹没精确词）。
 */
export function buildRetrievalTerms(input: RetrievalTermInput): string[] {
  const raw = [
    ...asTermArray(input.characterIds),
    ...asTermArray(input.foreshadowRefs),
    ...(input.place ? [input.place] : []),
    input.title,
  ];

  const seen = new Set<string>();
  const terms: string[] = [];
  for (const item of raw) {
    const term = item.trim();
    if (term.length < 2 || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length >= MAX_TERMS) break;
  }
  return terms;
}

/**
 * 检索词 → FTS5 MATCH 表达式：各词 CJK 逐字加空格后作短语，OR 连接。
 * 双引号会被剥离（防注入截断 phrase）；无可用词时返回 null。
 */
export function buildMatchQuery(terms: string[]): string | null {
  const phrases: string[] = [];
  for (const term of terms) {
    const spaced = spaceCjkChars(term.replace(/"/g, " "));
    if (spaced.length > 0) phrases.push(`"${spaced}"`);
  }
  return phrases.length > 0 ? phrases.join(" OR ") : null;
}

// ------------------------------------------------------------------
// 索引维护（FTS 表无 FK，建/删都由调用方在合适时机显式触发）
// ------------------------------------------------------------------

/** drizzle db / 事务回调参数共用的最小 raw-SQL 执行面 */
interface RawSqlExecutor {
  run(query: SQL): unknown;
}

export interface ChunkSourceChapter {
  seq: number;
  title: string | null;
  content: string;
}

/**
 * 把一部作品的所有章节切块建索引（上传事务内调用，与 chapters 同生共死）。
 * 返回块数。
 */
export function indexWorkChunks(
  executor: RawSqlExecutor,
  workId: number,
  chapterList: ChunkSourceChapter[]
): number {
  let count = 0;
  for (const chapter of chapterList) {
    for (const text of chunkChapterText(chapter.content)) {
      executor.run(sql`
        INSERT INTO chapter_chunks (text, text_spaced, work_id, chapter_seq, chapter_title)
        VALUES (${text}, ${spaceCjkChars(text)}, ${workId}, ${chapter.seq}, ${chapter.title})
      `);
      count++;
    }
  }
  return count;
}

/** 删除项目/作品时随 chapters 一并清理（先子后父顺序中紧挨 chapters） */
export function deleteChunksForWorks(
  executor: RawSqlExecutor,
  workIds: number[]
): void {
  for (const workId of workIds) {
    executor.run(sql`DELETE FROM chapter_chunks WHERE work_id = ${workId}`);
  }
}

// ------------------------------------------------------------------
// 章节概述索引（chapter_summaries FTS 表，两级 RAG 的章节级检索面）
// ------------------------------------------------------------------

export interface SummarySourceChapter {
  seq: number;
  title: string | null;
  summary: string;
}

/**
 * 给单章建/更新概述索引（概述生成落库后调用；先删后插幂等）。
 */
export function indexChapterSummary(
  executor: RawSqlExecutor,
  workId: number,
  chapter: SummarySourceChapter
): void {
  executor.run(
    sql`DELETE FROM chapter_summaries WHERE work_id = ${workId} AND chapter_seq = ${chapter.seq}`
  );
  executor.run(sql`
    INSERT INTO chapter_summaries (summary, summary_spaced, work_id, chapter_seq, chapter_title)
    VALUES (${chapter.summary}, ${spaceCjkChars(chapter.summary)}, ${workId}, ${chapter.seq}, ${chapter.title})
  `);
}

/** 与 deleteChunksForWorks 同生命周期：删除项目/作品时一并清理 */
export function deleteSummariesForWorks(
  executor: RawSqlExecutor,
  workIds: number[]
): void {
  for (const workId of workIds) {
    executor.run(sql`DELETE FROM chapter_summaries WHERE work_id = ${workId}`);
  }
}

// ------------------------------------------------------------------
// 检索
// ------------------------------------------------------------------

/** 单次生成注入的原作段落上限（3 × ~500 字 ≈ 1500 字） */
export const RETRIEVAL_LIMIT = 3;

/** 按检索词在某部作品内做字级 BM25 检索；无可用词时直接返回 []。 */
export function searchChunks(
  workId: number,
  terms: string[],
  limit: number = RETRIEVAL_LIMIT
): RetrievedChunk[] {
  const match = buildMatchQuery(terms);
  if (!match) return [];

  return db.all<RetrievedChunk>(sql`
    SELECT chapter_seq AS chapterSeq, chapter_title AS chapterTitle, text
    FROM chapter_chunks
    WHERE chapter_chunks MATCH ${match} AND work_id = ${workId}
    ORDER BY bm25(chapter_chunks)
    LIMIT ${limit}
  `);
}

// ------------------------------------------------------------------
// 章节概述检索（章节级粗召回：正文未字面命中检索词时由概述兜底）
// ------------------------------------------------------------------

/** 单次生成注入的章节概述上限（概述短，2 条 ≈ 几百字） */
export const SUMMARY_RETRIEVAL_LIMIT = 2;

/** 按检索词在概述索引内做字级 BM25 检索；无可用词时直接返回 []。 */
export function searchSummaries(
  workId: number,
  terms: string[],
  limit: number = SUMMARY_RETRIEVAL_LIMIT
): RetrievedSummary[] {
  const match = buildMatchQuery(terms);
  if (!match) return [];

  return db.all<RetrievedSummary>(sql`
    SELECT chapter_seq AS chapterSeq, chapter_title AS chapterTitle, summary
    FROM chapter_summaries
    WHERE chapter_summaries MATCH ${match} AND work_id = ${workId}
    ORDER BY bm25(chapter_summaries)
    LIMIT ${limit}
  `);
}
