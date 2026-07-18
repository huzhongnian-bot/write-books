# 规格：场景生成（generate）

> 对应模块：产品文档 §三 模块四 + §5.2；实现：`src/lib/ai/assemble-context.ts`、`POST /api/scenes/[id]/generate`、`/projects/[id]/write/[sceneId]`。
> 关联：specs/bible.md（用户设定标注）、tech-plan §5.2/§5.4（缓存策略、对照实验）。

## 一、背景与目标

每次生成一个场景（800–3000 字），流式输出，用户始终在环内。P0 验证核心假设「结构化百科 + 上下文组装能显著提升生成质量」（对照实验见 tech-plan §5.4）。

## 二、设计

### 2.1 上下文组装器（纯函数，`src/lib/ai/assemble-context.ts`）

```
assembleContext({ bibleEntries, sceneNode, priorDrafts, mode, instruction })
  => { system, messages }
```

- **system**（稳定前缀，单个 cache 断点）：冻结写作规范 + 百科核心（全部条目按 kind 分组渲染；`origin=user` 或 `editedByUser=true` 的条目额外标注「用户设定，优先级高于原作抽取内容」）。system 与百科**合并为一个前缀**——断点若不足最低可缓存长度会静默不缓存，合并后实际生效的是合并前缀
- **铁律**：前缀中绝不出现时间戳/随机 ID；百科被编辑后缓存重建是预期行为
- **messages**（动态部分，按序）：
  1. 本场景上下文：按 `sceneNode.characterIds` 显式引用检索角色档案 + 口吻样例；按 `foreshadowRefs` 检索伏笔条目；P0 不做全库扫描/语义检索（P1）
  2. 前文：最近 1–2 个场景的「当前稿」（该节点最新 draft）全文，合计超 6000 字时截断更早的
  3. 用户指令模板，三模式：`instruct`（按指令生成）/ `continue`（续写当前稿）/ `rewrite`（以 baseDraft 为底局部重写）
- **P0 决策（与原设计 §5.2 的偏差，明确记账）**：「更早场景摘要链」砍掉——没有任何任务/prompt 负责生成场景摘要，且 P0 单线脚本场景数少，全文放得下；P1 场景增多时再立摘要生成任务
- 可单测：「角色 A 出场 → 其口吻样例必在 system 或 messages 中」；snapshot 固化 prompt 结构，prompt 变更 diff 一目了然

### 2.2 SSE 接口（`POST /api/scenes/[id]/generate`）

- 请求：`{ mode: "instruct" | "continue" | "rewrite", instruction: string, baseDraftId?: number }`
- 事件：`event: delta` `{text}` / `event: done` `{draftId, usage}` / `event: error` `{message}`
- `done` 时服务端已落库新 `scene_drafts`（`parentDraftId` = baseDraftId ?? 该节点此前当前稿 id）+ `ai_calls`（含 `cache_read_input_tokens`）
- **中断**：客户端关闭连接即停止生成，半成品**不落库**（版本链只存完成稿）
- `MOCK_AI=1`：mock 流式回放（30ms/chunk），全流程不碰 API key

### 2.3 工作台 `/projects/[id]/write/[sceneId]`（client 岛）

- 三栏：场景要点（sceneNode 属性只读 + 返回脚本页）/ 正文（当前稿 + 流式渲染）/ 指令输入（三模式切换 + 版本链下拉）
- 版本链下拉：切换查看历史稿；「基于此稿重写」= rewrite 模式、以选中稿为 baseDraftId
- 生成中禁用输入与按钮，显示可中断（关闭即中断）

## 三、验收标准

- [ ] `MOCK_AI=1`：流式打字可见，done 后刷新页面当前稿仍在
- [ ] 三模式各生成一次，版本链产生 3 条记录，可回退查看任一历史稿
- [ ] 生成中途关闭页面：不产生半成品 draft
- [ ] `ai_calls` 有对应记录（真实 API 时含 `cache_read_input_tokens`，二次生成应见缓存命中）
- [ ] 组装器单测（含「口吻样例必在」用例）+ snapshot 全绿
