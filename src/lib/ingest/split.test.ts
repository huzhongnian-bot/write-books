import { describe, it, expect } from "vitest";
import { splitChapters } from "./split";

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
});
