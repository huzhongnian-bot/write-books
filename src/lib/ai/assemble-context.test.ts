import { describe, it, expect } from "vitest";
import type { BibleEntry, SceneNode, SceneDraft } from "@/lib/db/schema";
import { assembleContext, type PriorScene } from "./assemble-context";

// ------------------------------------------------------------------
// Factories (plain objects matching the drizzle row types)
// ------------------------------------------------------------------

function makeEntry(overrides: Partial<BibleEntry> = {}): BibleEntry {
  return {
    id: 1,
    workId: 1,
    kind: "setting",
    name: "花果山",
    data: { type: "地点", content: "东胜神洲傲来国海中名山。" },
    anchors: [],
    confidence: 0.9,
    origin: "extracted",
    editedByUser: false,
    ...overrides,
  };
}

const wukong = makeEntry({
  id: 2,
  kind: "character",
  name: "孙悟空",
  data: {
    aliases: ["石猴", "美猴王"],
    personality: "桀骜不驯、机智果敢",
    abilities: ["七十二变", "筋斗云"],
    speechPatternSamples: ["俺老孙来也！", "妖怪，吃我一棒！"],
    growthArc: "从石猴到斗战胜佛",
  },
});

function makeNode(overrides: Partial<SceneNode> = {}): SceneNode {
  return {
    id: 10,
    storylineId: 1,
    seq: 2,
    title: "发现水帘洞",
    pov: "孙悟空",
    characterIds: ["孙悟空"],
    time: "石猴出世后某日",
    place: "花果山瀑布",
    beats: "众猴嬉戏，石猴纵身跃入瀑布，发现水帘洞。",
    foreshadowRefs: ["花果山"],
    ...overrides,
  };
}

