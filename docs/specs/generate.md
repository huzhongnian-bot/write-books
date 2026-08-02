# 规格：场景生成（generate）

> 对应模块：产品文档 §三 模块四 + §5.2；实现：`src/lib/ai/assemble-context.ts`、`POST /api/scenes/[id]/generate`、`/projects/[id]/write/[sceneId]`。
> 关联：specs/bible.md（用户设定标注）、tech-plan §5.2/§5.4（缓存策略、对照实验）。

## 一、背景与目标

每次生成一个场景（800–3000 字），流式输出，用户始终在环内。生成上下文 = 用户维护的百科设定 + 场景显式引用 + **原作检索段落（无模型 RAG）** + 前文。

**2026-07-29 架构转向**：原 P0 假设「AI 抽取的结构化百科能显著提升生成质量」已随纯 RAG 摄取（specs/ingest.md）放弃——抽取管线的成本/耗时与归并质量不值得，原作事实改由 FTS 关键词检索原文段落直接提供，百科只保留用户自建设定。若日后质疑生成质量，对照实验（tech-plan §5.4）可在检索词构建与注入策略上重做。

## 二、设计

### 2.1 上下文组装器（纯函数，`src/lib/ai/assemble-context.ts`）

```
assembleContext({ bibleEntries, sceneNode, priorDrafts, mode, instruction })
  => { system, messages }
```

- **system**（稳定前缀，单个 cache 断点）：冻结写作规范 + 百科核心（全部条目按 kind 分组渲染；`origin=user` 或 `editedByUser=true` 的条目额外标注「用户设定，优先级高于原作抽取内容」——纯 RAG 后百科即用户设定集，该标注常态生效）。system 与百科**合并为一个前缀**——断点若不足最低可缓存长度会静默不缓存，合并后实际生效的是合并前缀
- **铁律**：前缀中绝不出现时间戳/随机 ID；百科被编辑后缓存重建是预期行为
- **messages**（动态部分，按序）：
  1. 本场景上下文：按 `sceneNode.characterIds` 显式引用检索角色档案 + 口吻样例；按 `foreshadowRefs` 检索伏笔条目
  2. **原作相关段落（无模型 RAG，2026-07-29 落地）**：按场景显式引用（角色/伏笔/地点/标题）经 FTS5 字级 BM25 检索原文分块（`chapter_chunks`，实现 `src/lib/retrieval/chunks.ts`），至多 3 块注入；检索为空则不加该小节。词仅取显式引用——beats 内容词扩充、embedding 语义检索仍属 P1
  3. **原作章节概述（两级 RAG 粗召回，2026-08-01 落地）**：同一组检索词在概述索引（`chapter_summaries`）检索，至多 2 条注入，排在段落小节之前；概述由 `POST /api/works/[id]/summarize` 按需生成（specs/ingest.md §2.4），兜底正文未字面命中检索词的情节（如「背叛」这类抽象词）。未生成概述时该小节自然不出现
  4. 前文：最近 1–2 个场景的「当前稿」（该节点最新 draft）全文，合计超 6000 字时截断更早的
  5. 用户指令模板，三模式：`instruct`（按指令生成）/ `continue`（续写当前稿）/ `rewrite`（以 baseDraft 为底局部重写）
- **P0 决策（与原设计 §5.2 的偏差，明确记账）**：「更早场景摘要链」砍掉——没有任何任务/prompt 负责生成场景摘要，且 P0 单线脚本场景数少，全文放得下；P1 场景增多时再立摘要生成任务
- 可单测：「角色 A 出场 → 其口吻样例必在 system 或 messages 中」；snapshot 固化 prompt 结构，prompt 变更 diff 一目了然

### 2.2 SSE 接口（`POST /api/scenes/[id]/generate`）

- 请求：`{ mode: "instruct" | "continue" | "rewrite", instruction: string, baseDraftId?: number }`
- 事件：`event: delta` `{text}` / `event: done` `{draftId, parentDraftId, usage}` / `event: error` `{message}`
- `done` 时服务端已落库新 `scene_drafts`（`parentDraftId` = baseDraftId ?? 该节点此前当前稿 id）+ `ai_calls`（含 `cache_read_input_tokens`）；done 事件的 `parentDraftId` 取落库真实值，客户端版本链展示以此为准（不本地推算）
- **中断**：客户端关闭连接即停止生成，半成品**不落库**（版本链只存完成稿）
- `MOCK_AI=1`：mock 流式回放（30ms/chunk），全流程不碰 API key

### 2.3 工作台 `/projects/[id]/write/[sceneId]`（client 岛）

- 三栏：场景要点（sceneNode 属性只读 + 返回脚本页）/ 正文（当前稿 + 流式渲染）/ 指令输入（三模式切换 + 版本链下拉）
- 版本链下拉：切换查看历史稿；「基于此稿重写」= rewrite 模式、以选中稿为 baseDraftId
- 生成中禁用输入与按钮，显示可中断（关闭即中断）

## 三、验收标准

- [ ] `MOCK_AI=1`：流式打字可见，done 后刷新页面当前稿仍在
- [x] 检索段落（无模型 RAG）：组装器「命中注入/空不加」单测 + chunks 分块/检索/隔离/清理集成用例全绿（2026-07-29）
- [ ] 三模式各生成一次，版本链产生 3 条记录，可回退查看任一历史稿
- [ ] 生成中途关闭页面：不产生半成品 draft
- [ ] `ai_calls` 有对应记录（真实 API 时含 `cache_read_input_tokens`，二次生成应见缓存命中）
- [ ] 组装器单测（含「口吻样例必在」用例）+ snapshot 全绿
