// vitest 全局 setup（每个 worker 进程各跑一遍）：
// - MOCK_AI=1：测试零 API 成本
// - 每 worker 独立 DB 文件：不写开发库 ./sqlite.db，worker 间并发也不互相锁
//   （表结构由 db/index.ts 的启动迁移自动创建）
import fs from "node:fs";

process.env.MOCK_AI = "1";
process.env.DATABASE_URL = `./tmp-test-${process.pid}.db`;

// 上一次运行残留的同名文件（pid 复用）会导致旧数据干扰，先清
for (const suffix of ["", "-wal", "-shm"]) {
  fs.rmSync(process.env.DATABASE_URL + suffix, { force: true });
}
