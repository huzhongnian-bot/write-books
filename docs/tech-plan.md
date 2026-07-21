# 技术方案（v1.1）— 2000 Credit 落地版

> 基于 [product-design.md](./product-design.md) v0.3 产出的实施技术方案。
> **硬约束：全部实现工作由 Qoder 完成，总预算 2000 credit。** 本文档的每个技术决策都以此为第一约束——凡是"工程上更漂亮但更费 credit"的选项一律延后。
>
> 配套：[harness-engineering.md](./harness-engineering.md)（本版仅落地其最小子集，见 §9）

---

## 一、预算模型：2000 credit 意味着什么

### 1.1 Qoder credit 的消耗事实（据官方文档与社区实测）

- Credit 按 **token 用量 × 模型倍率** 动态扣费，不是按次；Agent 模式一次任务 = 后台 N 次模型调用 = N 次扣费
- 社区实测量级：**一次中等复杂度的 Agent 任务约 100–300 credit**；一次大范围代码库分析可烧 800 credit（其中上下文缓存读取占 ~70%）；让 Agent 反复试错装依赖可烧掉 ~150 credit
- **消耗大头是上下文缓存读取**：会话越长、Agent 读的文件越多，每一轮的成本越高

### 1.2 由此推导的三条总原则（贯穿全文）

1. **上下文最小化**：每个任务开新会话；人把规格贴进 prompt；指定文件清单，禁止 Agent 全库探索
2. **任务原子化**：把工程切成 12 个边界清晰、验收标准明确的任务，每个 50–260 credit，单任务失败不连坐
3. **机器活人来干**：装依赖、`npx shadcn add`、`drizzle-kit`、git 操作、起 dev server——全部由人在终端手动执行，0 credit

### 1.3 预算分配总表

| 项 | Credit |
|---|---|
| 12 个实现任务（§8 明细） | 1660 |
| 缓冲（返工、意外，~17%） | 340 |
| **合计** | **2000** |

> 注意区分两笔钱：**Qoder credit** 花在"写代码"上；**Anthropic API token**（摄取/生成的运行成本）走 `ANTHROPIC_API_KEY`，独立计费，不占这 2000。开发期用 fixture + mock，几乎不产生 API 成本。

---

## 二、范围裁剪：P0 的 2000-credit 子集

以产品文档 §六 的 P0 为基线，再做一轮减法。裁剪标准：**是否为验证核心假设（"结构化百科 + 上下文组装能显著提升生成质量"）所必需**。

### 做（In）

| 模块 | 范围 |
|------|------|
| 导入 | TXT 上传、编码探测、章节切分（**限 ≤60 章 / ≤50 万字**，超限提示截断） |
| 摄取 | 逐章结构化抽取 → 实体归并 → 全书汇总 → 写入百科；章节级状态 + 失败单章重试 |
| 百科 | 分类浏览、条目编辑、出处锚点跳转、低置信标记 |
| 脚本 | **单条**剧情线的大纲编辑器（场景节点列表 + 属性面板） |
| 生成 | 场景级 SSE 流式生成（指令生成 / 续写 / 局部重写）、版本链（线性 + 回退） |
| Harness 最小集 | fixture + seed、AI mock、上下文组装器单测 + snapshot、**人工质量评分卡（§5.4，0 credit）** |

### 不做（Out，全部有明确归属）

| 砍掉 | 归属 | 理由 |
|------|------|------|
| Batch API + 常驻 worker | P1 | ≤60 章规模用普通 API 顺序跑完全够；队列表以 `ingest_jobs` 最小形态纳入本版，但消费用按需 drain 而非常驻 worker（ADR-002） |
| 覆盖层（Overlay）、四大方向模板 | P1 | 产品 P0 本就不含；数据模型预留字段即可 |
| 多线脚本、交叉标注、可视化画布 | P1/P2 | 单线足以验证生成质量假设 |
| 一致性检查器、风格迁移、对话引导 | P1 | 生成的三种基础交互先跑通 |
| EPUB/PDF、导出、登录、支付 | P1+ | 产品文档已定 |
| evals 评测脚本（extract/generate） | P1 | 写评测脚本本身要烧 credit；P0 用 golden fixture 人工抽查 + §5.4 人工评分卡代替回归——**核心假设的验证手段不能一并砍掉** |
| Playwright 截图、skills 内容沉淀 | P1 | 提效设施；skills 挂载骨架（`.agents/skills/` + Claude stub）已建成 |

