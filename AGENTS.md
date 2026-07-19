<!-- BEGIN:nextjs-agent-rules -->

# Next.js: ALWAYS read docs before coding

Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.

<!-- END:nextjs-agent-rules -->

# Write Books

Next.js 16.2 + React 19 + Tailwind 4 + shadcn/ui 4.x (base-nova) + TS 5 strict。别名 `@/*` → `src/*`，UI 组件在 `src/components/ui/`，样式用 `cn()`。

- `params`/`searchParams` 是 Promise 必须 `await`；默认 Server Component，仅交互时加 `"use client"`
- lucide ≥1.23.0 无品牌图标用内联 SVG；`@base-ui/react/button` 不支持 `asChild`；TW4 用 `@import "tailwindcss"`
- 代理适配：Kimi Code 原生读本文件；Claude Code 经 `CLAUDE.md` 导入。skills 正本在 `.agents/skills/`（Claude stub 在 `.claude/skills/`），矩阵见 `docs/harness-engineering.md` §5.1
- 改功能前先读 `docs/specs/` 对应规格（ingest / bible / script / generate），验收标准以 spec 为准
- 新增带 FK 的表时，同步更新 `scripts/seed.ts` 与测试 `beforeEach` 的清库顺序（先子表后父表）
- 提交前验收四件套：`npm run lint && npx tsc --noEmit && npx vitest run && npm run build`
- 多步 DB 写入必须包 `db.transaction`；drizzle + better-sqlite3 的事务回调**必须同步**（`.run()`/`.all()`/`.get()` 终结）——传 async 回调会在首个 await 处提前提交，事务失效
- AI 模型名以 `node_modules/@anthropic-ai/sdk` 的 `Model` 类型为准（`claude-opus-4-8` 是有效 ID，勿当占位名改）；`MOCK_AI=1` 零成本开发，录制响应放 `fixtures/recordings/<purpose>.json`
