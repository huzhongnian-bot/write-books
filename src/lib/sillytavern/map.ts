import type { BibleEntry } from "@/lib/db/schema";

// SillyTavern 导出映射层（docs/specs/sillytavern.md §2）：bible 条目 →
// ST 世界书（lorebook）/ charaCard V2 角色卡。纯函数、无 DB 无网络，
// data 列是用户可 JSON 直改的宽松形状，全部防御式读取。

const CONTENT_MAX_CHARS = 500;
const COMMENT_MAX_CHARS = 200;

const KIND_LABEL: Record<string, string> = {
  character: "角色",
  setting: "设定",
  relationship: "关系",
  plot_arc: "情节线",
  timeline_event: "时间线",
};

function asRecord(data: unknown): Record<string, unknown> {
  return data !== null && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "")
    : [];
}

/** 句读处截断：优先在 max 前的最后一个句末标点/换行断开，避免半句 */
export function truncateAtSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const window = text.slice(0, max);
  const cut = Math.max(
    window.lastIndexOf("。"),
    window.lastIndexOf("！"),
    window.lastIndexOf("？"),
    window.lastIndexOf("\n")
  );
  return cut > 0 ? window.slice(0, cut + 1) : window;
}

/** 条目内容渲染：character 结构化分段，其余 kind 按 data 键值逐行拼接 */
export function renderEntryContent(entry: BibleEntry): string {
  const data = asRecord(entry.data);
  const label = KIND_LABEL[entry.kind] ?? entry.kind;
  const lines: string[] = [`【${label}】${entry.name}`];

  if (entry.kind === "character") {
    const personality = typeof data.personality === "string" ? data.personality : "";
    const growthArc = typeof data.growthArc === "string" ? data.growthArc : "";
    const abilities = asStringArray(data.abilities);
    const samples = asStringArray(data.speechPatternSamples);
    if (personality) lines.push(`性格：${personality}`);
    if (abilities.length) lines.push(`能力：${abilities.join("，")}`);
    if (samples.length) lines.push(`口吻：${samples.join("；")}`);
    if (growthArc) lines.push(`成长线：${growthArc}`);
  } else {
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "string" && value.trim()) {
        lines.push(`${key}：${value}`);
      } else if (Array.isArray(value)) {
        const items = asStringArray(value);
        if (items.length) lines.push(`${key}：${items.join("，")}`);
      } else if (typeof value === "number") {
        lines.push(`${key}：${value}`);
      }
    }
  }
  return truncateAtSentence(lines.join("\n"), CONTENT_MAX_CHARS);
}

type Anchor = { chapterSeq?: unknown; quote?: unknown };

function renderComment(anchors: unknown): string {
  const list = Array.isArray(anchors) ? (anchors as Anchor[]) : [];
  const parts = list
    .filter((a) => typeof a?.chapterSeq === "number")
    .map((a) => {
      const quote = typeof a.quote === "string" ? `「${a.quote}」` : "";
      return `出自第 ${a.chapterSeq} 章${quote}`;
    });
  return truncateAtSentence(parts.join("；"), COMMENT_MAX_CHARS);
}

// ------------------------------------------------------------------
// ST 世界书（World Info / lorebook）
// ------------------------------------------------------------------

export interface StLorebookEntry {
  uid: number;
  key: string[];
  keysecondary: string[];
  comment: string;
  content: string;
  constant: boolean;
  selective: boolean;
  order: number;
  position: number;
  disable: boolean;
  excludeRecursion: boolean;
  probability: number;
  useProbability: boolean;
  depth: number;
  group: string;
}

/** 单条 bible 条目 → lorebook entry。触发词 = 名称 + character 别名 */
export function bibleEntryToLorebookEntry(
  entry: BibleEntry,
  uid: number
): StLorebookEntry {
  const data = asRecord(entry.data);
  const aliases =
    entry.kind === "character" ? asStringArray(data.aliases) : [];
  return {
    uid,
    key: [entry.name, ...aliases],
    keysecondary: [],
    comment: renderComment(entry.anchors),
    content: renderEntryContent(entry),
    constant: false,
    selective: false,
    order: 100,
    position: 0,
    disable: false,
    excludeRecursion: false,
    probability: 100,
    useProbability: false,
    depth: 4,
    group: "",
  };
}

/** 整本百科 → ST 世界书文件（entries 的 key 是 uid 的数字字符串） */
export function buildLorebook(entries: BibleEntry[]): {
  entries: Record<string, StLorebookEntry>;
} {
  const record: Record<string, StLorebookEntry> = {};
  entries.forEach((entry, i) => {
    record[String(i)] = bibleEntryToLorebookEntry(entry, i);
  });
  return { entries: record };
}

// ------------------------------------------------------------------
// charaCard V2 角色卡
// ------------------------------------------------------------------

export interface StCharaCard {
  spec: "chara_card_v2";
  spec_version: "2.0";
  data: {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    first_mes: string;
    mes_example: string;
    creator_notes: string;
    system_prompt: string;
    post_history_instructions: string;
    alternate_greetings: string[];
    tags: string[];
    creator: string;
    character_version: string;
    extensions: Record<string, unknown>;
  };
}

/**
 * character 条目 → charaCard V2。零 AI 原则：first_mes 取既有口吻样例，
 * 不足给静态占位（TODO: specs/sillytavern.md §2.2，评估后再定是否 AI 生成）；
 * mes_example 只渲染角色自身样例，不编造 {{user}} 回合。
 */
export function bibleEntryToCharaCard(
  entry: BibleEntry,
  workTitle: string
): StCharaCard {
  const data = asRecord(entry.data);
  const personality = typeof data.personality === "string" ? data.personality : "";
  const growthArc = typeof data.growthArc === "string" ? data.growthArc : "";
  const abilities = asStringArray(data.abilities);
  const samples = asStringArray(data.speechPatternSamples);

  const descLines = [personality && `性格：${personality}`]
    .concat(abilities.length ? [`能力：${abilities.join("，")}`] : [])
    .concat(growthArc ? [`成长线：${growthArc}`] : [])
    .filter(Boolean) as string[];

  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: entry.name,
      description: descLines.join("\n"),
      personality,
      scenario: "",
      first_mes:
        samples[0] ??
        `（${entry.name} 的开场白待补充：在 write-books 百科完善口吻样例后重新导出）`,
      mes_example: samples.length
        ? `<START>\n${samples.map((s) => `{{char}}: ${s}`).join("\n")}`
        : "",
      creator_notes: `由 write-books 导出自《${workTitle}》`,
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: [],
      tags: [],
      creator: "write-books",
      character_version: "1.0",
      extensions: {},
    },
  };
}
