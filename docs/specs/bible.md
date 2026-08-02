# 规格：原作百科（bible）

> 对应模块：产品文档 §三 模块一产出物；实现：`/projects/[id]/bible`、`src/lib/db/schema.ts` 的 `bible_entries`。
> 关联：specs/generate.md（组装器消费百科）、specs/ingest.md（纯 RAG 摄取）。

## 一、背景与目标

百科是用户手动维护的「二创设定集」：角色/设定/关系/剧情弧/时间线五类条目，在生成上下文中标注「用户设定，优先级高于原作检索内容」。P0 目标：五类条目可浏览、可编辑、可新建，出处锚点可查。

**2026-07-29 起不再有 AI 抽取条目**：纯 RAG 摄取（specs/ingest.md）移除了抽取管线，原作事实由生成时的原文检索段落提供，百科只承载用户自建设定。`origin`/`editedByUser` 三态语义（ADR-005）保留——旧库的 extracted 条目仍按「校订」渲染，且为 P1 覆盖层（patches 表）留迁移路径；新建条目一律 `origin=user`。

## 二、设计

### 2.1 数据语义：origin 三态（ADR-005，向后兼容保留）

`bible_entries.origin`（`extracted` / `user`）× `editedByUser` 组合出三态：

| 语义 | origin | editedByUser | P1 patches 迁移 |
|---|---|---|---|
| 抽取原文，未改动（仅旧库存在） | extracted | false | — |
| 校订（修抽取错误，仅旧库存在） | extracted | true | modify patch |
| 二创新增（用户自建设定） | user | false | add patch |

- **编辑**条目：Server Action 更新内容；旧库 extracted 条目置 `editedByUser=true`，不新建条目
- **新建**条目：`origin=user`，UI 文案为「二创设定」
- 重摄取（P1）：不得覆盖 `editedByUser=true` 或 `origin=user` 的条目
- 生成组装器（specs/generate.md §2.1）：`origin=user` 或 `editedByUser=true` 的条目在上下文中标注「用户设定，优先级高于原作抽取内容」

### 2.2 页面 `/projects/[id]/bible`（Server Component + client 编辑岛）

- 分类 Tabs：setting / character / relationship / plot_arc / timeline_event，展示条目数
- 条目卡片：`name`、kind 徽章、`confidence < 0.7` 显示「待确认」（旧库抽取条目）、`editedByUser` 显示「已校订」（同上）、`origin=user` 显示「二创设定」
- 编辑：Dialog 表单——`name` + `confidence` + 按 kind 的 data 字段表单（character：aliases/personality/abilities/speechPatternSamples/growthArc；其余 kind P0 允许 JSON 直改）→ Server Action 经 zod 校验后落库
- 出处锚点：卡片展示 `anchors`（chapterSeq + quote）；点击弹出章节原文弹层并高亮 quote（P0 不做独立章节页）
- 空态：该 kind 无条目时提示「可手动新建二创设定」
- header 提供「下一步：编脚本 →」导航（流程闭环：百科 → 脚本 → 生成）

## 三、验收标准

- [ ] seed 数据下五类 Tab 可切换，卡片完整渲染（seed 仅 3 类有数据，空态正常）
- [ ] 编辑条目保存后刷新仍在；旧库 extracted 条目出现「已校订」徽章
- [ ] 新建「二创设定」条目：`origin=user`，徽章正确
- [ ] 锚点点击可看到对应章节原文与 quote 高亮
