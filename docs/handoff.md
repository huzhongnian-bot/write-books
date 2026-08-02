# 工作交接单（Handoff）

> 首次记录：2026-07-18（Kimi K3 coding plan 额度用尽，工作中断）
> 续做记录：2026-07-19（额度恢复，T12 收尾 + 缺陷修复完成）
> 续做记录：2026-07-21（真实 API 验收准备：缓存断点 + 流式 usage 修复；**真实 API 受阻于无有效 key**）
> 重构记录：2026-07-25（**可用性重构**：用户实测「完全不可用」→ 全链路诊断 + 修复 + 文档翻新）
> 切换记录：2026-08-02（**AI 接入切换 ZenMux OpenAI 兼容协议**：`@anthropic-ai/sdk` → `openai` SDK，端点 `OPENAI_BASE_URL=https://zenmux.ai/api/v1`（key 同用户 ZenMux 账户），默认模型 `anthropic/claude-sonnet-4.5`；ZenMux 境外端点需代理，`.env.local` 配 `HTTPS_PROXY=http://127.0.0.1:7897`、client 据此启用 undici 进程级代理。usage 归并为内部 TokenUsage 形状（`prompt_tokens_details.cached_tokens` → cache_read）。**坑同前：终端环境同名变量覆盖 .env.local**——用户 PowerShell profile 的 `ANTHROPIC_*` 曾致 dev server 连不通 zenmux anthropic 端点。同批：章节概述支持勾选自选章节强制重生成，`POST /api/works/[id]/summarize` 接受 `{ seqs }`）
> 真相基准：以下状态由实跑 `tsc / vitest / eslint / build / 端到端 smoke` 核实。

## 当前验收命令实测状态（2026-07-25）

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 无错误 |
| `npx vitest run` | ✅ 26 tests / 6 files 全绿（每 worker 独立临时库） |
| `npm run lint` | ✅ 无错误无警告 |
| `npm run build` | ✅ 通过（Next.js 16.2.10 Turbopack） |

端到端 smoke（全新空库 + `MOCK_AI=1` + dev server，2026-07-25）：首跑 `/projects` 200（自动迁移建表）→ 上传 fixture → 13/13 jobs done → **bible 25 条五类齐全**（12 个 extract result 互不相同）→ 列表/百科/脚本页导航入口齐全 → SSE 生成 120 delta + done（含 `parentDraftId`，版本链正确）→ 导出 TXT 200（标题+正文）→ workError 经 status API 透出 → summary 唯一索引拦重复创建 ✅。

## 2026-07-25 切换 Kimi 端点 + 真实 API 验收通过

