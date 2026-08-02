import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// 只导入表定义（不打开数据库连接）
import { projects } from "@/lib/db/schema";

// DATABASE_URL 指向独立临时文件做隔离（表结构由启动迁移自动创建）
let db: (typeof import("@/lib/db"))["db"];
let setProjectTheme: (typeof import("./actions"))["setProjectTheme"];

let tempDir: string;
let previousDbUrl: string | undefined;

beforeAll(async () => {
  previousDbUrl = process.env.DATABASE_URL;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-actions-"));
  process.env.DATABASE_URL = path.join(tempDir, "test.db");

  ({ db } = await import("@/lib/db"));
  ({ setProjectTheme } = await import("./actions"));
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

describe("setProjectTheme", () => {
  it("默认 default，更新后持久化", async () => {
    const [project] = await db
      .insert(projects)
      .values({ name: "主题测试" })
      .returning();
    expect(project.theme).toBe("default");

    const result = await setProjectTheme({ projectId: project.id, theme: "scifi" });
    expect(result).toEqual({ ok: true });

    const row = await db
      .select()
      .from(projects)
      .where(eq(projects.id, project.id))
      .then((rows) => rows[0]);
    expect(row.theme).toBe("scifi");
  });

  it("非法主题值拒绝", async () => {
    const result = await setProjectTheme({ projectId: 1, theme: "cyberpunk" });
    expect(result.ok).toBe(false);
  });

  it("项目不存在时报错", async () => {
    const result = await setProjectTheme({ projectId: 99999, theme: "urban" });
    expect(result).toEqual({ ok: false, error: "项目不存在" });
  });
});
