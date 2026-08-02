import { describe, it, expect } from "vitest";
import iconv from "iconv-lite";
import { splitChapters, decodeText } from "./split";

const FIXTURE_TEXT = `第1回 灵根育孕源流出 心性修持大道生

却说那花果山有一块仙石，自开辟以来，每受天真地秀，日精月华，感之既久，遂有灵通之意。

第2回 悟彻菩提真妙理 断魔归本合元神

悟空拜辞祖师，别了众师兄，驾起筋斗云，径回东胜神洲。

第3回 四海千山皆拱伏 九幽十类尽除名

那悟空会聚群猴，自称美猴王，享乐天真，何期有三五百载。
`;

describe("splitChapters", () => {
  it("splits fixture text into 3 chapters", () => {
    const chapters = splitChapters(FIXTURE_TEXT);
    expect(chapters).toHaveLength(3);
    expect(chapters[0].seq).toBe(1);
    expect(chapters[0].title).toContain("第1回");
    expect(chapters[0].content).toContain("花果山");
    expect(chapters[1].title).toContain("第2回");
    expect(chapters[2].title).toContain("第3回");
  });

  it("returns single chapter when no headers found", () => {
    const chapters = splitChapters("没有章节标题的纯文本内容。");
    expect(chapters).toHaveLength(1);
    expect(chapters[0].seq).toBe(1);
  });

  it("splits 卷X volume headers (实体书排版，无「第」字)", () => {
    const text = `卷一   金狮的荣耀

　　翻开召唤书第一页，跟随学徒走出黑暗城堡。

卷二  雪狼VS梅杜莎

　　背叛与战争的序曲就此拉开。
`;
    const chapters = splitChapters(text);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].title).toContain("卷一");
    expect(chapters[0].content).toContain("召唤书");
    expect(chapters[1].title).toContain("卷二");
    expect(chapters[1].content).toContain("序曲");
  });

  it("splits unnumbered section titles (前后空行的短行)", () => {
    const text = `卷一 测试卷

　　序场正文，铺陈背景与人物登场，内容足够长不会被当成标题。

巨蟹座·兰迪斯

　　黄昏的奥德赛，橙钢岩披上一层古朴的光芒，故事继续展开。

双鱼座·乌德斯

　　另一幕的正文内容。
`;
    const chapters = splitChapters(text);
    expect(chapters).toHaveLength(3);
    expect(chapters[1].title).toBe("巨蟹座·兰迪斯");
    expect(chapters[1].content).toContain("黄昏的奥德赛");
    expect(chapters[2].title).toBe("双鱼座·乌德斯");
  });

  it("ignores symbol-only separators, dialogue and sentence lines", () => {
    const sep = "\uE788".repeat(3); // PUA 装饰符分隔线（真实文件场景）
    const text = `卷一 测试卷

　　第一段正文内容，长度足够。

${sep}

　　第二段正文内容，不应被分隔线切开。

“……”

　　短叙述句。

　　收尾的正文内容。
`;
    const chapters = splitChapters(text);
    expect(chapters).toHaveLength(1);
    expect(chapters[0].content).toContain("第二段正文内容");
    expect(chapters[0].content).toContain("收尾的正文内容");
  });

  it("strips stray U+FEFF so invisible lines are not treated as titles", () => {
    const text = "卷一 测试卷\n\n\uFEFF\n\n　　正文内容。";
    const chapters = splitChapters(text);
    expect(chapters).toHaveLength(1);
    expect(chapters[0].content).toContain("正文内容");
  });
});

describe("decodeText", () => {
  it("decodes valid UTF-8 as utf-8", () => {
    const buf = Buffer.from("第1回 测试\n\n正文内容", "utf-8");
    const { text, encoding } = decodeText(buf);
    expect(encoding).toBe("utf-8");
    expect(text).toContain("正文内容");
  });

  it("falls back to GBK for non-UTF-8 bytes", () => {
    const buf = iconv.encode("第1回 测试\n\n正文内容", "gbk");
    const { text, encoding } = decodeText(buf);
    expect(encoding).toBe("gbk");
    expect(text).toContain("正文内容");
    expect(text).toContain("第1回");
  });

  it("decodes UTF-16LE with BOM (Windows 记事本导出) instead of GBK mojibake", () => {
    const body = Buffer.from("第1回 测试\n\n正文内容", "utf16le");
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), body]);
    const { text, encoding } = decodeText(buf);
    expect(encoding).toBe("utf-16le");
    expect(text).toContain("正文内容");
    expect(text).toContain("第1回");
  });

  it("decodes UTF-16BE with BOM", () => {
    const body = Buffer.from("正文内容", "utf16le");
    body.swap16();
    const buf = Buffer.concat([Buffer.from([0xfe, 0xff]), body]);
    const { text, encoding } = decodeText(buf);
    expect(encoding).toBe("utf-16be");
    expect(text).toContain("正文内容");
  });

  it("strips UTF-8 BOM", () => {
    const buf = Buffer.from("﻿第1回 正文内容", "utf-8");
    const { text, encoding } = decodeText(buf);
    expect(encoding).toBe("utf-8");
    expect(text.startsWith("第1回")).toBe(true);
  });
});
