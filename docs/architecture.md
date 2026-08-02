# 当前架构（as-built）

> 与代码同步的现行架构文档。历史背景见 [product-design.md](./product-design.md)（产品方案）与 [tech-plan.md](./tech-plan.md)（已归档的预算实施计划）；模块级验收基准以 [specs/](./specs/) 为准。
>
> 最近结构性更新：2026-07-29「纯 RAG 摄取」——移除 AI 抽取管线（ingest_jobs/drain/重试/进度），上传 = 切分 + FTS 索引，生成上下文 = 用户设定 + 原文检索段落。

## 一、总览

单体 Next.js 16 应用，本地单用户，无外部服务依赖（除 Anthropic API）：

```
UI (RSC + shadcn)                Route Handlers / Server Actions
/projects       ──────────────▶  POST /api/works（上传+切分+FTS 索引，单事务，秒级完成）
/projects/[id]  ─ 章节切分概览（静态 RSC）
/…/bible        ─ actions ────▶  bible CRUD（Server Actions）
/…/script       ─ actions ────▶  script CRUD / 上下移（Server Actions）
                                GET  /api/projects/[id]/export（导出 TXT）
/…/write/[sid]  ─ SSE ────────▶  POST /api/scenes/[id]/generate
                       │
              src/lib/retrieval/  无模型 RAG：分块 + CJK 字级分词 + FTS5 BM25 检索
              src/lib/ai/   唯一 SDK 出入口：client / prompts / assembler / mock
                       │
              src/lib/db/   SQLite (better-sqlite3) + Drizzle，zod schema 单一来源
                            启动时自动跑 drizzle/ 迁移（新库零命令建表）
```

## 二、数据模型（`src/lib/db/schema.ts`）

| 表 | 要点 |
|---|---|
| `projects` / `source_works` / `chapters` | 项目（含 `theme` 文学主题皮肤列）→原作→章节原文 |
| `chapter_chunks` | FTS5 虚拟表（`0003` 手写迁移，drizzle 不建模）：章节分块的字级 BM25 检索索引，生成时无模型 RAG 数据源；读写收口 `src/lib/retrieval/chunks.ts`，无 FK、随 chapters 显式同生共死 |
| `bible_entries` | 用户设定集：单表 + `kind`（setting/character/relationship/plot_arc/timeline_event）+ `data` JSON；`origin`（extracted/user）× `editedByUser` 三态仅向后兼容旧库抽取条目（ADR-005），新建一律 `origin=user` |
| `storylines` / `scene_nodes` | 单线脚本；场景 = 生成单位（POV/角色引用/情节要点/伏笔引用） |
| `scene_drafts` | `parentDraftId` 构成版本链；当前稿 = 该节点最新一条 |
| `ai_calls` | 每次 AI 调用的 usage（含 `cache_read_tokens`），成本看板数据源；调用失败落 `error` 列（tokens 留空），兼作健康看板 |

表结构以 zod 为单一来源（drizzle-zod 推导），迁移由 `drizzle-kit generate` 产出、随仓库提交；**应用启动时自动执行**（`src/lib/db/index.ts`）。旧版 push 建库的 DB 文件（无 `__drizzle_migrations`）会收到明确报错提示删除重建，而不是沉默崩溃。

## 三、摄取管线（`src/lib/ingest/split.ts` + `src/lib/retrieval/chunks.ts`）

```
POST /api/works → decodeText(UTF-8→GBK 探测) → splitChapters（「第X章/回/节/卷」+空行启发，支持中文数字）
  → 单事务写入 project+work+chapters+chapter_chunks(FTS 索引) → 返回 { projectId, workId }
```

- **纯 RAG，无 AI 调用**：上传即完成（上限 60 章/50 万字实测建索引 ~0.3s），无后台任务、无进度页、无重试——原 extract/summary 管线（`ingest_jobs`、drain、CAS 认领、超时重置）已于 2026-07-29 整体移除
- 分块：段落贪心打包目标 500 字/块，单段超 800 字硬切；字级分词：CJK 逐字空格（unicode61 会把整段中文当一个 token）
- 索引无 FK：上传事务内建立，删除项目事务内显式清理（`deleteChunksForWorks`）
- 上传限制 ≤60 章 / ≤50 万字（超限 400 拒绝，用户自行分卷）；上传 500 返回真实错误原因

## 四、生成管线（`src/lib/ai/assemble-context.ts` + `POST /api/scenes/[id]/generate`）

