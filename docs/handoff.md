# 工作交接单（Handoff）

> 首次记录：2026-07-18（Kimi K3 coding plan 额度用尽，工作中断）
> 续做记录：2026-07-19（额度恢复，T12 收尾 + 缺陷修复完成）
> 续做记录：2026-07-21（真实 API 验收准备：缓存断点 + 流式 usage 修复；**真实 API 受阻于无有效 key**）
> 真相基准：以下状态由实跑 `tsc / vitest / eslint / build / curl smoke` 核实。

## 当前验收命令实测状态（2026-07-21）

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 无错误 |
| `npx vitest run` | ✅ 26 tests / 6 files 全绿 |
| `npm run lint` | ✅ 无错误无警告 |
| `npm run build` | ✅ 通过（Next.js 16.2.10 Turbopack） |

## 2026-07-21 续做内容

### 代码修复（真实 API 路径的两个暗藏 bug，mock 测不出来）

1. ✅ **生成请求从未设 cache 断点**：spec generate.md §2.1 要求 system（写作规范+百科合并前缀）为单个 cache 断点，但全代码无 `cache_control` → 真实 API 下 `cache_read_input_tokens` 永远为 0，§11 缓存验收必挂。已修：`client.ts` `callStreaming` 真实分支 system 改发 `[{type:"text", text, cache_control:{type:"ephemeral"}}]`。
2. ✅ **流式 usage 采集位置错误**：旧代码读 `message_stop` 事件的 usage——该事件**不带 usage**（SDK types 证实），真实 API 下 ai_calls 会记全 0。已修：取最后一个 `message_delta` 的累计 usage（含 cache_read/cache_creation 字段），`message_start` 兜底。
3. ✅ 新增 `src/lib/ai/client.real.test.ts`（SDK 整体 mock，2 tests）：断言 cache_control 数组发出、usage 取 delta 累计值、ai_calls 落库含 cacheReadTokens。

### 真实 API 验收受阻（待用户补 key）

- `.env.local` 的 `ANTHROPIC_API_KEY` 是占位符（`your_key_here`，13 字符），不是真 key。
- 直连 `api.anthropic.com` → 403 `forbidden: Request not allowed`（区域限制特征）；本机常见代理端口（7890/7897/10809/1080…）均无监听；shell 环境里的 `ANTHROPIC_BASE_URL`（zenmux.ai 中转）连接超时。
- **解锁方式**：把真实 key 填进 `.env.local` 的 `ANTHROPIC_API_KEY`（或配上可用代理/中转 `ANTHROPIC_BASE_URL`，SDK 自动读取）。代码侧已就绪，key 一到即可跑。

### UI 页面 HTTP 级 smoke（MOCK_AI + tmp-ui.db 种子项目，curl 校验 200 + 关键内容）

✅ `/projects`、`/projects/[id]`（摄取进度）、`/bible`、`/script`（3 场景节点）、`/write/[sceneId]`、`/design`、`/design/bible`、`/design/generate` 全部正常渲染；`/` 307→`/projects` 符合设计。**浏览器人工走查（交互操作）仍未做**，HTTP 级只证明不崩。

### key 到位后的验收跑法（照抄即可）

```bash
MOCK_AI=0 DATABASE_URL=./tmp-real-api.db npx next dev --port 3100   # 临时库，勿污染 ./sqlite.db
curl -F "name=西游记二创" -F "file=@fixtures/novels/xiyouji-12ch.txt" http://localhost:3100/api/works
curl http://localhost:3100/api/works/<workId>/status                # 轮询至 done
# 生成/续写/改写：POST /api/scenes/<sceneId>/generate {mode,instruction}，done 事件看 usage
# 缓存命中：5 分钟内对同一 project 二次生成，ai_calls.cache_read_tokens 应 >0
# 注意：system 前缀 <4096 token 时平台静默不缓存（tech-plan §5.2），命中率不达标则按 §5.2 回写缓存策略
```

场景节点无 API 路由（走 server actions），可用 node + better-sqlite3 直插 `storylines`/`scene_nodes`（tmp-ui.db 里 id=86 的项目有样例）。

## 2026-07-19 续做内容

### T12 收尾（全部完成）

1. ✅ 删除 `tmp-verify-generate.ts`（T10 调试草稿，lint 红灯根因）。
2. ✅ 修 `src/lib/ai/mock/index.ts` `_req` unused warning（eslint-disable 注释）。
3. ✅ `npm run build` 首验通过。
4. ✅ 回写 `AGENTS.md`（验收四件套命令、better-sqlite3 事务同步回调的坑、模型名以 SDK `Model` 类型为准），20 行 ≤60 行。
5. ✅ 更新 tech-plan §12 进度表 + §11 DoD 勾掉三项（MOCK 演示、命令全绿、AGENTS.md 回写）。

