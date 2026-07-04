import { db } from "@/lib/db";
import {
  projects,
  sourceWorks,
  chapters,
  bibleEntries,
  storylines,
  sceneNodes,
} from "@/lib/db/schema";
import fs from "node:fs";
import path from "node:path";

const FIXTURE_NOVEL_PATH = path.resolve("fixtures/novels/xiyouji-12ch.txt");

function ensureFixtureNovel() {
  if (fs.existsSync(FIXTURE_NOVEL_PATH)) return;

  const chaptersText: string[] = [];
  for (let i = 1; i <= 12; i++) {
    chaptersText.push(
      `第${i}回 灵根育孕源流出 心性修持大道生\n\n` +
        `却说那花果山有一块仙石，自开辟以来，每受天真地秀，日精月华，感之既久，遂有灵通之意。\n` +
        `内育仙胞，一日迸裂，产一石卵，似圆球样大。因见风，化作一个石猴。\n` +
        `五官俱备，四肢皆全。便就学爬学走，拜了四方。\n\n` +
        `（本章为 fixture 占位文本，第 ${i} 章，用于开发与测试章节切分。）\n`.repeat(5)
    );
  }

  fs.mkdirSync(path.dirname(FIXTURE_NOVEL_PATH), { recursive: true });
  fs.writeFileSync(FIXTURE_NOVEL_PATH, chaptersText.join("\n"), "utf-8");
}

async function seed() {
  ensureFixtureNovel();

  // Clear tables in reverse dependency order
  await db.delete(sceneNodes);
  await db.delete(storylines);
  await db.delete(bibleEntries);
  await db.delete(chapters);
  await db.delete(sourceWorks);
  await db.delete(projects);

  const [project] = await db
    .insert(projects)
    .values({ name: "西游记二创 Demo" })
    .returning();

  const [work] = await db
    .insert(sourceWorks)
    .values({
      projectId: project.id,
      title: "西游记",
      author: "吴承恩",
      ingestStatus: "done",
    })
    .returning();

  const chapterContent = fs.readFileSync(FIXTURE_NOVEL_PATH, "utf-8");
  const chapterRecords = chapterContent
    .split(/(?=第\d+回)/)
    .map((content, idx) => ({
      workId: work.id,
      seq: idx + 1,
      title: content.split("\n")[0]?.replace("第", "第").trim() || `第${idx + 1}回`,
      content,
      charCount: content.length,
    }))
    .filter((c) => c.content.trim().length > 0)
    .slice(0, 12);

  await db.insert(chapters).values(chapterRecords);

  await db.insert(bibleEntries).values([
    {
      workId: work.id,
      kind: "setting",
      name: "花果山",
      data: {
        type: "地点",
        content: "东胜神洲傲来国海中名山，乃十洲之祖脉，三岛之来龙。",
      },
      anchors: [{ chapterSeq: 1, quote: "却说那花果山有一块仙石" }],
      confidence: 0.95,
    },
    {
      workId: work.id,
      kind: "character",
      name: "孙悟空",
      data: {
        aliases: ["石猴", "美猴王", "齐天大圣"],
        personality: "桀骜不驯、机智果敢、重情重义",
        abilities: ["七十二变", "筋斗云", "金刚不坏"],
        speechPatternSamples: ["俺老孙来也！", "妖怪，吃我一棒！"],
        growthArc: "从石猴到斗战胜佛",
      },
      anchors: [{ chapterSeq: 1, quote: "化作一个石猴" }],
      confidence: 0.98,
    },
    {
      workId: work.id,
      kind: "plot_arc",
      name: "石猴出世",
      data: {
        arcType: "main",
        summary: "花果山仙石迸裂，石猴出世，开启取经故事主线。",
        keyTurningPoints: [1],
      },
      anchors: [{ chapterSeq: 1, quote: "产一石卵" }],
      confidence: 0.9,
    },
  ]);

  const [storyline] = await db
    .insert(storylines)
    .values({ projectId: project.id, title: "大闹天宫支线" })
    .returning();

  await db.insert(sceneNodes).values([
    {
      storylineId: storyline.id,
      seq: 1,
      title: "石猴初醒",
      pov: "孙悟空",
      characterIds: ["孙悟空"],
      time: "花果山，石卵迸裂之时",
      place: "花果山巅",
      beats: "石猴睁眼，拜四方，目运两道金光射冲斗府。",
      foreshadowRefs: [],
    },
    {
      storylineId: storyline.id,
      seq: 2,
      title: "发现水帘洞",
      pov: "孙悟空",
      characterIds: ["孙悟空"],
      time: "石猴出世后某日",
      place: "花果山瀑布",
      beats: "众猴嬉戏，石猴纵身跃入瀑布，发现水帘洞。",
      foreshadowRefs: [],
    },
    {
      storylineId: storyline.id,
      seq: 3,
      title: "美猴王称王",
      pov: "孙悟空",
      characterIds: ["孙悟空"],
      time: "发现水帘洞后",
      place: "水帘洞",
      beats: "众猴拜石猴为王，称美猴王，自此享乐天真。",
      foreshadowRefs: [],
    },
  ]);

  console.log("Seed complete. Project id:", project.id);
  console.log("Fixture novel:", FIXTURE_NOVEL_PATH);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
