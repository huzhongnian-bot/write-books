import {
  sqliteTable,
  text,
  integer,
  real,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

// ------------------------------------------------------------------
// Enums (stored as text, validated with zod)
// ------------------------------------------------------------------

export const bibleEntryKindEnum = z.enum([
  "setting",
  "character",
  "relationship",
  "plot_arc",
  "timeline_event",
]);

// 纯 RAG 摄取（2026-07-29）后不再产生 extracted 条目，但旧库可能存有
// 抽取时代的条目，枚举保持两值；editedByUser 的校订语义见 docs/specs/bible.md
export const bibleEntryOriginEnum = z.enum(["extracted", "user"]);

// 项目皮肤主题（文学题材换肤，见 docs/specs/theme.md）：
// default=不换肤，其余五套对应 校园/西方幻想/东方武侠/都市/星际科幻。
// 新增主题须三处同步：本枚举、globals.css 的 [data-theme] token 块、
// src/lib/themes.ts 的 PROJECT_THEME_OPTIONS。
export const projectThemeEnum = z.enum([
  "default",
  "campus",
  "western",
  "eastern",
  "urban",
  "scifi",
]);

// ------------------------------------------------------------------
// Tables
// ------------------------------------------------------------------

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // 文学题材皮肤（projectThemeEnum），项目工作区（detail/bible/script/write）按此换肤
  theme: text("theme").notNull().default("default"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const sourceWorks = sqliteTable("source_works", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  title: text("title").notNull(),
  author: text("author"),
});

export const chapters = sqliteTable("chapters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workId: integer("work_id")
    .notNull()
    .references(() => sourceWorks.id),
  seq: integer("seq").notNull(),
  title: text("title"),
  content: text("content").notNull(),
  charCount: integer("char_count").notNull().default(0),
  // AI 章节概述（可选，上传后按需生成，docs/specs/ingest.md §2.4）：
  // 两级 RAG 的章节级检索面 + 脚本草案输入 + 生成前情注入
  summary: text("summary"),
});

// 章节分块检索索引 chapter_chunks 是 FTS5 虚拟表（drizzle 不建模），
// 见 drizzle/0003_chapter_chunks.sql 与 src/lib/retrieval/chunks.ts。
// 章节概述检索索引 chapter_summaries 同为 FTS5 虚拟表，
// 见 drizzle/0006_chapter_summaries.sql 与 src/lib/retrieval/chunks.ts。

export const bibleEntries = sqliteTable("bible_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workId: integer("work_id")
    .notNull()
    .references(() => sourceWorks.id),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  data: text("data", { mode: "json" }).notNull(),
  anchors: text("anchors", { mode: "json" }).notNull().default("[]"),
  confidence: real("confidence").notNull().default(0),
  origin: text("origin").notNull().default("extracted"),
  editedByUser: integer("edited_by_user", { mode: "boolean" })
    .notNull()
    .default(false),
});

export const storylines = sqliteTable("storylines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  title: text("title").notNull(),
});

export const sceneNodes = sqliteTable("scene_nodes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  storylineId: integer("storyline_id")
    .notNull()
    .references(() => storylines.id),
  seq: integer("seq").notNull(),
  title: text("title").notNull(),
  pov: text("pov"),
  characterIds: text("character_ids", { mode: "json" })
    .notNull()
    .default("[]"),
  time: text("time"),
  place: text("place"),
  beats: text("beats").notNull().default(""),
  foreshadowRefs: text("foreshadow_refs", { mode: "json" })
    .notNull()
    .default("[]"),
});

export const sceneDrafts = sqliteTable("scene_drafts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sceneNodeId: integer("scene_node_id")
    .notNull()
    .references(() => sceneNodes.id),
  parentDraftId: integer("parent_draft_id").references(
    (): AnySQLiteColumn => sceneDrafts.id
  ),
  content: text("content").notNull(),
  instruction: text("instruction").notNull(),
  model: text("model").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const aiCalls = sqliteTable("ai_calls", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  purpose: text("purpose").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cacheReadTokens: integer("cache_read_tokens"),
  // 失败埋点：调用失败时记录分类后的可读原因（成功调用为 null，tokens 反向留空）
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ------------------------------------------------------------------
// Derived zod schemas from Drizzle tables
// ------------------------------------------------------------------

export const insertProjectSchema = createInsertSchema(projects);
export const selectProjectSchema = createSelectSchema(projects);

export const insertSourceWorkSchema = createInsertSchema(sourceWorks);
export const selectSourceWorkSchema = createSelectSchema(sourceWorks);

export const insertChapterSchema = createInsertSchema(chapters);
export const selectChapterSchema = createSelectSchema(chapters);

export const insertBibleEntrySchema = createInsertSchema(bibleEntries);
export const selectBibleEntrySchema = createSelectSchema(bibleEntries);

export const insertStorylineSchema = createInsertSchema(storylines);
export const selectStorylineSchema = createSelectSchema(storylines);

export const insertSceneNodeSchema = createInsertSchema(sceneNodes);
export const selectSceneNodeSchema = createSelectSchema(sceneNodes);

export const insertSceneDraftSchema = createInsertSchema(sceneDrafts);
export const selectSceneDraftSchema = createSelectSchema(sceneDrafts);

export const insertAiCallSchema = createInsertSchema(aiCalls);
export const selectAiCallSchema = createSelectSchema(aiCalls);

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

export type SourceWork = typeof sourceWorks.$inferSelect;
export type InsertSourceWork = typeof sourceWorks.$inferInsert;

export type Chapter = typeof chapters.$inferSelect;
export type InsertChapter = typeof chapters.$inferInsert;

export type BibleEntry = typeof bibleEntries.$inferSelect;
export type InsertBibleEntry = typeof bibleEntries.$inferInsert;

export type Storyline = typeof storylines.$inferSelect;
export type InsertStoryline = typeof storylines.$inferInsert;

export type SceneNode = typeof sceneNodes.$inferSelect;
export type InsertSceneNode = typeof sceneNodes.$inferInsert;

export type SceneDraft = typeof sceneDrafts.$inferSelect;
export type InsertSceneDraft = typeof sceneDrafts.$inferInsert;

export type AiCall = typeof aiCalls.$inferSelect;
export type InsertAiCall = typeof aiCalls.$inferInsert;