---

## 三、系统架构

**单体 Next.js 应用，本地单用户，无外部服务依赖**（除 Anthropic API）：

```
┌──────────────────────────────────────────────────────┐
│ Next.js 16 (Node runtime, next dev / next start 常驻) │
│                                                      │
│  UI (RSC + shadcn)          Route Handlers / Actions  │
│  /projects    ───────────▶  POST /api/works (上传切分) │
│  /…/bible     ─ actions ─▶  bible CRUD (Server Action)│
│  /…/script    ─ actions ─▶  script CRUD (Server Action)│
│  /…/write     ─ SSE ────▶  POST /api/scenes/:id/generate│
│                             GET  /api/works/:id/status │
│                    │                                  │
│              src/lib/ai/  ◀── 唯一的 @anthropic-ai/sdk │
│              （client / prompts / assembler / mock）    │
│                    │                                  │
│              src/lib/db/  SQLite (better-sqlite3)      │
│              + Drizzle ORM，zod schema 单一来源          │
└──────────────────────────────────────────────────────┘
```

关键架构决策（ADR 摘要，各一段理由，不另建 adr/ 目录——省 credit）：

- **ADR-001 SQLite + Drizzle + zod**：本地单文件、同步驱动（better-sqlite3）、seed/测试零配置；zod schema 一处定义，推导 DB schema、API 校验、抽取 structured-output schema 三处使用。P1 换 Postgres 只改驱动与方言。
- **ADR-002 摄取不用 Batch API，改用队列表 + 按需 drain**：本地 `next start` 是常驻 Node 进程，摄取拆为 `ingest_jobs` 队列表中的原子任务，**任务状态与产物只存这一张表**（`status` + `result` JSON 列），`chapters` 不持有抽取状态——一处真相，杜绝双写不同步。消费**不用常驻轮询 worker**：`next dev` 热重载会重复实例化模块，常驻 poller 有多副本重复消费（重复扣 API 费）的风险；改为**按需触发的 drain 循环**——入队后触发一次循环，消费到无 pending 为止。互斥采用**逐 job 原子 CAS**：`UPDATE ingest_jobs SET status='running' WHERE status='pending'`（`better-sqlite3` 同步单写器天然序列化），失败/超时的 job 由 `updatedAt` 超时机制（如 5 分钟）重置为 `failed`；前端轮询 status 时若发现"有 pending/failed 且无 running"（如进程重启后）可再次触发 drain，可恢复性由此闭环。50% 折扣对 ≤50 万字文本节省 <$2，换不来 Batch 基建的 credit 成本。**适用边界：drain 模型依赖长驻 Node 进程（本地 `next start` / 自托管），部署到 serverless（Vercel 等）后请求结束进程即冻结，drain 循环失效——P1 上线时若选 serverless，需引入独立 worker 或队列服务，这不是"只换数据库驱动"能覆盖的，届时另立 ADR。**
- **ADR-003 百科单表 + kind 判别式**：Setting/Character/Relationship/PlotArc/TimelineEvent 存一张 `bible_entries` 表，`kind` 字段 + `data` JSON 列（zod discriminated union 校验）。五张表 → 一张表，CRUD/UI/抽取写入全部只写一遍。类型安全由 zod 层保证。
- **ADR-004 生成走 SSE Route Handler**：`ReadableStream` 返回 `text/event-stream`（Next 官方支持的流式模式），不引 tRPC/socket 等任何新协议层。
- **ADR-005 百科条目 origin 三态**：`bible_entries.origin`（extracted/user）× `editedByUser` 区分「抽取原文 / 校订 / 二创新增」。二创改设定与修正抽取错误是两种语义，混在单一 `editedByUser` 字段会让重摄取策略与 P1 覆盖层（patches 表）都失去迁移依据；一个字段的成本，换 P1 数据模型不回迁。生成组装器据此给用户条目标注更高优先级。细则见 [specs/bible.md](./specs/bible.md) §2.1。

---

## 四、数据模型（Drizzle 表清单）

`src/lib/db/schema.ts`，zod 定义 → `drizzle-zod` 推导。字段只列关键项：

