import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// 只导入表定义（不打开数据库连接）
import {
  bibleEntries,
  chapters,
  ingestJobs,
  projects,
  sceneDrafts,
  sceneNodes,
  sourceWorks,
  storylines,
} from "@/lib/db/schema";

// vitest 并行跑测试文件，而 pipeline.test.ts 等会用例会在 beforeEach 清空
// 共享的 ./sqlite.db，互相干扰。这里复制一份独立 DB 副本，通过 DATABASE_URL
// 让本文件的 db 连接指向副本，做到完全隔离。
let db: (typeof import("@/lib/db"))["db"];
let createBibleEntry: (typeof import("./actions"))["createBibleEntry"];
let updateBibleEntry: (typeof import("./actions"))["updateBibleEntry"];
let getChapterExcerpt: (typeof import("./actions"))["getChapterExcerpt"];

let tempDir: string;
let previousDbUrl: string | undefined;

beforeAll(async () => {
  previousDbUrl = process.env.DATABASE_URL;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bible-actions-"));
  fs.copyFileSync(
    path.resolve("sqlite.db"),
    path.join(tempDir, "test.db")
  );
  process.env.DATABASE_URL = path.join(tempDir, "test.db");

  ({ db } = await import("@/lib/db"));
  ({ createBibleEntry, updateBibleEntry, getChapterExcerpt } = await import(
    "./actions"
  ));
});

afterAll(() => {
  db.$client.close();
  if (previousDbUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousDbUrl;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function clearTables() {
  // 先子表后父表（与 pipeline.test.ts 顺序一致）
  await db.delete(sceneDrafts);
  await db.delete(sceneNodes);
  await db.delete(storylines);
  await db.delete(bibleEntries);
  await db.delete(ingestJobs);
  await db.delete(chapters);
  await db.delete(sourceWorks);
  await db.delete(projects);
}

async function createFixtureWork() {
  const [project] = await db
    .insert(projects)
    .values({ name: "Bible Action Test" })
    .returning();
  const [work] = await db
    .insert(sourceWorks)
    .values({
      projectId: project.id,
      title: "测试原作",
      author: "测试作者",
      ingestStatus: "done",
    })
    .returning();
  await db.insert(chapters).values({
    workId: work.id,
    seq: 1,
    title: "第1回 测试",
    content: "第1回 测试\n\n花果山上有一块仙石，迸裂后化作一个石猴。",
    charCount: 24,
  });
  return { project, work };
}

describe("bible actions", () => {
  beforeEach(clearTables);

  it("creates entries as 二创设定 (origin=user, editedByUser=false)", async () => {
    const { project, work } = await createFixtureWork();

    const result = await createBibleEntry({
      projectId: project.id,
      workId: work.id,
      kind: "setting",
      name: "花果山结界",
      confidence: 1,
      data: { type: "结界", content: "偏离原作的自建设定" },
    });
    expect(result).toEqual({ ok: true });

    const rows = await db
      .select()
      .from(bibleEntries)
      .where(eq(bibleEntries.workId, work.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].origin).toBe("user");
    expect(rows[0].editedByUser).toBe(false);
    expect(rows[0].name).toBe("花果山结界");
  });

  it("marks edited extracted entries as 校订 without creating a new row", async () => {
    const { project, work } = await createFixtureWork();
    const [entry] = await db
      .insert(bibleEntries)
      .values({
        workId: work.id,
        kind: "setting",
        name: "花果山",
        data: { type: "地点", content: "抽取描述" },
        anchors: [],
        confidence: 0.9,
        origin: "extracted",
      })
      .returning();

    const result = await updateBibleEntry({
      entryId: entry.id,
      projectId: project.id,
      name: "花果山（校订）",
      confidence: 0.6,
      data: { type: "地点", content: "校订后描述" },
    });
    expect(result).toEqual({ ok: true });

    const rows = await db
      .select()
      .from(bibleEntries)
      .where(eq(bibleEntries.workId, work.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("花果山（校订）");
    expect(rows[0].editedByUser).toBe(true);
    expect(rows[0].origin).toBe("extracted");
    expect(rows[0].confidence).toBe(0.6);
  });

  it("keeps user entries in 二创 state when edited", async () => {
    const { project, work } = await createFixtureWork();
    const [entry] = await db
      .insert(bibleEntries)
      .values({
        workId: work.id,
        kind: "character",
        name: "原创角色",
        data: { personality: "冷静" },
        anchors: [],
        confidence: 1,
        origin: "user",
      })
      .returning();

    const result = await updateBibleEntry({
      entryId: entry.id,
      projectId: project.id,
      name: "原创角色·改",
      confidence: 1,
      data: { personality: "暴躁" },
    });
    expect(result).toEqual({ ok: true });

    const rows = await db
      .select()
      .from(bibleEntries)
      .where(eq(bibleEntries.id, entry.id));
    expect(rows[0].name).toBe("原创角色·改");
    expect(rows[0].origin).toBe("user");
    expect(rows[0].editedByUser).toBe(false);
  });

  it("rejects invalid input and leaves the row unchanged", async () => {
    const { project, work } = await createFixtureWork();
    const [entry] = await db
      .insert(bibleEntries)
      .values({
        workId: work.id,
        kind: "setting",
        name: "花果山",
        data: {},
        anchors: [],
        confidence: 0.9,
      })
      .returning();

    const badName = await updateBibleEntry({
      entryId: entry.id,
      projectId: project.id,
      name: "",
      confidence: 0.5,
      data: {},
    });
    expect(badName.ok).toBe(false);

    const badConfidence = await updateBibleEntry({
      entryId: entry.id,
      projectId: project.id,
      name: "x",
      confidence: 1.5,
      data: {},
    });
    expect(badConfidence.ok).toBe(false);

    const badKind = await createBibleEntry({
      projectId: project.id,
      workId: work.id,
      kind: "unknown",
      name: "x",
      confidence: 0.5,
      data: {},
    });
    expect(badKind.ok).toBe(false);

    const wrongProject = await createBibleEntry({
      projectId: project.id + 100,
      workId: work.id,
      kind: "setting",
      name: "x",
      confidence: 0.5,
      data: {},
    });
    expect(wrongProject.ok).toBe(false);

    const rows = await db
      .select()
      .from(bibleEntries)
      .where(eq(bibleEntries.workId, work.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("花果山");
    expect(rows[0].editedByUser).toBe(false);
  });

  it("returns chapter excerpt for anchors and null for missing chapters", async () => {
    const { work } = await createFixtureWork();

    const excerpt = await getChapterExcerpt(work.id, 1);
    expect(excerpt?.title).toBe("第1回 测试");
    expect(excerpt?.content).toContain("花果山上有一块仙石");

    expect(await getChapterExcerpt(work.id, 99)).toBeNull();
  });
});