**背景**：Anthropic 直连区域 403、zenmux 中转超时，真实 API 长期不可用。用户要求「换成 Kimi 的链接方式」。经查 [Kimi Code 官方文档](https://www.kimi.com/code/docs/en/)：Kimi Code 提供 Anthropic 兼容端点 `https://api.kimi.com/coding/`（SDK 标准的 `ANTHROPIC_BASE_URL` + key 即可），模型 `kimi-for-coding`（全会员）/ `k3-256k` / `k3`。

**改动**：
- `.env.local`：`ANTHROPIC_BASE_URL=https://api.kimi.com/coding/`、`AI_MODEL=k3-256k`（现有 sk-kimi key 实测三模型全通）。**坑：终端进程环境里的同名变量会覆盖 .env.local**（dotenv 不覆盖已有环境变量）——本机 shell 里的 zenmux `ANTHROPIC_BASE_URL` 曾因此生效，启动 dev 前需 unset
- 模型名不再写死：`client.ts` 导出 `DEFAULT_MODEL`（env `AI_MODEL`，默认 `kimi-for-coding`），pipeline/generate 三处引用；thinking 块自动被 `type==="text"` 过滤，流式/结构化/cache_control 均验证兼容

**真实 API 验收（西游记 12 回，k3-256k）**：12/12 章节抽取 done → 全书汇总 done → **bible 25 条真实条目**（character 13/setting 8/relationship 2/plot_arc 2）→ 真实流式生成 488 字段落 → ai_calls 全记录（含 2 条失败埋点）。

**验收中修掉的三个真实坑（mock 测不出来）**：
1. **summary JSON 截断**：k3 thinking 计入 max_tokens，4096 被 thinking+JSON 顶穿 → 截断 JSON 解析失败。修：summary `maxTokens: 12288`
2. **summary 生成超时（三连）**：探针实测全书汇总输出 18,674 字符、耗时 288.5s（k3-256k 约 65 字/s），120s/240s 超时都不够。修：client 支持按请求 `timeoutMs`，summary 放宽到 420s；`RUNNING_TIMEOUT` 相应提到 15min（须 > 最坏调用 840s）；**`SUMMARIZE_ARC_SYSTEM` 加产出总量控制**（≤25 条、单条 ≤120 字、anchors ≤2 个）——从源头压缩输出时长
3. **成功后 stale 错误**：续跑 drain 成功置 done 时未清 `ingestError`（页面残留旧错误）。修：两处置 done 同时 `ingestError: null`

**恢复路径顺带验证**：summary failed 后重跑 drain，extract 12 章不重调 AI（result 幂等）、failed summary 不占唯一索引可重建 → 第四次 summary done，bible 落库 25 条无重复。

**遗留**：真实 API 下「二次生成缓存命中」未验证（Kimi 端点 cache 计费口径待观察，usage 已见 cache_read/cache_creation 字段）；§5.4 人工对照实验仍待做；浏览器人工走查（五套皮肤 + 全流程）待做。

## 2026-07-25 真实 API 试错：错误分类修正 + 失败埋点

用户关掉 mock（`MOCK_AI=0`）实测，章节抽取报「AI 服务请求失败（未知）：Request timed out」——暴露分类 bug：**SDK 的超时是 `APIConnectionTimeoutError`（`APIError` 子类但 status=undefined）**，落在 status 兜底分支。修复与加固：

- `toReadableAiError`：连接错误（`APIConnectionError`）先于 status 分支判断 → 正确提示「无法连接 AI 服务（网络不通或请求超时）」；补 404（模型/路径）分支；兜底文案去掉误导性的「未知」
- **失败埋点**：`ai_calls` 加 `error` 列（迁移 `0002`），AI 调用失败落一行（分类后原因，tokens 留空）——ai_calls 兼作健康看板；埋点自身失败不掩盖原始错误（try/catch + console.error）
- `timeout 180s→120s`、`maxRetries 2→1`：单次调用最坏 240s < job running 超时 300s，卡死请求能及时落 failed
- **构建并发迁移竞态**：`next build` 多 worker 并发跑启动迁移，落败方撞 "duplicate column" 致 build 失败——`db/index.ts` 迁移失败后复核「库已最新」则安全放过（逐迁移事务保证一致性），旧库检测逻辑不变
- 测试：`client.real.test.ts` mock 工厂带真实 SDK 错误类，新增超时/401 两个失败用例（断言分类文案 + `ai_calls.error` 落库）；31 tests 全绿 + build 绿

## 2026-07-25 文学主题换肤（新增功能）

- **需求**：按文学题材给项目工作区换肤，首批五套：校园文学 / 西方幻想 / 东方武侠 / 都市文学 / 星际科幻。规格：[specs/theme.md](./specs/theme.md)。
- **实现**：`projects.theme` 列（迁移 `0001_project-theme`）；`globals.css` 五套 `[data-theme]` 语义 token 块（含字体/圆角/背景纹理）；`[id]/layout.tsx` + `ThemeSkin`（SSR 内联脚本防闪切，挂 `<html>` 覆盖 portal 弹层）+ 顶部窄栏 `ThemePicker`（即时切换 + action 持久化失败回滚）；上传表单可选主题；seed 演示项目「东方武侠」。
- **验证**：`setProjectTheme` 3 单测；上传带主题落库 / 非法值 400；五套 token 全进生产 CSS；lint/tsc/vitest 29/build 全绿。浏览器逐套目视走查未做（遗留）。

## 2026-07-25 可用性重构

### 诊断（用户实测「完全不可用」的实锤原因）

1. **流程断裂（最致命）**：摄取完成后页面无任何入口通往百科/脚本/生成——三个核心页面只能手敲 URL 到达（`projects/[id]/page.tsx` 只渲染进度，无链接）。
2. **真实 API 无路出**：直连 `api.anthropic.com` 区域 403（0.8s 响应），中转 `zenmux.ai` 连接超时（20s），本机无代理监听。`.env.local` 已换 72 字符真实 key，但网络层不通。且失败零解释：`ingestError` 全代码无写入点（恒 null），上传 500 只说「请重试」。
3. **MOCK 演示空壳**：`fixtures/recordings/` 目录为空 → 12 章抽取全返回同一占位摘要、bible 仅 1 条、生成永远同两句话。
4. **首跑即崩**：新库无自动建表，全站 500；README 是脚手架模板（无启动说明）。
5. **并发 drain 可致 bible 翻倍**（严重）：summary job「先查再插」非原子，UI 上重复触发 drain 真实可达 → summary 重复执行、bible_entries 插两遍、双倍 API 花费。
6. 其余：断线误报「内容未保存」（服务端先落库再发 done）、测试写共享 `./sqlite.db`（flaky readonly + 污染）、轮询永不停止、`moveSceneNode` 无事务、baseDraftId 残留、NodeForm 切换丢编辑、metadata 模板文案、无 error boundary、seed 自写正则只切出 1 章（不认中文数字「第一回」）。

### 修复清单（全部落地并验证）

**后端**
- **启动自动迁移**：`drizzle-kit generate` 产出 `drizzle/0000_init.sql` 随仓库提交（`.gitignore` 解绑），`src/lib/db/index.ts` 启动即 migrate——新库零命令可用；旧 push 建库的文件收到明确中文报错（提示删除重建）而非沉默崩溃。
- **drain 幂等**：`drainIngest` 同进程按 workId 互斥；新增部分唯一索引 `ingest_jobs_one_open_summary_per_work`（pending/running 唯一，failed/done 可重建）；汇总失败 job 置 failed + work failed 可重跑。
- **错误可见**：work failed 时 `ingestError` 落首个失败原因（extract/summary 两级）；`client.ts` 新增 `toReadableAiError`（401→key 无效、403→区域限制配中转、429→限流、5xx、网络不通→查代理/`ANTHROPIC_BASE_URL`）；client `timeout 180s`（< job running 超时 5min）、`maxRetries 2`；上传 500 透传真实原因。
- **测试隔离**：`src/test-setup.ts` 下发每 worker 独立 `tmp-test-<pid>.db`（启动迁移自动建表），不再写 `./sqlite.db`；bible actions.test 不再依赖复制开发库。
- **seed 修复**：改用与上传路径同一个 `splitChapters`（修 1 章 bug）；补 `scene_drafts`/`ai_calls` 清库（FK 顺序）。

**前端**（子代理实施，curl + Next-Action 协议验证）
- **导航闭环**：列表按状态给 进度/百科/脚本 入口；详情页完成态给「查看百科/去编脚本」；百科页「下一步：编脚本」；脚本页「返回百科/返回项目」；layout metadata 改产品名；新增全局 `error.tsx`。
- **ingest-progress**：done/failed 停止轮询；`workError` destructive Alert 展示；POST 非 2xx 有可见错误提示。
- **workbench**：断流文案改「可能已保存，请刷新版本链确认」；done 事件带 `parentDraftId`（客户端不再本地拼）；版本切换/模式切换时清除 baseDraftId 残留。
- **script**：`moveSceneNode` 包事务；切节点脏确认；新增**导出 TXT**（`GET /api/projects/[id]/export`，RFC5987 中文文件名）；**删除项目**（8 表事务级联 + Dialog 确认）。

**Mock 内容**（子代理实施）
- `fixtures/recordings/extract-chapter.json`：12 元素数组，逐回忠实原文（作者通读 256KB fixture 撰写）；mock 支持数组按调用序回放。
- `fixtures/recordings/summarize-arc.json`：25 条百科五类齐全（character 10 / relationship 5 / setting 4 / plot_arc 3 / timeline_event 3），42 个锚点 quote 经脚本核对命中原文，3 条低置信演示「待确认」。
- 流式生成 mock：3 变体西游记风格样文（450–479 字），按指令稳定 hash 选取，同一输入输出恒定。

**文档**
- `README.md` 重写（快速开始/Mock 与真实模式/命令表）；新增 `docs/architecture.md`（as-built 架构，与代码同步）；`docs/tech-plan.md` 标注归档（credit 预算计划失效，架构以 architecture.md 为准）；四篇 spec 同步 as-built；`AGENTS.md` 补迁移工作流与测试隔离约定。

### 遗留事项

- **真实 API 仍未验收**（网络层不通，非代码问题）：key 已在 `.env.local`；需可用的代理或中转 `ANTHROPIC_BASE_URL`（当前 shell 里的 zenmux 中转超时）。通后按 2026-07-21 节「key 到位后的验收跑法」执行 §11 真实 API 验收 + §5.4 对照实验。
- 已知刻意简化：mock extract 计数器是模块级，同进程二次摄取同一本书会回放最后一章（注释已标）；tmp-test-*.db 残留文件 gitignore 兜底，未自动清理。
- 浏览器人工交互走查仍未做（本轮验证为 curl/HTML 断言/Next-Action 协议级）；建议人工过一遍：上传→进度→入口→百科编辑→建 3 节点→生成三模式→版本回退→导出→删除。
- `/design*` 样张页仍是旧 fixture 驱动，未动。

---

## 历史记录（2026-07-18 ~ 2026-07-21）

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
