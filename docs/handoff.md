# 工作交接单（Handoff）

> 记录时间：2026-07-18
> 背景：Kimi K3（Kimi Code）coding plan 额度用尽，工作中断。本单记录已完成 / 待完成项，供下次接手直接续做。
> 真相基准：以下状态由实跑 `tsc / vitest / eslint` 核实，非仅看文件存在。

## 当前验收命令实测状态

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 无错误 |
| `npx vitest run` | ✅ 23 tests / 5 files 全绿 |
| `npm run lint` | ❌ 2 errors + 1 warning（见「待完成 · T12」） |
| `npm run build` | ⚠️ 未验证（本次未跑） |

## ⚠️ 最大的坑：全部未提交

`git log` 最新仍是 `d3deee6 (T5)`。**T6~T11 的所有代码都还是 untracked / modified 状态，一次都没 commit。** 下次接手第一件事应先审阅并分批提交，否则有丢失风险。

## 已完成（代码就绪）

| # | 任务 | 交付物（实际路径） | 核实 |
|---|------|------|------|
| T1 | 数据层 | `src/lib/db/schema.ts`、`db/index.ts`、`scripts/seed.ts` | ✅ |
| T2 | fixtures/golden | `fixtures/golden/xiyouji-bible.json`、`fixtures/novels/xiyouji-12ch.txt` | ✅ |
| T3 | AI 封装层 | `src/lib/ai/client.ts`、`ai/mock/index.ts`、`ai/prompts/{extract-chapter,summarize-arc,generate-scene}.ts` | ✅ |
| T4 | 章节切分器 | `src/lib/ingest/split.ts` + `split.test.ts` | ✅ test 绿 |
| T5 | 摄取管线 | `src/lib/ingest/pipeline.ts` + `pipeline.test.ts` | ✅ test 绿 |
| T6 | 上传+进度 | `api/works/route.ts` + `[id]/{status,drain,chapters/[chapterId]/retry}`、`projects/page.tsx`、`projects/[id]/page.tsx`、`ingest-progress.tsx`、`upload-form.tsx` | ✅ 代码就绪 |
| T7 | 百科 UI | `projects/[id]/bible/`（`page.tsx`、`actions.ts` + `actions.test.ts`、`entry-form.tsx`、`{create,edit}-entry-dialog.tsx`、`anchor-dialog.tsx`、`shared.ts`） | ✅ actions.test 绿 |
| T8 | 脚本编辑器 | `projects/[id]/script/`（`page.tsx`、`actions.ts`、`node-form.tsx`、`script-editor.tsx`） | ✅ 代码就绪 |
| T9 | 上下文组装器 | `src/lib/ai/assemble-context.ts` + test + `__snapshots__` | ✅ test+snapshot 绿 |
| T10 | 生成工作台 | `api/scenes/[id]/generate/route.ts`（SSE）、`projects/[id]/write/[sceneId]/`（`page.tsx`、`write-workbench.tsx`） | ✅ 代码就绪（⚠️ 见 T12 遗留文件） |
| T11 | /design 迁移+样张 | `design/page.tsx`（原根页迁入）、`design/bible/page.tsx`、`design/generate/page.tsx`；根 `page.tsx` 改为 `redirect("/projects")` | ✅ 代码就绪 |

> 注：T6/T8/T10/T11 标「代码就绪」= 文件齐、tsc+现有测试通过，但**未做端到端手动走查 / 未跑 build**，接手需按各 spec §三验收项过一遍。

## 待完成

### T12 收尾（唯一未启动的规划任务）

1. **修 lint（当前唯一红灯）**：
   - 删除根目录遗留的临时验证文件 `tmp-verify-generate.ts`（T10 的调试草稿，报 2 个 `no-var` error，是 lint 失败的唯一根因）。
   - `src/lib/ai/mock/index.ts:62` 的 `_req` unused warning（改签名或加 eslint-disable）。
2. **跑 `npm run build`** 确认生产构建绿（本次未验证）。
3. **回写 `AGENTS.md`**：补命令 / 新踩的坑 / spec 指针；核对是否 ≤60 行。
4. **更新 tech-plan §12 进度表**（已补，见下）。

### §11 DoD 中需真实 API Key 的验收项（Mock 无法覆盖）

- [ ] 真实 API 下流式生成一个场景（800+ 字）、续写、回退旧版本可用。
- [ ] `ai_calls` 记录含 `cache_read_input_tokens`，二次生成缓存命中。
- [ ] §5.4 人工质量评分卡对照实验（A 完整组装 vs B 仅要点）跑一轮并存档 `fixtures/golden/rubric-YYYYMMDD.md`。

## 遗留 Bug（历次锐评已列，仍未修，见 `docs/reviews/kimi-k3-review.md`）

| 优先级 | 位置 | 问题 |
|---|---|---|
| 高 | `ingest/pipeline.ts` `processSummaryJob` | 汇总→bible 写入不可恢复：崩溃在「标 done」与「插 bible」之间会永久丢 bible_entries 且不重试。应放同一事务或让 bible 插入幂等。 |
| 高 | `pipeline.ts` / `tech-plan §144` | 模型名 `claude-opus-4-8` 是占位/错误名，真实调用会 404。接真 API 前必须改成有效模型名。 |
| 中 | `ai/client.ts` `callStreaming` | MOCK 分支 `yield*` 后返回硬编码空对象，丢弃 mock 的 `draftContent`/`usage`，应 `return yield* ...`。 |
| 中 | `api/works/route.ts`、`script/actions.ts` | 多步写入无事务，中途失败留孤儿数据（上传建库、删节点 reseq）。 |

## 下次接手建议顺序

1. 审阅并分批 commit 现有 T6~T11 成果（先止损）。
2. 删 `tmp-verify-generate.ts` + 修 mock warning → `lint` 绿 → 跑 `build`。
3. 按 spec §三对 T6/T7/T8/T10/T11 做端到端手动走查。
4. 修「遗留 Bug」表中两个「高」项（尤其汇总→bible，接真 API 前必修）。
5. 配 `ANTHROPIC_API_KEY` + 修模型名，跑 §11 真实 API 验收 + §5.4 对照实验。
