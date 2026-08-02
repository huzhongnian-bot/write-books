import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  CHUNK_MAX_CHARS,
  CHUNK_TARGET_CHARS,
  buildMatchQuery,
  buildRetrievalTerms,
  chunkChapterText,
  deleteChunksForWorks,
  deleteSummariesForWorks,
  indexChapterSummary,
  indexWorkChunks,
  searchChunks,
  searchSummaries,
  spaceCjkChars,
} from "./chunks";

describe("chunkChapterText", () => {
  it("短段落按目标字数贪心打包", () => {
    const para = "段".repeat(200);
    const chunks = chunkChapterText([para, para, para].join("\n"));
    // 200+200 装得下 500，再加一段就超 → 2+1
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(`${para}\n${para}`);
    expect(chunks[1]).toBe(para);
  });

  it("单段超过硬切上限时按目标长度硬切", () => {
    const long = "长".repeat(CHUNK_MAX_CHARS + 100);
    const chunks = chunkChapterText(long);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(CHUNK_TARGET_CHARS);
    expect(chunks[1]).toHaveLength(CHUNK_MAX_CHARS + 100 - CHUNK_TARGET_CHARS);
  });

  it("空内容与纯空白返回空数组", () => {
    expect(chunkChapterText("")).toEqual([]);
    expect(chunkChapterText("\n\n  \n")).toEqual([]);
  });
});

describe("spaceCjkChars", () => {
  it("CJK 逐字加空格，拉丁词与数字保持完整", () => {
    expect(spaceCjkChars("第3章abc，林雪")).toBe("第 3 章 abc， 林 雪");
    expect(spaceCjkChars("HP值100")).toBe("HP 值 100");
  });

  it("折叠已有空白", () => {
    expect(spaceCjkChars("林  雪\n摊牌")).toBe("林 雪 摊 牌");
  });
});

describe("buildRetrievalTerms", () => {
  it("取角色/伏笔/地点/标题的并集，角色优先", () => {
    const terms = buildRetrievalTerms({
      characterIds: ["林雪", "张远"],
      foreshadowRefs: ["旧怀表"],
      place: "咖啡馆",
      title: "雨夜摊牌",
    });
    expect(terms).toEqual(["林雪", "张远", "旧怀表", "咖啡馆", "雨夜摊牌"]);
  });

  it("去重、过滤单字词、容忍非数组 json", () => {
    const terms = buildRetrievalTerms({
      characterIds: ["林雪", "林雪", "雪"],
      foreshadowRefs: "不是数组",
      place: null,
      title: "林雪",
    });
    expect(terms).toEqual(["林雪"]);
  });

  it("超过上限截断", () => {
    const terms = buildRetrievalTerms({
      characterIds: Array.from({ length: 15 }, (_, i) => `角色${i}号`),
      foreshadowRefs: [],
      place: null,
      title: "标题",
    });
    expect(terms).toHaveLength(10);
    expect(terms).not.toContain("标题");
  });
});

describe("buildMatchQuery", () => {
  it("短语化并 OR 连接", () => {
    expect(buildMatchQuery(["林雪", "HP值"])).toBe('"林 雪" OR "HP 值"');
  });

  it("剥离双引号防 phrase 截断", () => {
    expect(buildMatchQuery(['他说"你好"'])).toBe('"他 说 你 好"');
  });

  it("无可用词返回 null", () => {
    expect(buildMatchQuery([])).toBeNull();
    expect(buildMatchQuery(['"'])).toBeNull();
  });
});