| 表 | 关键字段 | 说明 |
|---|---|---|
| `projects` | id, name, createdAt | 二创项目 |
| `source_works` | id, projectId, title, author, **ingestStatus**(idle/running/done/failed), ingestError | 原作；ingestStatus 即摄取任务状态 |
| `chapters` | id, workId, seq, title, content, charCount | 纯原文；抽取状态与产物一律看 `ingest_jobs` |
| `bible_entries` | id, workId, **kind**(setting/character/relationship/plot_arc/timeline_event), name, **data**(JSON), **anchors**(JSON: [{chapterSeq, quote}]), confidence(0–1), editedByUser | ADR-003；editedByUser=true 的条目重摄取时不覆盖 |
| `storylines` | id, projectId, title | P0 每项目默认一条 |
| `scene_nodes` | id, storylineId, seq, title, pov, characterIds(JSON), time, place, beats(text), foreshadowRefs(JSON) | 场景 = 生成单位 |
| `scene_drafts` | id, sceneNodeId, **parentDraftId**, content, instruction, model, createdAt | parentDraftId 构成版本链；"当前稿" = 该节点最新一条 |
| `ingest_jobs` | id, workId, **chapterId**（extract 时）, **kind**(extract/summary), **status**(pending/running/done/failed), **result**(JSON：本任务的结构化产物), error, attemptCount, createdAt, updatedAt | 摄取状态与产物的**唯一真相**；result 落库使重启后二三层可续跑；失败重置 status 即可重跑 |
| `ai_calls` | id, purpose, model, inputTokens, outputTokens, cacheReadTokens, createdAt | usage 落库（harness §4.4 最小实现） |

`source_works.ingestStatus` 是 `ingest_jobs` 的**去规范化缓存**（聚合状态），drain 每次变更 job 状态时应在同一事务中同步更新，避免双写不一致；P0 查询也可直接从 `ingest_jobs` 聚合，但缓存字段能减少轮询开销。Overlay 的 `patches` 表 P1 再建——`bible_entries.editedByUser` 已覆盖 P0 的"用户校订"需求。

---

## 五、AI 层设计（`src/lib/ai/`）

结构沿用 harness 文档 §4.1，两条铁律不变（业务代码不直接 import SDK；组装器是纯函数）。

### 5.1 摄取管线（简化版）

```
uploadTxt → 编码探测(iconv-lite) → 章节切分(正则: 第X章/卷 + 空行启发)
  → 写入 chapters + 为每章创建 ingest_jobs(kind=extract, status=pending) → 触发 drain
drainIngest(workId)（按需触发、非常驻；DB running 标记互斥，章级并发 2）:
  第一层 逐章: 循环认领 pending 的 extract job
            → extract-chapter prompt + structured output(zod→JSON Schema)
            → { summary, characters[], events[], settingClues[] } 写入该 job 的 result 列
            → status=done；失败 status=failed + error + attemptCount++
  第二层 归并: 全部 extract job done 后在同一次 drain 内执行
            → 输入 = 读取全部 extract job 的 result（重启后无需重跑第一层）
            → 代码为主（名字精确匹配 + 别名表），haiku 仅裁决疑似同名
  第三层 汇总: 创建并消费 ingest_jobs(kind=summary)，产物同样写 result
            → 一二层结构化产物(已压缩) 一次请求 → 主线/弧线/世界观
            → 写入 bible_entries（低置信 confidence<0.7 标记）
            → source_works.ingestStatus=done
恢复与重试: 前端轮询 status 时发现 pending/failed 且无 running（或 running job 已超时）→ 提示/触发再次 drain；
  "重试失败章节" = 将对应 failed job 重置为 pending 后触发 drain；
  互斥: 逐 job 原子 CAS + `updatedAt` 超时重置，避免全局锁崩溃后永久卡死
```

- 模型：逐章抽取与汇总 `claude-opus-4-8`，归并裁决 `claude-haiku-4-5`（产品文档 §5.3）
- 失败处理：单章 job `failed`，UI 提供"重试失败章节"；汇总失败可单独重跑（一二层产物已在 `result` 列落库）

### 5.2 生成管线

上下文组装器 `assembleContext(bible, sceneNode, priorScenes, drafts, instruction) => messages`，分层与缓存断点严格按产品文档 §5.2：

