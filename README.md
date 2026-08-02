# Write Books — 二创写作平台

基于已有小说进行二次创作的 AI 辅助写作平台（本地单用户）：

上传原作 TXT → 自动切分章节并建立全文检索（纯 RAG，无 AI 摄取成本）→ 维护二创设定（百科）→ 编排场景脚本 → 对话式流式生成正文（原作段落随场景检索注入，版本链、可回退）→ 导出 TXT 成稿。

技术栈：Next.js 16 + React 19 + Tailwind 4 + shadcn/ui + SQLite（Drizzle）+ Anthropic SDK。

## 快速开始

```bash
npm install
npm run dev        # 首次启动自动建表（drizzle 迁移随仓库提交，无需手动 db:push）
```

打开 http://localhost:3000 （自动跳转 `/projects`）。

```bash
npm run seed       # 可选：灌入「西游记」演示项目（含示例设定 + 3 个场景脚本），打开即可体验完整流程
```

## AI 配置（.env.local）

| 模式 | 配置 | 说明 |
|---|---|---|
| Mock（默认开发） | `MOCK_AI=1` | 零 API 成本：生成回放内置样文（摄取为本地全文检索，本就不调 AI） |
| Kimi Code（已验证） | `MOCK_AI=0` + `ANTHROPIC_API_KEY=sk-kimi-...` + `ANTHROPIC_BASE_URL=https://api.kimi.com/coding/` + `AI_MODEL=k3-256k` | Kimi Code 的 Anthropic 兼容端点；key 在 Kimi Code Console 创建。可选模型：`kimi-for-coding`（全会员）/ `k3-256k` / `k3`（1M 上下文），按会员档位 |
| Anthropic 官方 | `MOCK_AI=0` + `ANTHROPIC_API_KEY=sk-ant-...` | 需网络可达 `api.anthropic.com`；受限时配 `ANTHROPIC_BASE_URL` 中转 |

注意：**终端进程环境里的同名变量优先于 .env.local**（dotenv 不覆盖已有环境变量）——若 shell 里 export 过 `ANTHROPIC_BASE_URL`，启动前请先 unset。AI 调用失败会以可读中文原因呈现在生成页，并落 `ai_calls.error` 埋点。

## 常用命令

| 命令 | 用途 |
|---|---|
| `npm run dev` / `build` / `start` | 开发 / 构建 / 生产运行 |
| `npm run lint` | ESLint |
| `npm test` | vitest（每 worker 独立临时库，不碰开发库） |
| `npm run seed` | 灌演示数据（会清库） |
| `npm run db:push` | 仅开发期改 schema 后快速同步本地库；**提交前必须 `npx drizzle-kit generate` 产出迁移文件**（运行期只认 `drizzle/` 迁移） |

提交前验收四件套：`npm run lint && npx tsc --noEmit && npx vitest run && npm run build`

## 文档

- [docs/product-design.md](docs/product-design.md) — 产品方案（定位/模块/数据模型/AI 管线）
- [docs/architecture.md](docs/architecture.md) — 当前架构（as-built，与代码同步）
- [docs/specs/](docs/specs/) — 模块级规格（ingest / bible / script / generate，验收基准）
- [docs/handoff.md](docs/handoff.md) — 迭代交接记录
- [docs/tech-plan.md](docs/tech-plan.md) — 历史实施计划（Qoder credit 预算版，已归档）

## License

MIT
