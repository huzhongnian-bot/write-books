<!-- BEGIN:nextjs-agent-rules -->

# Next.js: ALWAYS read docs before coding

Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.

<!-- END:nextjs-agent-rules -->

# Write Books

Next.js 16.2 + React 19 + Tailwind 4 + shadcn/ui 4.x (base-nova) + TS 5 strict。别名 `@/*` → `src/*`，UI 组件在 `src/components/ui/`，样式用 `cn()`。

- `params`/`searchParams` 是 Promise 必须 `await`；默认 Server Component，仅交互时加 `"use client"`
- lucide ≥1.23.0 无品牌图标用内联 SVG；`@base-ui/react/button` 不支持 `asChild`；TW4 用 `@import "tailwindcss"`
- 代理适配：Kimi Code 原生读本文件；Claude Code 经 `CLAUDE.md` 导入。skills 正本在 `.agents/skills/`（Claude stub 在 `.claude/skills/`），矩阵见 `docs/harness-engineering.md` §5.1
- 改功能前先读 `docs/specs/` 对应规格（ingest / bible / script / generate / sillytavern），验收标准以 spec 为准；架构现状看 `docs/architecture.md`
- 新增带 FK 的表时，同步更新 `scripts/seed.ts` 与测试 `beforeEach` 的清库顺序（先子表后父表）；`chapter_chunks` 与 `chapter_summaries` 是 FTS5 虚拟表（drizzle 不建模、手写迁移、无 FK），同样要 raw SQL 同步清库，读写一律收口 `src/lib/retrieval/chunks.ts`——中文检索靠 CJK 逐字空格（unicode61 会把整段中文当一个 token，别直接 MATCH 原文）；旧作品补建/重建分块索引用 `npm run db:reindex [workId]`（缺省全量，幂等先删后建）
- 提交前验收四件套：`npm run lint && npx tsc --noEmit && npx vitest run && npm run build`；删除路由/页面文件后 tsc 若报 `.next/types` 里过期模块缺失，删 `.next/types` 再跑即可（构建产物不会自动清引用）
- 多步 DB 写入必须包 `db.transaction`；drizzle + better-sqlite3 的事务回调**必须同步**（`.run()`/`.all()`/`.get()` 终结）——传 async 回调会在首个 await 处提前提交，事务失效
- 改 schema 后必须 `npx drizzle-kit generate` 产出迁移并随仓库提交：应用启动自动跑 `drizzle/` 迁移（新库零命令建表），`db:push` 仅限本地临时迭代
- 新增换肤主题必须三处同步：`schema.ts` 的 `projectThemeEnum`、`globals.css` 的 `[data-theme]` token 块、`src/lib/themes.ts` 的选项（规格见 `docs/specs/theme.md`）
- 测试隔离：vitest 每 worker 独立 `tmp-test-<pid>.db`（`src/test-setup.ts` 下发 `DATABASE_URL`，启动迁移自动建表），任何测试不得读写 `./sqlite.db`
- AI 模型名由环境变量 `AI_MODEL` 决定（代码默认 `anthropic/claude-sonnet-4.5`，勿写死）；接入走 OpenAI 兼容协议（`openai` SDK），端点/key 取 SDK 标准 `OPENAI_BASE_URL`/`OPENAI_API_KEY`（当前 ZenMux 聚合网关 `https://zenmux.ai/api/v1`，模型名 `provider/model` 须与端点匹配）；ZenMux 需代理，`AI_PROXY_URL` 存在时 client 只给 AI 调用挂 undici ProxyAgent（**不要**用 `HTTP(S)_PROXY`/全局 dispatcher——进程级代理会波及 Next 自身 fetch，如构建期 Google Fonts 下载直接失败）；`MOCK_AI=1` 零成本开发（流式生成按指令 hash 回放 3 变体样文）
- 启动一律用脚本（不要裸 `npm run dev`，环境污染与端口残留两坑见下）：`npm run dev:ps`（PowerShell）或 `npm run dev:bash`（Git Bash，**路径必须正斜杠**，`sh .\scripts\dev.sh` 的反斜杠会被 bash 转义吞掉）；脚本本体 `scripts/dev.ps1`（**.ps1 必须存为 UTF-8 带 BOM**——PS 5.1 把无 BOM 脚本按 GBK 解析，中文会吃掉字符串引号直接解析报错）/ `scripts/dev.sh`，内部 `npm run dev` 不变（别名只包启动，无递归）
- 坑：终端进程环境里的同名变量会覆盖 `.env.local`（dotenv 不覆盖已有变量）——本机 PowerShell profile 的 `ANTHROPIC_*` 曾让 dev server 连不通 AI；AI 报「无法连接」先查启动 shell 的环境变量，Windows 下杀 dev server 要 `taskkill /F` next 子进程（杀 npm 壳进程子进程会残留占端口）；另：Next 16 同目录只允许一个 dev server（锁在 `.next/dev`）