```
[system: 写作规范（冻结） ................. cache_control 断点①]
[百科核心（角色档案/设定/情节线，项目内稳定）... cache_control 断点②]
[动态检索: 本场景角色档案+口吻样例、伏笔条目、前 1–2 场景全文+更早摘要]
[用户指令（指令生成/续写/重写 三模式的模板）]
```

- 铁律：稳定前缀里**绝不出现时间戳/随机 ID**；百科被编辑后缓存重建是预期行为
- **缓存策略：断点②（百科核心）必须稳定且可复用。** Anthropic prompt caching 的 TTL 由平台控制（通常 5 分钟），用户侧不可自定义。真实写作节奏中"生成→阅读修改→再生成"往往超过 5 分钟，存在缓存过期导致每次全额重写的风险。P0 通过 `ai_calls.cache_read_input_tokens` 持续监测命中率；若命中率低于预期，优先用"主动复用"（如将 system prompt 与百科合并为一个前缀）和"压缩百科前缀长度"来降低 miss 成本，而非假设可调 TTL。落地后根据实测数据决定是否引入心跳维持等机制
- 已知细节：opus-4-8 的最低可缓存前缀是 **4096 token**——断点①（冻结 system prompt）若不足此长度会静默不缓存，实际起作用的是断点②（system+百科合并计算）。无害，但调试缓存时别按两级独立缓存排查
- SSE 协议（`POST /api/scenes/[id]/generate`）：`event: delta` `{text}` / `event: done` `{draftId, usage}` / `event: error` `{message}`。done 时服务端已把全文存为新 `scene_draft` 并记录 `ai_calls`

### 5.3 Mock 层（开发期零 API 成本）

- `MOCK_AI=1` 时 client 返回 mock 实现：抽取回放 `fixtures/recordings/*.json`；生成用固定文本按 30ms/chunk 模拟流式
- `npm run seed`：fixtures 小说 + golden 百科灌库 → 打开即有"已完成摄取"的项目，**UI 开发全程不碰 API key**

### 5.4 人工质量评分卡（0 credit，P0 核心假设的验证手段）

P0 的唯一假设是"结构化百科 + 上下文组装能显著提升生成质量"——evals 脚本砍到 P1 后，这个假设不能退化成"肉眼感觉不错"。用零代码成本的人工对照实验兜底：

- **对照设计**：固定 3 个场景节点（fixtures 提供），每个场景各生成 3 次——A 组走完整上下文组装器， B 组只给场景要点 + 用户指令（不注入百科）。生成结果匿名混排后盲评
- **评分卡**（1–5 分 × 5 项）：角色一致性 / 设定符合度 / 文风贴合度 / 情节推进有效性 / 伏笔呼应。评分记录存 `fixtures/golden/rubric-YYYYMMDD.md`
- **通过标准**：A 组在 5 项评分中至少 4 项高于 B 组，且总分均值高于 B 组，才算假设成立；不成立则优先修组装器而不是继续铺功能
- P1 的 `generate.eval.ts`（LLM-as-judge）直接复用这份评分卡定义，人工评分记录成为 judge 的校准数据

---

## 六、前端设计

页面清单（全部用现有 shadcn 组件拼装，**禁止新造基础组件**）：

| 路由 | 内容 | 主要复用组件 |
|---|---|---|
| `/projects` | 项目列表 + 新建（上传 TXT 表单） | Card, Table, Input, Progress |
| `/projects/[id]` | 概览 + 摄取进度（轮询 status） | Progress, Badge, Alert |
| `/projects/[id]/bible` | 左侧分类 Tabs + 条目卡片列表 + 编辑面板（Dialog） | Tabs, Card, Badge(置信度), Textarea |
| `/projects/[id]/script` | 场景节点列表（上下移/增删） + 右侧属性面板 | Table, Input, Textarea, Select |
| `/projects/[id]/write/[sceneId]` | 三栏：场景要点 / 正文（流式渲染） / 指令输入 + 版本链下拉 | Textarea, Button, Skeleton, Tabs |
| `/design` + `/design/bible` + `/design/generate` | 现有 kitchen-sink 迁移 + 两张样张页（fixture 驱动） | — |

- 默认 Server Component；仅生成工作台、脚本编辑器、上传表单为 client 岛
- `params`/`searchParams` 均 `await`（Next 16）；正文阅读区补 `--font-serif-reading` token 与 68–72ch 行宽（harness §3.1，只加 token 不做主题系统）