describe("searchChunks / indexWorkChunks（真实 FTS）", () => {
  beforeEach(async () => {
    await db.run(sql`DELETE FROM chapter_chunks`);
    await db.run(sql`DELETE FROM chapter_summaries`);
  });

  const workA = [
    {
      seq: 1,
      title: "第一回 石猴出世",
      content: "话说花果山有一块仙石。\n内育仙胞，化作一个石猴，拜了四方。",
    },
    {
      seq: 2,
      title: "第二回 拜师",
      content:
        "石猴远渡重洋，拜菩提祖师为师。石猴习得七十二变。\n祖师问他姓什么，石猴说：我无姓。",
    },
  ];
  const workB = [
    {
      seq: 3,
      title: "第三章 雨夜",
      content: "林雪在咖啡馆向张远摊牌，窗外下着雨。",
    },
  ];

  it("检索命中正确章节，返回序号/标题/原文", () => {
    indexWorkChunks(db, 1, workA);
    indexWorkChunks(db, 2, workB);

    const hits = searchChunks(2, ["林雪"]);
    expect(hits).toHaveLength(1);
    expect(hits[0].chapterSeq).toBe(3);
    expect(hits[0].chapterTitle).toBe("第三章 雨夜");
    expect(hits[0].text).toContain("摊牌");
  });

  it("按 work_id 隔离，不串作品", () => {
    indexWorkChunks(db, 1, workA);
    indexWorkChunks(db, 2, workB);

    expect(searchChunks(2, ["石猴"])).toEqual([]);
    expect(searchChunks(1, ["林雪"])).toEqual([]);
  });

  it("词频更高的块排在前面（BM25）", () => {
    indexWorkChunks(db, 1, workA);
    const hits = searchChunks(1, ["石猴"]);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    // 第二回一块含 3 个「石猴」，第一回只 1 个
    expect(hits[0].chapterSeq).toBe(2);
  });

  it("无检索词直接返回空，不碰 FTS", () => {
    indexWorkChunks(db, 1, workA);
    expect(searchChunks(1, [])).toEqual([]);
  });

  it("deleteChunksForWorks 只清指定作品", () => {
    indexWorkChunks(db, 1, workA);
    indexWorkChunks(db, 2, workB);

    deleteChunksForWorks(db, [1]);
    expect(searchChunks(1, ["石猴"])).toEqual([]);
    expect(searchChunks(2, ["林雪"])).toHaveLength(1);
  });
});

describe("searchSummaries / indexChapterSummary（真实 FTS）", () => {
  beforeEach(async () => {
    await db.run(sql`DELETE FROM chapter_summaries`);
  });

  it("概述检索命中并返回序号/标题/概述", () => {
    indexChapterSummary(db, 1, {
      seq: 2,
      title: "第二回 拜师",
      summary: "石猴远渡重洋拜菩提祖师为师，习得七十二变，获名孙悟空。",
    });
    indexChapterSummary(db, 2, {
      seq: 3,
      title: "第三章 雨夜",
      summary: "林雪在咖啡馆向张远摊牌，两人彻底决裂。",
    });

    const hits = searchSummaries(1, ["菩提祖师"]);
    expect(hits).toHaveLength(1);
    expect(hits[0].chapterSeq).toBe(2);
    expect(hits[0].chapterTitle).toBe("第二回 拜师");
    expect(hits[0].summary).toContain("七十二变");
    // 作品隔离
    expect(searchSummaries(2, ["菩提祖师"])).toEqual([]);
    expect(searchSummaries(1, [])).toEqual([]);
  });

  it("同章重复建索引幂等（先删后插，不重复命中）", () => {
    const chapter = {
      seq: 2,
      title: "第二回 拜师",
      summary: "石猴拜菩提祖师为师。",
    };
    indexChapterSummary(db, 1, chapter);
    indexChapterSummary(db, 1, { ...chapter, summary: "石猴拜菩提祖师为师，获名孙悟空。" });

    const hits = searchSummaries(1, ["石猴"]);
    expect(hits).toHaveLength(1);
    expect(hits[0].summary).toContain("孙悟空");
  });

  it("deleteSummariesForWorks 只清指定作品", () => {
    indexChapterSummary(db, 1, { seq: 1, title: null, summary: "石猴出世。" });
    indexChapterSummary(db, 2, { seq: 3, title: null, summary: "林雪摊牌。" });

    deleteSummariesForWorks(db, [1]);
    expect(searchSummaries(1, ["石猴"])).toEqual([]);
    expect(searchSummaries(2, ["林雪"])).toHaveLength(1);
  });
});
