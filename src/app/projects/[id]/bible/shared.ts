import { z } from "zod";

// ------------------------------------------------------------------
// 百科条目分类（取值与 src/lib/db/schema.ts 的 bibleEntryKindEnum 保持一致；
// 单独声明以避免把 drizzle 依赖打进 client bundle）
// ------------------------------------------------------------------

export const bibleKinds = [
  "setting",
  "character",
  "relationship",
  "plot_arc",
  "timeline_event",
] as const;

export type BibleKind = (typeof bibleKinds)[number];

export const bibleKindEnum = z.enum(bibleKinds);

export const bibleKindLabels: Record<BibleKind, string> = {
  setting: "设定",
  character: "角色",
  relationship: "关系",
  plot_arc: "剧情弧",
  timeline_event: "时间线",
};

// ------------------------------------------------------------------
// 跨 RSC / client 边界传递的 DTO（必须可序列化）
// ------------------------------------------------------------------

export const anchorDTOSchema = z.object({
  chapterSeq: z.number(),
  quote: z.string(),
});
export type AnchorDTO = z.infer<typeof anchorDTOSchema>;

export interface BibleEntryDTO {
  id: number;
  workId: number;
  kind: BibleKind;
  name: string;
  data: Record<string, unknown>;
  anchors: AnchorDTO[];
  confidence: number;
  origin: "extracted" | "user";
  editedByUser: boolean;
}

export interface ChapterExcerpt {
  title: string | null;
  content: string;
}

// ------------------------------------------------------------------
// Server Action 输入校验
// ------------------------------------------------------------------

export const entryNameSchema = z
  .string()
  .trim()
  .min(1, "名称不能为空")
  .max(200, "名称过长");

export const entryConfidenceSchema = z
  .number()
  .min(0, "置信度需在 0–1 之间")
  .max(1, "置信度需在 0–1 之间");

// P0：data 列接受任意 JSON 对象（见 schema.ts 注释）
export const entryDataSchema = z.record(z.string(), z.unknown());

export const updateBibleEntryInputSchema = z.object({
  entryId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  name: entryNameSchema,
  confidence: entryConfidenceSchema,
  data: entryDataSchema,
});

export const createBibleEntryInputSchema = z.object({
  projectId: z.number().int().positive(),
  workId: z.number().int().positive(),
  kind: bibleKindEnum,
  name: entryNameSchema,
  confidence: entryConfidenceSchema,
  data: entryDataSchema,
});

export type ActionResult = { ok: true } | { ok: false; error: string };

// ------------------------------------------------------------------
// 表单辅助（character 结构化字段 / 其余 kind 的 JSON 直改）
// ------------------------------------------------------------------

/** 逗号（中英文）或换行分隔的输入 → string[] */
export function splitList(input: string): string[] {
  return input
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface CharacterFormFields {
  aliases: string;
  personality: string;
  abilities: string;
  speechPatternSamples: string;
  growthArc: string;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

export function characterDataToFields(
  data: Record<string, unknown>
): CharacterFormFields {
  return {
    aliases: asStringArray(data.aliases).join("，"),
    personality: typeof data.personality === "string" ? data.personality : "",
    abilities: asStringArray(data.abilities).join("，"),
    speechPatternSamples: asStringArray(data.speechPatternSamples).join("，"),
    growthArc: typeof data.growthArc === "string" ? data.growthArc : "",
  };
}

export function characterFieldsToData(
  fields: CharacterFormFields
): Record<string, unknown> {
  return {
    aliases: splitList(fields.aliases),
    personality: fields.personality.trim(),
    abilities: splitList(fields.abilities),
    speechPatternSamples: splitList(fields.speechPatternSamples),
    ...(fields.growthArc.trim() ? { growthArc: fields.growthArc.trim() } : {}),
  };
}

/** 非 character 分类新建时的 JSON 模板；character 走结构化表单，返回空串 */
export function dataTemplateForKind(kind: BibleKind): string {
  switch (kind) {
    case "setting":
      return JSON.stringify({ type: "", content: "" }, null, 2);
    case "relationship":
      return JSON.stringify(
        { source: "", target: "", type: "", evolution: "" },
        null,
        2
      );
    case "plot_arc":
      return JSON.stringify(
        { arcType: "main", summary: "", keyTurningPoints: [] },
        null,
        2
      );
    case "timeline_event":
      return JSON.stringify({ time: "", event: "" }, null, 2);
    case "character":
      return "";
  }
}
