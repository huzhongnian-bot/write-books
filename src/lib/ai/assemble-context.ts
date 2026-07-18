import type { BibleEntry, SceneNode, SceneDraft } from "@/lib/db/schema";
import type { AiMessage } from "./client";
import { GENERATE_SCENE_SYSTEM } from "./prompts/generate-scene";

// Spec: docs/specs/generate.md §2.1 — pure function, no I/O, deterministic.
// The system prompt is the single stable cache prefix: frozen writing rules +
// compact bible core. It must never contain timestamps or random ids.

export type GenerateMode = "instruct" | "continue" | "rewrite";

export interface PriorScene {
  node: SceneNode;
  currentDraft: SceneDraft | null;
}

export interface AssembleContextInput {
  bibleEntries: BibleEntry[];
  sceneNode: SceneNode;
  /** Latest draft of THIS scene node (base for continue/rewrite). */
  currentDraft: SceneDraft | null;
  /** Earlier scene nodes of the storyline, ordered by seq ascending. */
  priorScenes: PriorScene[];
  mode: GenerateMode;
  instruction: string;
  /** Explicit base draft for rewrite mode; defaults to currentDraft. */
  baseDraft?: SceneDraft | null;
}

export interface AssembledContext {
  system: string;
  messages: AiMessage[];
}

const KIND_LABELS: Record<string, string> = {
  setting: "设定",
  character: "角色",
  relationship: "关系",
  plot_arc: "情节线",
  timeline_event: "时间线",
};

const PRIOR_TEXT_TOTAL_CAP = 6000;

function isUserSetting(entry: BibleEntry): boolean {
  return entry.origin === "user" || entry.editedByUser;
}