---

## 七、需人工预先完成的准备（0 credit）

Qoder 任务开始前由人在终端一次性完成，并 commit：

```bash
npm i drizzle-orm better-sqlite3 zod drizzle-zod iconv-lite @anthropic-ai/sdk
npm i -D drizzle-kit tsx vitest @types/better-sqlite3
npx shadcn@latest add dialog select scroll-area sonner   # 缺的组件一次补齐
mkdir -p fixtures/novels fixtures/golden fixtures/recordings src/lib/{db,ai,ingest}
# 下载公版小说节选（如西游记前 12 回）→ fixtures/novels/xiyouji-12ch.txt
# .env.local: ANTHROPIC_API_KEY=...   MOCK_AI=1
# package.json scripts 手工加: "seed": "tsx scripts/seed.ts", "test": "vitest run", "db:push": "drizzle-kit push"
```

---

## 八、实施计划：任务分解 × Credit 预算

每个任务 = Qoder 一个**新会话**，prompt 固定三段式：①贴本文档对应小节 ②文件清单（只许读/写这些）③验收命令。预估含 1–2 轮修复。

| # | 任务 | 交付物 | 验收 | 预算 |
|---|------|--------|------|------|
| T1 | 数据层 | `db/schema.ts`(zod+drizzle 全部表) + `db/index.ts` + `scripts/seed.ts` | `npm run db:push && npm run seed` 后查询有数据 | 150 |
| T2 | fixtures/golden | golden 百科 JSON 骨架（人工校订内容，Agent 只出结构） | zod 校验通过 | 50 |
| T3 | AI 封装层 | `ai/client.ts`(单例+MOCK_AI 分支+usage 落库) + `ai/mock/` + prompts 骨架 3 个 | 单测: mock 模式返回可解析结构 | 120 |
| T4 | 章节切分器 | `ingest/split.ts` 纯函数 + vitest（fixture 切出 12 章） | `npm test` 绿 | 80 |
| T5 | 摄取管线 | `ingest/pipeline.ts` 三层流程 + `ingest_jobs`(status+result 单一真相) + 按需 drain(逐 job 原子 CAS + updatedAt 超时) + 单章重试；暴露 `getIngestStatus(workId)` 供前端轮询 | mock 模式下跑通 fixture 全流程，bible_entries 有数据；单章失败重置后重跑成功；中途终止后再触发 drain 能基于 result 续跑不重复调用 | 280 |
| T6 | 上传+进度 | `POST /api/works`、status 接口、`/projects` 与 `/projects/[id]` 页 | 上传 fixture TXT→进度→done | 130 |
| T7 | 百科 UI | `/projects/[id]/bible` 浏览/编辑/锚点/置信标记 + Server Actions | seed 数据可浏览编辑，刷新持久 | 200 |
| T8 | 脚本编辑器 | `/projects/[id]/script` 节点 CRUD + 属性面板 | 建 3 节点、排序、编辑属性持久化 | 160 |
| T9 | 上下文组装器 | `ai/assemble-context.ts` 纯函数 + 单测("角色 A 出场→口吻样例必在 messages") + snapshot；P0 检索逻辑仅限 sceneNode 显式引用（characterIds/foreshadowRefs），不实现全库扫描/语义检索 | `npm test` 绿 | 120 |
| T10 | 生成工作台 | SSE 接口 + `/write/[sceneId]` 三栏 UI + 三模式 + 版本链 | mock 流式打字可见；重写产生新版本可回退 | 260 |
| T11 | /design 迁移+样张 | page.tsx→`/design`，bible/generate 两张 fixture 样张 | 三页可访问 | 50 |
| T12 | 收尾 | 全量 `lint+tsc+build` 修复、AGENTS.md 回写（命令/坑/spec 指针） | 三命令全绿 | 60 |
| | **小计** | | | **1660** |
| | **缓冲** | | | **340** |

**依赖关系**：T1→(T3,T4)→T5→T6；T1→T7/T8；(T3,T7 数据)→T9→T10；T11/T12 随时。T7 与 T5 可并行排期（数据来自 seed，不依赖摄取）。

### 里程碑与烧钱检查点（burn-rate）

