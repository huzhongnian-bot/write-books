import { describe, it, expect } from "vitest";
import type { BibleEntry } from "@/lib/db/schema";
import {
  bibleEntryToCharaCard,
  bibleEntryToLorebookEntry,
  buildLorebook,
  renderEntryContent,
  truncateAtSentence,
} from "./map";

function makeEntry(overrides: Partial<BibleEntry>): BibleEntry {
  return {
    id: 1,
    workId: 1,
    kind: "setting",
    name: "花果山",
    data: {},
    anchors: [],
    confidence: 1,
    origin: "user",
    editedByUser: false,
    ...overrides,
  };
}

const sunWukong = makeEntry({
  kind: "character",
  name: "孙悟空",
  data: {
    aliases: ["石猴", "美猴王", "齐天大圣"],
    personality: "桀骜不驯、机智果敢",
    abilities: ["七十二变", "筋斗云"],
    speechPatternSamples: ["俺老孙来也！", "妖怪，吃我一棒！"],
    growthArc: "从顽石到斗战胜佛",
  },
  anchors: [{ chapterSeq: 1, quote: "化作一个石猴" }],
});

describe("truncateAtSentence", () => {
  it("短文本原样返回", () => {
    expect(truncateAtSentence("短句。", 500)).toBe("短句。");
  });

  it("超限断在句读处", () => {
    const text = `${"一".repeat(100)}。${"二".repeat(600)}`;
    const out = truncateAtSentence(text, 500);
    expect(out).toBe(`${"一".repeat(100)}。`);
    expect(out.length).toBeLessThanOrEqual(500);
  });

  it("窗口内无句读则硬切", () => {
    const out = truncateAtSentence("一".repeat(600), 500);
    expect(out).toHaveLength(500);
  });
});

describe("renderEntryContent", () => {
  it("character：结构化分段 + 类型标签", () => {
    const out = renderEntryContent(sunWukong);
    expect(out).toContain("【角色】孙悟空");
    expect(out).toContain("性格：桀骜不驯、机智果敢");
    expect(out).toContain("能力：七十二变，筋斗云");
    expect(out).toContain("口吻：俺老孙来也！；妖怪，吃我一棒！");
    expect(out).toContain("成长线：从顽石到斗战胜佛");
  });

  it("setting：data 键值逐行拼接", () => {
    const out = renderEntryContent(
      makeEntry({
        kind: "setting",
        name: "花果山",
        data: { type: "地点", content: "十洲之祖脉" },
      })
    );
    expect(out).toContain("【设定】花果山");
    expect(out).toContain("type：地点");
    expect(out).toContain("content：十洲之祖脉");
  });

  it("plot_arc / relationship / timeline_event 均带类型标签且不崩", () => {
    for (const kind of ["plot_arc", "relationship", "timeline_event"]) {
      const out = renderEntryContent(
        makeEntry({ kind, name: "X", data: { summary: "梗概" } })
      );
      expect(out).toContain("X");
      expect(out).toContain("summary：梗概");
    }
  });

  it("空 data 兜底：只有标题行", () => {
    expect(renderEntryContent(makeEntry({ data: {} }))).toBe("【设定】花果山");
  });

  it("超长 content 截断 ≤500 字", () => {
    const out = renderEntryContent(
      makeEntry({ data: { content: `长。${"文".repeat(1000)}` } })
    );
    expect(out.length).toBeLessThanOrEqual(500);
  });
});

describe("bibleEntryToLorebookEntry", () => {
  it("触发词 = 名称 + character 别名", () => {
    const entry = bibleEntryToLorebookEntry(sunWukong, 0);
    expect(entry.key).toEqual(["孙悟空", "石猴", "美猴王", "齐天大圣"]);
  });

  it("非 character 不展开别名", () => {
    const entry = bibleEntryToLorebookEntry(
      makeEntry({ data: { aliases: ["别名"] } }),
      3
    );
    expect(entry.key).toEqual(["花果山"]);
    expect(entry.uid).toBe(3);
  });

  it("anchors 渲染进 comment", () => {
    const entry = bibleEntryToLorebookEntry(sunWukong, 0);
    expect(entry.comment).toBe("出自第 1 章「化作一个石猴」");
  });

  it("ST 默认开关位", () => {
    const entry = bibleEntryToLorebookEntry(sunWukong, 0);
    expect(entry).toMatchObject({
      constant: false,
      selective: false,
      position: 0,
      order: 100,
      disable: false,
      probability: 100,
      useProbability: false,
      depth: 4,
    });
  });
});

describe("buildLorebook", () => {
  it("entries 数字字符串 key + uid 全表唯一", () => {
    const book = buildLorebook([
      sunWukong,
      makeEntry({ id: 2, name: "花果山" }),
      makeEntry({ id: 3, kind: "plot_arc", name: "石猴出世" }),
    ]);
    expect(Object.keys(book.entries)).toEqual(["0", "1", "2"]);
    const uids = Object.values(book.entries).map((e) => e.uid);
    expect(new Set(uids).size).toBe(uids.length);
  });
});

describe("bibleEntryToCharaCard", () => {
  it("V2 规格字段齐全", () => {
    const card = bibleEntryToCharaCard(sunWukong, "西游记");
    expect(card.spec).toBe("chara_card_v2");
    expect(card.spec_version).toBe("2.0");
    expect(card.data.name).toBe("孙悟空");
    expect(card.data.description).toContain("性格：桀骜不驯、机智果敢");
    expect(card.data.description).toContain("成长线：从顽石到斗战胜佛");
    expect(card.data.personality).toBe("桀骜不驯、机智果敢");
    expect(card.data.creator_notes).toBe("由 write-books 导出自《西游记》");
    expect(card.data.system_prompt).toBe("");
  });

  it("first_mes 取口吻样例首条，mes_example 不编造 user 回合", () => {
    const card = bibleEntryToCharaCard(sunWukong, "西游记");
    expect(card.data.first_mes).toBe("俺老孙来也！");
    expect(card.data.mes_example).toBe(
      "<START>\n{{char}}: 俺老孙来也！\n{{char}}: 妖怪，吃我一棒！"
    );
    expect(card.data.mes_example).not.toContain("{{user}}");
  });

  it("无口吻样例：first_mes 静态占位、mes_example 为空", () => {
    const card = bibleEntryToCharaCard(
      makeEntry({ kind: "character", name: "无名", data: {} }),
      "西游记"
    );
    expect(card.data.first_mes).toContain("开场白待补充");
    expect(card.data.mes_example).toBe("");
  });
});
