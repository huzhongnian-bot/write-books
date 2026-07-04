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

export const sourceWorkIngestStatusEnum = z.enum([
  "idle",
  "running",
  "done",
  "failed",
]);

export const ingestJobKindEnum = z.enum(["extract", "summary"]);
export const ingestJobStatusEnum = z.enum([
  "pending",
  "running",
  "done",
  "failed",
]);

export const bibleEntryKindEnum = z.enum([
  "setting",
  "character",
  "relationship",
  "plot_arc",
  "timeline_event",
]);

// ------------------------------------------------------------------
// Tables
// ------------------------------------------------------------------

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
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
  ingestStatus: text("ingest_status")
    .notNull()
    .default("idle"),
  ingestError: text("ingest_error"),
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
});

export const ingestJobs = sqliteTable("ingest_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workId: integer("work_id")
    .notNull()
    .references(() => sourceWorks.id),
  chapterId: integer("chapter_id").references(() => chapters.id),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("pending"),
  result: text("result", { mode: "json" }),
  error: text("error"),
  attemptCount: integer("attempt_count").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

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
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ------------------------------------------------------------------
// Structured data schemas (zod) — shared by DB inserts, API validation,
// and AI structured outputs
// ------------------------------------------------------------------

export const anchorSchema = z.object({
  chapterSeq: z.number(),
  quote: z.string(),
});

export const settingDataSchema = z.object({
  type: z.string(),
  content: z.string(),
});

export const characterDataSchema = z.object({
  aliases: z.array(z.string()).default([]),
  personality: z.string(),
  abilities: z.array(z.string()).default([]),
  speechPatternSamples: z.array(z.string()).default([]),
  growthArc: z.string().optional(),
});

export const relationshipDataSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: z.string(),
  evolution: z.string(),
});

export const plotArcDataSchema = z.object({
  arcType: z.enum(["main", "side"]),
  summary: z.string(),
  keyTurningPoints: z.array(z.number()),
});

export const timelineEventDataSchema = z.object({
  time: z.string(),
  event: z.string(),
});

// P0: data column accepts any JSON object; per-kind schemas are used for AI structured outputs and runtime validation
export const bibleEntryDataSchema = z.record(z.string(), z.unknown());

export const extractChapterResultSchema = z.object({
  summary: z.string(),
  characters: z.array(z.string()),
  events: z.array(z.string()),
  settingClues: z.array(z.string()),
});

export const summaryResultSchema = z.object({
  bibleEntries: z.array(
    z.object({
      kind: bibleEntryKindEnum,
      name: z.string(),
      data: z.record(z.string(), z.unknown()),
      anchors: z.array(anchorSchema).default([]),
      confidence: z.number().min(0).max(1),
    })
  ),
});

export const ingestJobResultSchema = z.union([
  extractChapterResultSchema,
  summaryResultSchema,
]);

// ------------------------------------------------------------------
// Derived zod schemas from Drizzle tables
// ------------------------------------------------------------------

export const insertProjectSchema = createInsertSchema(projects);
export const selectProjectSchema = createSelectSchema(projects);

export const insertSourceWorkSchema = createInsertSchema(sourceWorks);
export const selectSourceWorkSchema = createSelectSchema(sourceWorks);

export const insertChapterSchema = createInsertSchema(chapters);
export const selectChapterSchema = createSelectSchema(chapters);

export const insertIngestJobSchema = createInsertSchema(ingestJobs);
export const selectIngestJobSchema = createSelectSchema(ingestJobs);

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

export type IngestJob = typeof ingestJobs.$inferSelect;
export type InsertIngestJob = typeof ingestJobs.$inferInsert;

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