每完成一个任务，在 Qoder Settings→Usage 记录实际消耗到下表（追加到本文档末尾）。**任一里程碑超支 >25% 即触发 §10 降级清单**：

| 里程碑 | 完成任务 | 累计预算上限 |
|---|---|---|
| M1 零 API 开发环境 | T1–T4 | 400 |
| M2 摄取闭环 | T5–T6 | 810 |
| M3 编辑器就绪 | T7–T8 | 1170 |
| M4 核心体验 | T9–T10 | 1550 |
| M5 收尾 | T11–T12 | 1660 |

---

## 九、Credit 纪律十条（执行军规）

1. **一任务一会话**，做完即关。长会话的缓存读取是最大的隐性消耗
2. **规格进 prompt，不让 Agent 考古**：把本文档相关小节直接贴入，附文件清单，明示"不要搜索或读取清单外文件"
3. **人干终端活**：装依赖、shadcn add、db:push、git、起 dev server——实测让 Agent 试错装依赖可烧 150 credit
4. **问答用 Ask，改代码才用 Agent**；Quest/多智能体模式全程禁用
5. **模型分级**：T4/T11 这类机械任务用低倍率模型（Qwen Plus 级）；T5/T9/T10 用 Max 级。可用则用非高峰时段折扣（UTC 14:00–24:00，北京时间 22:00–次日 8:00，Max 倍率降至 0.1x）
6. **验收一把梭**：让 Agent 用单条命令自查（`npm run lint && npx tsc --noEmit && npm test`），禁止多轮零敲碎打试错
7. **失败两轮即停**：同一错误 Agent 修两次不过，人工介入定位后再派新任务，不让它自愈循环
8. **UI 只拼不造**：只用 `src/components/ui/` 现有组件 + T7 前补齐的组件
9. **每任务记账**：实际消耗登记进 §8 表格，M 检查点核对
10. **AGENTS.md 保持 ≤60 行**：它被每个会话读取，每多一行全项目付费

---

## 十、降级清单（超支时按序执行）

| 序 | 降级 | 省 | 代价 |
|---|------|-----|------|
| 1 | 砍 T11（/design 样张） | −50 | 失去视觉验收入口 |
| 2 | T8 属性面板 → 纯表格行内编辑 | −80 | 编排体验降级 |
| 3 | T7 编辑态 → 只读浏览 + JSON Textarea 直改 | −100 | 校订体验降级，数据能力不变 |
| 4 | T10 砍"局部重写+版本分叉"，只留线性生成/续写 | −80 | 核心假设仍可验证 |
| 5 | T5 归并层 → 纯代码精确匹配（去掉 haiku 裁决） | −60 | 别名归一质量下降，golden 数据可兜底。**已于 T5 实现时执行（2026-07-18 记账）** |

全部执行可回收 370 credit ≈ 再造一个 T10 的空间。反向地，若 M4 后剩余 >500，可按 P1 顺序补：evals 脚本 → 导出 TXT → 一致性检查器。

## 十一、总验收（P0 Definition of Done）

- [ ] 上传 fixture TXT → 摄取完成，百科五类条目可浏览可编辑、锚点可跳转
- [ ] 建单线脚本 3+ 场景节点，属性完整
- [ ] 生成工作台：真实 API 下流式生成一个场景（800+ 字），续写、回退旧版本均可用；`ai_calls` 表记录含 `cache_read_input_tokens` 的 usage，二次生成缓存命中（验证平台 TTL 内的缓存经济性；若 TTL 实测不足，记录 miss 成本并回写缓存策略）
- [ ] §5.4 人工评分卡对照实验已完成一轮，A 组（完整组装）均分 ≥ B 组 +0.5，记录已存档
- [x] `MOCK_AI=1` 下上述全流程无 API key 可演示（2026-07-19 API 链路 smoke：上传→摄取→bible→SSE 生成全通；UI 页面未人工走查）
- [x] `npm run lint && npx tsc --noEmit && npm run build && npm test` 全绿（2026-07-19 实测）
- [x] AGENTS.md 已回写命令与坑（2026-07-19；credit 消耗表不再适用，执行者已切换 Kimi Code，见 §12 注）

---

