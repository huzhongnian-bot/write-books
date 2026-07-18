# 规格：原作百科（bible）

> 对应模块：产品文档 §三 模块一产出物；实现：`/projects/[id]/bible`、`src/lib/db/schema.ts` 的 `bible_entries`。
> 关联：specs/generate.md（组装器消费百科）、ADR-005（origin 三态）。

## 一、背景与目标

百科是「创作上下文引擎」的第一层资产，一切 AI 抽取结果都是带出处、可编辑的结构化数据。P0 目标：五类条目可浏览、可编辑、出处可查、低置信可识别；**用户编辑的语义被显式记录**——「校订」（修正抽取错误）与「二创新增」（偏离原作的自建设定）是两种语义，必须分开存储，为 P1 覆盖层（patches 表）留出直接迁移路径。

## 二、设计

### 2.1 数据语义：origin 三态（ADR-005）

`bible_entries.origin`（`extracted` / `user`）× `editedByUser` 组合出三态：

| 语义 | origin | editedByUser | P1 patches 迁移 |
|---|---|---|---|
| 抽取原文，未改动 | extracted | false | — |
| 校订（修抽取错误） | extracted | true | modify patch |
| 二创新增（用户自建设定） | user | false | add patch |

- **编辑**抽取条目：Server Action 更新内容并置 `editedByUser=true`，不新建条目
- **新建**条目：`origin=user`，UI 文案为「二创设定」，与「校订」明确区分
- 重摄取（P1）：不得覆盖 `editedByUser=true` 或 `origin=user` 的条目
- 生成组装器（specs/generate.md §2.1）：`origin=user` 或 `editedByUser=true` 的条目在上下文中标注「用户设定，优先级高于原作抽取内容」

### 2.2 页面 `/projects/[id]/bible`（Server Component + client 编辑岛）

- 分类 Tabs：setting / character / relationship / plot_arc / timeline_event，展示条目数
- 条目卡片：`name`、kind 徽章、`confidence < 0.7` 显示「待确认」、`editedByUser` 显示「已校订」、`origin=user` 显示「二创设定」
- 编辑：Dialog 表单——`name` + `confidence` + 按 kind 的 data 字段表单（character：aliases/personality/abilities/speechPatternSamples/growthArc；其余 kind P0 允许 JSON 直改）→ Server Action 经 zod 校验后落库
- 出处锚点：卡片展示 `anchors`（chapterSeq + quote）；点击弹出章节原文弹层并高亮 quote（P0 不做独立章节页）
- 空态：该 kind 无条目时提示「可手动新建二创设定」

## 三、验收标准

- [ ] seed 数据下五类 Tab 可切换，卡片完整渲染（seed 仅 3 类有数据，空态正常）
- [ ] 编辑条目保存后刷新仍在，出现「已校订」徽章
- [ ] 新建「二创设定」条目：`origin=user`，徽章正确
- [ ] 锚点点击可看到对应章节原文与 quote 高亮
- [ ] `confidence < 0.7` 条目有「待确认」标识
