CREATE TABLE `ai_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purpose` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_read_tokens` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bible_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`work_id` integer NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`data` text NOT NULL,
	`anchors` text DEFAULT '[]' NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`origin` text DEFAULT 'extracted' NOT NULL,
	`edited_by_user` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `source_works`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `chapters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`work_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`title` text,
	`content` text NOT NULL,
	`char_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `source_works`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ingest_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`work_id` integer NOT NULL,
	`chapter_id` integer,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text,
	`error` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `source_works`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingest_jobs_one_open_summary_per_work` ON `ingest_jobs` (`work_id`) WHERE kind = 'summary' AND status IN ('pending', 'running');--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scene_drafts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scene_node_id` integer NOT NULL,
	`parent_draft_id` integer,
	`content` text NOT NULL,
	`instruction` text NOT NULL,
	`model` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`scene_node_id`) REFERENCES `scene_nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_draft_id`) REFERENCES `scene_drafts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scene_nodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`storyline_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`title` text NOT NULL,
	`pov` text,
	`character_ids` text DEFAULT '[]' NOT NULL,
	`time` text,
	`place` text,
	`beats` text DEFAULT '' NOT NULL,
	`foreshadow_refs` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`storyline_id`) REFERENCES `storylines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `source_works` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`title` text NOT NULL,
	`author` text,
	`ingest_status` text DEFAULT 'idle' NOT NULL,
	`ingest_error` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `storylines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`title` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