*v1.2 — 2026-07-18。v1.2 变更：新增 ADR-005（百科 origin 三态）；降级清单第 5 条标记为已执行；补 `docs/specs/`（ingest/bible/generate/script）作为 T6–T10 的模块级规格。v1.1 变更：新增 §5.4 人工质量评分卡（P0 核心假设验证兜底）；§5.2 明确百科断点 1h TTL 与 4096 最低可缓存前缀；ADR-002 补充 serverless 适用边界；§11 验收项同步。实际消耗记录：（随任务完成追加）*

---

## 十二、实际进度记录

> 2026-07-18 起执行者切换为 Kimi Code，Qoder credit 记账不再适用；改为按任务记录完成状态。

| 日期 | 执行者 | 内容 | 状态 |
|---|---|---|---|
| （此前） | Qoder | T1 数据层 / T2 fixtures+golden / T3 AI 封装层+mock / T4 切分器 / T5 摄取管线 | ✅ 见 git log |
| 2026-07-18 | Kimi Code | Phase 0（分析后计划外增补）：specs 四篇（ingest/bible/generate/script）；ADR-005 origin 三态 + schema 落库；client.ts 懒加载单例 + JSON 容错解析；pipeline 原子 CAS、汇总 seq 改取 `chapters.seq`、attemptCount 累加；split GBK 编码探测；seed 清库顺序修复（补删 ingest_jobs） | ✅ lint/tsc/test 全绿（8 tests）+ seed 通过 |
| 2026-07-18 | Kimi Code | T9 上下文组装器：`ai/assemble-context.ts` 纯函数（spec generate.md §2.1：稳定前缀合并百科、显式引用检索、前文 6000 字截断、三模式指令）+ 10 单测（含「口吻样例必在」、用户设定优先标注、baseDraft 优先）+ snapshot 固化 prompt 结构 | ✅ lint/tsc/test 全绿（18 tests） |
| 2026-07-18 | Kimi Code | T6 上传+进度 / T7 百科 UI（含 actions.test）/ T8 脚本编辑器 / T10 生成工作台（SSE + 三栏 + 三模式 + 版本链）/ T11 /design 迁移+样张（根页改 redirect→/projects）| ✅ 代码就绪，tsc 绿 + test 23 全绿；⚠️ 未 commit、未跑 build、未端到端走查 |
| 2026-07-18 | — | **Kimi Code 额度用尽，工作中断。** 交接单见 [handoff.md](./handoff.md)。剩余：T12 收尾（先删遗留文件 `tmp-verify-generate.ts` 修 lint 红灯 → build → AGENTS.md 回写）+ §11 真实 API 验收项 + §5.4 对照实验 | ⏸ 待续 |
| 2026-07-19 | Kimi Code | T12 收尾 + 锐评缺陷修复：删 `tmp-verify-generate.ts`、修 mock unused warning（lint 转绿）、build 首验通过；缺陷#1 `processSummaryJob`「标 done + 插 bible」改同一事务；缺陷#4 `POST /api/works` 四步写入、`deleteSceneNode` 删除+reseq 包事务；pipeline 新增幂等回归测试（24 tests）。核实推翻两条：缺陷#2 模型名 `claude-opus-4-8` 经 SDK `Model` 类型证实为有效 ID（勿改）；缺陷#3 `callStreaming` MOCK 分支此前已是 `yield*` 透传。端到端 smoke（临时 DB + dev server）：上传→12 extract+1 summary 全 done→bible 落库→SSE delta/done→draft+ai_calls 落库，中断不落库 | ✅ lint/tsc/test 24 全绿 + build 绿 + API 链路 smoke 过；UI 未人工走查 |
| 2026-07-21 | Kimi Code | 真实 API 验收准备：修两个 mock 测不出的真实分支 bug——①生成请求补 `cache_control` 断点（spec generate.md §2.1，此前 §11 缓存验收必挂）②流式 usage 改取 `message_delta` 累计值（旧代码读不带 usage 的 `message_stop`，真实 API 会记全 0）；新增 `client.real.test.ts`（SDK mock，2 tests）。UI 页面 HTTP 级 smoke 8 页全过。**真实 API 受阻**：`.env.local` key 为占位符、直连 Anthropic 区域 403、无可用代理 | ✅ lint/tsc/test 26 全绿 + build 绿；⏸ 真实 API 验收与 §5.4 待有效 key（跑法见 handoff.md） |