- `assembleContext` 纯函数：system = 冻结写作规范 + 百科紧凑渲染（用户设定集，标注「用户设定·优先」；唯一 cache 断点，`cache_control: ephemeral`）；messages = 本场景显式引用（角色档案含口吻样例/伏笔；无条目时降级提示「参考原作检索段落」）+ **原作相关段落（FTS5 字级 BM25：检索词 = 角色/伏笔/地点/标题显式引用，至多 3 块）** + 前 1–2 场景当前稿（合计 ≤6000 字截断）+ 三模式指令（instruct/continue/rewrite）
- 铁律：稳定前缀绝无时间戳/随机 ID；百科被编辑后缓存重建是预期行为；<4096 token 时平台静默不缓存（命中率靠 `ai_calls.cache_read_tokens` 观测）
- SSE 协议：`delta {text}` / `done {draftId, parentDraftId, usage}` / `error {message}`；done 时服务端已落库 draft（先落库再发 done）
- 中断：客户端断开即停，半成品不落库、不记 ai_calls

## 五、AI 层（`src/lib/ai/`）

- `client.ts`：唯一 SDK 出入口，仅流式生成（`callStreaming`）。懒单例；`timeout 120s`、`maxRetries 1`；真实/流式调用统一经 `toReadableAiError` 分类为可行动中文提示（连接超时/断连先于 status 分支——SDK 超时是 status=undefined 的 `APIConnectionError`；401→key 无效；403→区域限制配中转；404→模型或路径；429→限流；5xx→稍后重试）；失败调用落 `ai_calls.error` 埋点（埋点自身失败不掩盖原始错误）
- **模型与端点**：模型名统一取 `DEFAULT_MODEL`（env `AI_MODEL`，默认 `anthropic/claude-sonnet-4.5`），业务代码不写死；接入走 OpenAI 兼容协议（`openai` SDK），端点/key 取 SDK 标准 `OPENAI_BASE_URL`/`OPENAI_API_KEY`。已验证可用：ZenMux 聚合网关 `https://zenmux.ai/api/v1`（模型名 `provider/model`，支持流式、`stream_options.include_usage`、`prompt_tokens_details.cached_tokens` 缓存观测；境外端点需代理，`HTTP(S)_PROXY` 存在时 client 自动启用 undici 进程级代理）
- `mock/`：`MOCK_AI=1` 时流式生成按指令稳定 hash 选 3 变体样文，30ms/chunk（结构化调用与录制回放已随抽取管线移除）

## 六、前端地图

| 路由 | 内容 |
|---|---|
| `/` | 307 → `/projects` |
| `/projects` | 项目列表（章节/百科/脚本 入口 + 删除项目）+ 上传表单（含文学主题选择） |
| `/projects/[id]` | 章节切分概览（序号/标题/字数 + 总量 + 百科/脚本入口） |
| `/projects/[id]/bible` | 五类 Tabs 浏览/编辑/新增条目/锚点弹层；「下一步：编脚本」 |
| `/projects/[id]/script` | 场景节点 CRUD/上下移/属性面板（切节点脏确认）；导出 TXT；返回链接 |
| `/projects/[id]/write/[sceneId]` | 三栏：要点 / 正文（流式）/ 指令（三模式 + 版本链下拉 + 基于此稿重写） |
| `/design*` | 组件样张页（开发用） |

全局 `src/app/error.tsx` 兜底 RSC 错误（重试 + 返回列表）。

### 文学主题换肤（specs/theme.md）

项目级皮肤（`projects.theme`）：`[id]/layout.tsx` 读库 → `ThemeSkin` 把主题写到 `<html data-theme>`（SSR 内联脚本防闪切，卸载还原），`globals.css` 的 `html[data-theme="x"]` 块重定义全部语义 token——shadcn 组件与 portal 弹层随之整体换肤。五套主题：校园/西方幻想/东方武侠/都市/星际科幻 + default。新增主题三处同步：`projectThemeEnum`、`globals.css`、`src/lib/themes.ts`。

## 七、测试与验收

- vitest：`src/test-setup.ts` 强制 `MOCK_AI=1` + 每 worker 独立 `tmp-test-<pid>.db`（启动迁移自动建表），不写开发库、worker 间不互锁
- 覆盖：split（含 GBK）、retrieval/chunks（分块/字级分词/检索词/转义/作品隔离/BM25/清理）、assemble-context（含「口吻样例必在」+ snapshot）、client mock/真实分支（SDK mock，cache_control 与 usage 归并、失败埋点）、bible actions、项目 actions
- 提交前四件套：`npm run lint && npx tsc --noEmit && npx vitest run && npm run build`

## 八、已知边界（P1+ 范畴，当前不做）

- 检索词仅取场景显式引用（角色/伏笔/地点/标题）；beats 内容词扩充、embedding 语义检索、跨章综合（情节线/时间线自动汇总）属 P1
- 百科无结构化抽取初稿，全靠用户手维护；一致性检查器（设定冲突检测）属 P1+
- Overlay 覆盖层、多线脚本、EPUB 导出、账号：P1+