function asRecord(data: unknown): Record<string, unknown> {
  return (data ?? {}) as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/** One-line compact rendering for the stable system prefix. */
function renderEntryCompact(entry: BibleEntry): string {
  const d = asRecord(entry.data);
  const userMark = isUserSetting(entry) ? "【用户设定·优先】" : "";
  switch (entry.kind) {
    case "character":
      return `${userMark}${entry.name}：性格 ${d.personality ?? ""}；能力 ${asStringArray(d.abilities).join("、")}`;
    case "setting":
      return `${userMark}${entry.name}（${d.type ?? "设定"}）：${d.content ?? ""}`;
    case "relationship":
      return `${userMark}${d.source ?? ""} → ${d.target ?? ""}（${d.type ?? ""}）：${d.evolution ?? ""}`;
    case "plot_arc":
      return `${userMark}${entry.name}（${d.arcType === "main" ? "主线" : "支线"}）：${d.summary ?? ""}`;
    case "timeline_event":
      return `${userMark}${d.time ?? ""}：${d.event ?? ""}`;
    default:
      return `${userMark}${entry.name}`;
  }
}

/** Full rendering for the dynamic per-scene section (includes speech samples). */
function renderCharacterFull(entry: BibleEntry): string {
  const d = asRecord(entry.data);
  const lines = [
    `《${entry.name}》${isUserSetting(entry) ? "（用户设定，优先级高于原作抽取内容）" : ""}`,
  ];
  const aliases = asStringArray(d.aliases);
  if (aliases.length > 0) lines.push(`别名：${aliases.join("、")}`);
  if (d.personality) lines.push(`性格：${d.personality}`);
  const abilities = asStringArray(d.abilities);
  if (abilities.length > 0) lines.push(`能力：${abilities.join("、")}`);
  const samples = asStringArray(d.speechPatternSamples);
  if (samples.length > 0) {
    lines.push(`口吻样例：${samples.map((s) => `「${s}」`).join(" ")}`);
  }
  if (d.growthArc) lines.push(`成长弧线：${d.growthArc}`);
  return lines.join("\n");
}

function buildSystem(bibleEntries: BibleEntry[]): string {
  const parts = [GENERATE_SCENE_SYSTEM];

  if (bibleEntries.length > 0) {
    const byKind = new Map<string, BibleEntry[]>();
    for (const entry of bibleEntries) {
      const list = byKind.get(entry.kind) ?? [];
      list.push(entry);
      byKind.set(entry.kind, list);
    }

    const sections: string[] = [];
    for (const [kind, entries] of byKind) {
      const label = KIND_LABELS[kind] ?? kind;
      sections.push(
        `【${label}】\n${entries.map(renderEntryCompact).join("\n")}`
      );
    }

    parts.push(
      `# 原作百科（含用户设定，标注「用户设定·优先」的条目与原作冲突时以用户设定为准）\n${sections.join("\n\n")}`
    );
  }

  return parts.join("\n\n");
}

function buildPriorText(priorScenes: PriorScene[]): string {
  // Newest first, full text for the most recent draft; older ones are
  // truncated (tail kept) so the total stays within the cap. Spec §2.1.
  const withDrafts = priorScenes.filter((p) => p.currentDraft);
  const latest = withDrafts[withDrafts.length - 1];
  const older = withDrafts[withDrafts.length - 2];

  const sections: string[] = [];
  let remaining = PRIOR_TEXT_TOTAL_CAP;

  if (latest?.currentDraft) {
    sections.push(
      `## 前文（最近场景：${latest.node.title}）\n${latest.currentDraft.content}`
    );
    remaining -= latest.currentDraft.content.length;
  }

  if (older?.currentDraft && remaining > 0) {
    let content = older.currentDraft.content;
    if (content.length > remaining) {
      content = `……（前文截断）${content.slice(-remaining)}`;
    }
    sections.push(
      `## 前文（更早场景：${older.node.title}）\n${content}`
    );
  }

  return sections.join("\n\n");
}

export function assembleContext(
  input: AssembleContextInput
): AssembledContext {
  const system = buildSystem(input.bibleEntries);

  const characterIds = asStringArray(input.sceneNode.characterIds);
  const foreshadowRefs = asStringArray(input.sceneNode.foreshadowRefs);

  const characters = characterIds.map((name) => {
    const entry = input.bibleEntries.find(
      (e) => e.kind === "character" && e.name === name
    );
    return entry
      ? renderCharacterFull(entry)
      : `《${name}》（百科中无此角色条目）`;
  });

  const foreshadows = foreshadowRefs.map((name) => {
    const entry = input.bibleEntries.find((e) => e.name === name);
    return entry ? renderEntryCompact(entry) : `（百科中无条目：${name}）`;
  });

  const sceneSection = [
    `## 本场景`,
    `标题：${input.sceneNode.title}`,
    input.sceneNode.pov ? `POV：${input.sceneNode.pov}` : null,
    input.sceneNode.time ? `时间：${input.sceneNode.time}` : null,
    input.sceneNode.place ? `地点：${input.sceneNode.place}` : null,
    `情节要点：${input.sceneNode.beats}`,
  ]
    .filter(Boolean)
    .join("\n");

  const parts: string[] = [sceneSection];

  if (characters.length > 0) {
    parts.push(`## 本场景角色档案\n${characters.join("\n\n")}`);
  }
  if (foreshadows.length > 0) {
    parts.push(
      `## 需呼应的伏笔/设定\n${foreshadows.map((f) => `- ${f}`).join("\n")}`
    );
  }

  const priorText = buildPriorText(input.priorScenes);
  if (priorText) {
    parts.push(priorText);
  }

  const baseDraft = input.baseDraft ?? input.currentDraft;

  if (input.mode === "continue") {
    if (baseDraft) {
      parts.push(
        `## 本场景当前稿\n${baseDraft.content}`,
        `## 写作指令（续写）\n请紧接「本场景当前稿」的最后一段续写，保持文风与上下文一致。要求：${input.instruction}`
      );
    } else {
      parts.push(
        `## 写作指令（续写）\n请紧接前文续写本场景。要求：${input.instruction}`
      );
    }
  } else if (input.mode === "rewrite") {
    if (baseDraft) {
      parts.push(
        `## 待改写稿\n${baseDraft.content}`,
        `## 写作指令（局部改写）\n请对「待改写稿」进行改写，未涉及部分保持原样。要求：${input.instruction}`
      );
    } else {
      parts.push(
        `## 写作指令（局部改写）\n本场景尚无草稿，请按情节要点创作后视为初稿。要求：${input.instruction}`
      );
    }
  } else {
    parts.push(
      `## 写作指令\n请根据以上设定与场景要求创作本场景正文。要求：${input.instruction}`
    );
  }

  return {
    system,
    messages: [{ role: "user", content: parts.join("\n\n") }],
  };
}
