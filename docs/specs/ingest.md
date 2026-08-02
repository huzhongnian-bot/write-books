# 规格：原作导入与摄取（ingest）

> 对应模块：产品文档 §三 模块一；实现：`src/lib/ingest/split.ts`、`src/lib/retrieval/chunks.ts`、`src/app/api/works/`、`/projects` 页面。
> 关联：specs/generate.md §2.1（检索段落如何被消费）。

## 一、背景与目标

把用户上传的 TXT 原作切分成章节并建立全文检索索引，供生成时做无模型 RAG（按场景关键词检索原作段落注入上下文）。

**2026-07-29 起为纯 RAG 摄取**：原「逐章 AI 抽取 + 全书汇总生成百科」管线（ingest_jobs / drain / 重试 / 进度轮询）已整体移除——上传 = 解码 + 切分 + 建索引，全部在请求事务内同步完成，上限规模实测秒级完成，上传即完成、零 API 成本。生成时 prompt 只注入检索命中的段落，与原作体量解耦，故上限只防病态大文件撑爆内存（全文 + 切块驻留内存、单请求同步建索引），不再为上下文窗口设限。跨章综合（情节线/时间线）与可校订的抽取百科随之一并放弃，百科变为纯用户维护（见 specs/bible.md）。

## 二、设计

### 2.1 上传（`POST /api/works`，multipart 表单）

- 字段：项目名、TXT 文件、文学主题（可选）
- **编码**：`decodeText()`（`src/lib/ingest/split.ts`）——BOM 优先（UTF-8 BOM / UTF-16LE / UTF-16BE，UTF-16 误判 GBK 会成不可恢复的乱码），无 BOM 则先按 UTF-8 严格解码（`TextDecoder` fatal 模式），失败按 GBK 解码（iconv-lite）。中文网文 TXT 大量为 GBK / UTF-16，不做探测会乱码
- **切分**：`splitChapters()`——边界 = 「第X章/回/节/卷」或「卷X」章节头（行首锚定）+ 无编号小节标题启发式（前后皆空行、≤20 字、不含句读结尾、非引号/破折号开头、必含文字字符，排除 PUA 装饰分隔线等）；无匹配则全文作单章。切分前剥离游离 U+FEFF（trim 不移除，UTF-16 导出文件行首常残留）。首个边界前的内容（书名页等）丢弃
- **上限**：>2000 章或 >1000 万字 → 400 拒绝并提示（不替用户截断，由用户自行分卷）
- 成功路径：建 `projects` + `source_works` + `chapters` + `chapter_chunks` FTS 检索索引（`indexWorkChunks`），返回 `{ projectId, workId }`。**四步写入在同一事务内**（better-sqlite3 同步事务回调），中途失败不留孤儿数据
- 上传 500 透传真实错误原因（本地单用户，不藏诊断信息）

### 2.2 检索索引（`src/lib/retrieval/chunks.ts` + `chapter_chunks` FTS5 虚拟表）

- **分块**：`chunkChapterText()` 按段落贪心打包，目标 500 字/块；单段超 800 字按 500 字硬切
- **字级分词**：unicode61 会把整段中文当作一个 token，索引与查询两侧用 `spaceCjkChars()` 对 CJK 逐字加空格，退化为字级 BM25——角色名/地名等短词以短语匹配命中
- **生命周期**：索引无 FK，随 chapters 同生共死——上传事务内建立，删除项目时在同一事务显式清理（`deleteChunksForWorks`）
- **检索**：`searchChunks(workId, terms)`，FTS5 `bm25()` 升序取 top 3；检索词构建 `buildRetrievalTerms()` = 场景显式引用并集（角色 → 伏笔/设定 → 地点 → 标题），去重、去单字词、上限 10 个；无可用词直接返回空
- FTS5 虚拟表无法由 drizzle schema 建模，建表见手写迁移 `drizzle/0003_chapter_chunks.sql`；所有读写收口在 `src/lib/retrieval/chunks.ts`

