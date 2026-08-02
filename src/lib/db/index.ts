import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

const DATABASE_URL = process.env.DATABASE_URL ?? "./sqlite.db";
const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

const sqlite = new Database(DATABASE_URL);
sqlite.exec("PRAGMA foreign_keys = ON;");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });

/** 迁移记录数 ≥ journal 条目数即已是最新（逐迁移事务保证列与记录一致） */
function isUpToDate(): boolean {
  try {
    const journal = JSON.parse(
      fs.readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf-8")
    ) as { entries: unknown[] };
    const row = sqlite
      .prepare("SELECT count(*) AS c FROM __drizzle_migrations")
      .get() as { c: number };
    return row.c >= journal.entries.length;
  } catch {
    return false;
  }
}

// 启动即迁移：新库零命令可用（`npm run dev` 直接建表），老库自动补差量。
// 迁移文件在 drizzle/（由 drizzle-kit generate 产出并随仓库提交）。
// `next build` 的多个 worker 会并发跑到这里：竞态落败方会撞
// "duplicate column"——此时复核确认库已最新则安全放过；
// 2026-07 之前用 drizzle-kit push 建库的旧文件没有 __drizzle_migrations 表，
// 复核不过，按旧库给出可操作的报错。
try {
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
} catch (err) {
  if (!isUpToDate()) {
    if (err instanceof Error && /already exists/i.test(err.message)) {
      throw new Error(
        `数据库 ${DATABASE_URL} 是旧版结构（push 建库，无迁移记录）。` +
          `请备份后删除该文件再重启，应用会自动重建表结构。`
      );
    }
    throw err;
  }
}

export { schema };