function makeDraft(overrides: Partial<SceneDraft> = {}): SceneDraft {
  return {
    id: 100,
    sceneNodeId: 9,
    parentDraftId: null,
    content: "前文正文内容。",
    instruction: "按要点创作",
    model: "mock",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePriorScene(
  title: string,
  content: string | null,
  seq: number
): PriorScene {
  return {
    node: makeNode({ id: seq, seq, title, characterIds: [], foreshadowRefs: [] }),
    currentDraft: content === null ? null : makeDraft({ content }),
  };
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe("assembleContext", () => {
  it("出场角色的口吻样例必在 system 或 messages 中", () => {
    const { system, messages } = assembleContext({
      bibleEntries: [wukong],
      sceneNode: makeNode(),
      currentDraft: null,
      priorScenes: [],
      mode: "instruct",
      instruction: "写出石猴的胆大。",
    });

    const all = system + messages.map((m) => m.content).join("\n");
    expect(all).toContain("俺老孙来也！");
    expect(all).toContain("妖怪，吃我一棒！");
  });

  it("用户设定条目（origin=user 或 editedByUser）带优先标注", () => {
    const userEntry = makeEntry({
      id: 3,
      name: "金箍棒",
      origin: "user",
      data: { type: "兵器", content: "用户二创：可随意念变形。" },
    });
    const corrected = makeEntry({
      id: 4,
      kind: "character",
      name: "龙王",
      editedByUser: true,
      data: { personality: "校订后的性格" },
    });

    const { system } = assembleContext({
      bibleEntries: [userEntry, corrected],
      sceneNode: makeNode({ characterIds: [], foreshadowRefs: [] }),
      currentDraft: null,
      priorScenes: [],
      mode: "instruct",
      instruction: "测试",
    });

    expect(system).toContain("【用户设定·优先】");
    expect(system).toContain("金箍棒");
    expect(system).toContain("龙王");
  });

  it("百科条目缺失时角色与伏笔显式降级提示", () => {
    const { messages } = assembleContext({
      bibleEntries: [],
      sceneNode: makeNode(),
      currentDraft: null,
      priorScenes: [],
      mode: "instruct",
      instruction: "测试",
    });

    const user = messages[0].content;
    expect(user).toContain("《孙悟空》（百科中无此角色条目）");
    expect(user).toContain("（百科中无条目：花果山）");
  });

  it("稳定前缀确定性：相同输入两次组装结果完全一致", () => {
    const input = {
      bibleEntries: [wukong],
      sceneNode: makeNode(),
      currentDraft: null,
      priorScenes: [makePriorScene("石猴初醒", "第一段前文。", 1)],
      mode: "instruct" as const,
      instruction: "写出石猴的胆大。",
    };

    expect(assembleContext(input)).toEqual(assembleContext(input));
  });

  it("前文：最近场景全文保留，更早场景超出 6000 字部分截断尾部保留", () => {
    const latest = "近".repeat(4000);
    const older = "早".repeat(3000);

    const { messages } = assembleContext({
      bibleEntries: [],
      sceneNode: makeNode(),
      currentDraft: null,
      priorScenes: [makePriorScene("更早场景", older, 1), makePriorScene("最近场景", latest, 2)],
      mode: "instruct",
      instruction: "测试",
    });

    const user = messages[0].content;
    // 最近场景全文在
    expect(user).toContain(latest);
    // 更早场景被截断：只剩 2000 字且带截断标记
    expect(user).toContain("……（前文截断）");
    expect(user).not.toContain(older);
    expect(user).toContain("早".repeat(2000));
    expect(user).not.toContain("早".repeat(2001));
  });

  it("前文：最近场景已达 6000 字时不再携带更早场景", () => {
    const latest = "近".repeat(6000);

    const { messages } = assembleContext({
      bibleEntries: [],
      sceneNode: makeNode(),
      currentDraft: null,
      priorScenes: [makePriorScene("更早场景", "早".repeat(100), 1), makePriorScene("最近场景", latest, 2)],
      mode: "instruct",
      instruction: "测试",
    });

    const user = messages[0].content;
    expect(user).toContain("最近场景");
    expect(user).not.toContain("更早场景");
  });

  it("continue 模式：有当前稿时要求紧接其续写", () => {
    const draft = makeDraft({ sceneNodeId: 10, content: "本场景已有开头。" });

    const { messages } = assembleContext({
      bibleEntries: [],
      sceneNode: makeNode(),
      currentDraft: draft,
      priorScenes: [],
      mode: "continue",
      instruction: "续写一段打斗。",
    });

    const user = messages[0].content;
    expect(user).toContain("## 本场景当前稿\n本场景已有开头。");
    expect(user).toContain("续写");
    expect(user).toContain("续写一段打斗。");
  });

  it("rewrite 模式：优先使用显式 baseDraft 作为待改写稿", () => {
    const current = makeDraft({ sceneNodeId: 10, content: "当前稿内容。" });
    const base = makeDraft({ id: 99, sceneNodeId: 10, content: "历史稿内容。" });

    const { messages } = assembleContext({
      bibleEntries: [],
      sceneNode: makeNode(),
      currentDraft: current,
      priorScenes: [],
      mode: "rewrite",
      instruction: "把结尾改得悬念一些。",
      baseDraft: base,
    });

    const user = messages[0].content;
    expect(user).toContain("## 待改写稿\n历史稿内容。");
    expect(user).not.toContain("当前稿内容。");
    expect(user).toContain("局部改写");
  });

  it("instruct 模式：无前文无角色时仅含场景与写作指令", () => {
    const { system, messages } = assembleContext({
      bibleEntries: [],
      sceneNode: makeNode({ characterIds: [], foreshadowRefs: [] }),
      currentDraft: null,
      priorScenes: [],
      mode: "instruct",
      instruction: "自由发挥。",
    });

    const user = messages[0].content;
    expect(user).toContain("## 本场景");
    expect(user).toContain("## 写作指令");
    expect(user).toContain("自由发挥。");
    expect(user).not.toContain("## 前文");
    expect(user).not.toContain("## 本场景角色档案");
    // 无百科条目时不追加百科章节
    expect(system).not.toContain("# 原作百科");
  });

  it("snapshot：固化完整 prompt 结构", () => {
    const result = assembleContext({
      bibleEntries: [
        wukong,
        makeEntry({ id: 3, name: "花果山" }),
        makeEntry({
          id: 4,
          kind: "plot_arc",
          name: "石猴出世",
          data: { arcType: "main", summary: "仙石迸裂，石猴出世。" },
        }),
      ],
      sceneNode: makeNode(),
      currentDraft: null,
      priorScenes: [makePriorScene("石猴初醒", "石猴睁眼，拜四方。", 1)],
      mode: "instruct",
      instruction: "突出石猴的胆识与众猴的反应。",
    });

    expect(result).toMatchSnapshot();
  });
});