### 2.3 上传后页面

- 上传成功跳转 `/projects/[id]`：**章节切分概览**（序号/标题/概述✓/字数 + 总章数总字数 + 百科/脚本入口）——纯 RAG 后唯一需要人工确认的是切分是否符合预期
- 项目列表：`/projects` 直接给 章节/百科/脚本 入口，无摄取状态门槛

### 2.4 章节概述（2026-08-01，AI 按需生成）

上传仍零 AI；概述是上传后第一个（可选的）AI 环节，服务三个消费方：两级 RAG 章节级检索（specs/generate.md §2.1）、AI 场景草案（specs/script.md §2.3）、以及后续任何需要章节级大意的场景。

- **触发**：项目页两种入口 → `POST /api/works/[id]/summarize`（SSE：`progress`/`done`/`error`）。**不引回后台任务管线**（ingest_jobs 已删），逐章调用、逐章落库、SSE 实时进度
  - 「生成章节概述/补全缺失概述」：不带 body，只补 `summary IS NULL` 的章
  - 「生成所选概述」：章节表格勾选后触发，body `{ seqs: number[] }`，只处理所选章、**含已有概述的（即强制重生成）**；seqs 含非正整数或作品内不存在的序号 → 400
- **断点续跑**：默认模式只处理 `summary IS NULL` 的章；客户端断开/单章失败后重跑不重复生成、不重复计费。单章失败即中止并报错，已落库章节保留
- **生成**：`SUMMARIZE_CHAPTER_SYSTEM`（`src/lib/ai/prompts/summarize-chapter.ts`），≤200 字、必须出现角色名/地名（检索词本质是专有名词，概述里没有名字就永远命中不了）；`purpose=summarize-chapter` 进 `ai_calls` 看板
- **落库**：`chapters.summary` 列（0005 迁移）+ `chapter_summaries` FTS5 虚拟表（0006 手写迁移，结构与分块表相同，CJK 逐字空格），每章「更新 + 索引」一个同步事务；读写收口 `src/lib/retrieval/chunks.ts`（`indexChapterSummary` 幂等先删后建/`searchSummaries`/`deleteSummariesForWorks`），随 chapters 同生共死（删除项目级联、`npm run db:reindex` 重建）
- **概述质量依赖模型，可重跑**：UI 勾选 + 「生成所选概述」即强制重生成（2026-08-02 起）；换模型批量重做仍可清 `chapters.summary` + `db:reindex`
- **查看入口**：`/projects/[id]/summaries` 纯 RSC 只读列表（序号/标题/概述全文，未生成的章占位提示），项目页顶栏「章节概述」进入（2026-08-02 起）

## 三、验收标准

- [x] 上传 fixture TXT（12 章）：事务完成即跳转章节概览，`chapter_chunks` 可检索（临时库 seed + 检索冒烟实测，2026-07-29）
- [x] 上传 GBK 编码 TXT：不乱码，章节数正确（split 单测 GBK fallback 覆盖）
- [x] 上传 UTF-16LE/BE（带 BOM）TXT：按 BOM 正确解码不乱码（split 单测覆盖，2026-08-01 真实 UTF-16LE 文件曾整库乱码）
- [ ] 上传 >2000 章或 >1000 万字文件：400 + 明确提示，不写库
- [x] 上限规模性能：60 章 / 28.7 万字合成文本建索引 ~160ms，单次检索 ~2ms（2026-07-29 基准实测）；2026-08-01 上限放宽至 2000 章 / 1000 万字，实测 978 万字 / 1000 章 / 2 万块建索引 ~1.4s、检索 ~28ms
- [x] 分块/字级分词/检索词/匹配转义/作品隔离/BM25 排序/按作品清理：chunks 单测 16 例全绿
- [ ] 章节概述：项目页触发后 SSE 进度可见，78 章全部 ✓；中断后重跑只补缺章；概述检索（`searchSummaries`）命中且作品隔离（chunks 单测覆盖索引/幂等/清理）