### 锐评缺陷修复（docs/reviews/kimi-k3-review.md）

| 缺陷 | 结论 | 处理 |
|---|---|---|
| #1 汇总→bible 写入不可恢复（高） | **真 bug，已修** | `processSummaryJob`「标 done + 写 result + 插 bible_entries」改同一 `db.transaction`；事务失败则 job 保持 running，超时→failed→重建重跑，不再永久丢 bible。新增幂等回归测试（重复 drain 不重插 bible） |
| #2 模型名 `claude-opus-4-8`（高） | **不成立，勿改** | 本地 SDK `resources/shared.d.ts` 的 `Model` 类型明列 `claude-opus-4-8`；外部资料确认 Opus 4.8 于 2026-05-28 发布，模型 ID 即此名。锐评按 2025 年命名惯例推断，已过时 |
| #3 `callStreaming` MOCK 分支丢返回值（中） | **不成立** | 当前代码已是 `const result = yield* ...; return result` 透传（T10 开发时已修，锐评/交接记录滞后）。smoke 实测 mock usage 透传到 done 事件与 `ai_calls` |
| #4 多步写入无事务（中） | **真 bug，已修** | `POST /api/works`（project+work+chapters+jobs 四步）与 `deleteSceneNode`（删除+reseq 循环）包 `db.transaction`。注意 better-sqlite3 事务回调必须同步，故 route 内联 jobs 创建而非复用 async 的 `createExtractJobs` |
| #5 跨请求并发未真正限流（低） | **未修，P0 可接受** | CAS 防 DB 层重复认领，但两个 drain 并发时实际可达 4 路 AI 并发。若接真 API 后在意成本，再做互斥 |

### 端到端 smoke（2026-07-19，临时 DB 副本 + dev server，未污染 ./sqlite.db）

- ✅ `POST /api/works` 上传 `fixtures/novels/xiyouji-12ch.txt` → 返回 projectId/workId（事务版写入）。
- ✅ `GET /api/works/[id]/status`：12 extract + 1 summary 全 done，work=done。
- ✅ bible_entries 落库（summary→bible 新事务链路真实生效）。
- ✅ `POST /api/scenes/[id]/generate` SSE：11 delta + done，done 携带 draftId 与 mock usage（cache_read_input_tokens=900）；draft（parentDraftId=null）与 ai_calls 落库正确。
- ✅ 流中断（客户端断开）不产生半成品 draft、不记 ai_calls（预期行为）。
- ⚠️ smoke 中 curl `-d` 传中文 instruction 落库为乱码，系 Git Bash 控制台编码问题，非应用 bug（浏览器端 fetch 发 UTF-8 无此问题）。
- ⚠️ UI 页面（projects/bible/script/write 四页）未做浏览器人工走查，仅有 tsc/build/actions 测试覆盖。

## 已完成（代码就绪）——同 2026-07-18 记录

T1~T11 全部完成并已提交（最新 `a24d0cd feat: T6-T11 upload/bible/script/generate UI + docs`）。明细见 2026-07-18 版交接单或 git log。

## 待完成（剩余项）

### §11 DoD 中需真实 API Key 的验收项（Mock 无法覆盖）

- [ ] 真实 API 下流式生成一个场景（800+ 字）、续写、回退旧版本可用。
- [ ] `ai_calls` 记录含 `cache_read_input_tokens`，二次生成缓存命中（验证平台 TTL 内缓存经济性）。
- [ ] §5.4 人工质量评分卡对照实验（A 完整组装 vs B 仅要点）跑一轮并存档 `fixtures/golden/rubric-YYYYMMDD.md`。
- [ ] §11 前两条 UI 走查：上传→百科浏览/编辑/锚点跳转；建 3+ 场景节点（浏览器里过一遍）。

### 下次接手建议顺序

1. 把**真实** `ANTHROPIC_API_KEY` 填进 `.env.local`（现为占位符；本机直连 Anthropic 被区域 403，需 key 本身可直连或另配代理/中转 `ANTHROPIC_BASE_URL`）。
2. 按上文「key 到位后的验收跑法」跑 §11 真实 API 验收（生成 800+ 字/续写/回退/缓存命中），结果回写 tech-plan §11。
3. 顺手做浏览器 UI 人工走查（上传→百科浏览/编辑/锚点跳转；建 3+ 场景节点）。
4. 跑 §5.4 对照实验（3 场景 × 3 次 × A/B 两组，B 组调 `assembleContext` 时 `bibleEntries: []` 即可）并存档 `fixtures/golden/rubric-YYYYMMDD.md`，盲评需人。
5. （可选）缺陷#5 drain 互斥；`moveSceneNode` 双 update 也可包事务（与 deleteSceneNode 同模式，本次未动）。
