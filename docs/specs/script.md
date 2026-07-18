# 规格：脚本大纲编辑器（script）

> 对应模块：产品文档 §三 模块三（MVP 形态：结构化大纲编辑器，非可视化画布）；实现：`/projects/[id]/script`。
> 关联：specs/generate.md（场景是生成的自然单位，组装器消费 sceneNode 的显式引用）。

## 一、背景与目标

脚本是「创作上下文引擎」的第三层：剧情线 → 场景节点序列 → 节点属性。P0 形态为**单条剧情线**的大纲编辑器（产品判断：多线与可视化画布是 P1/P2 工程黑洞），目标是让场景节点成为生成的精确输入：POV、参与角色、时地、情节要点、伏笔关联全部结构化。

## 二、设计

### 2.1 数据约定

- P0 每项目默认一条 `storylines`（进入脚本页时不存在则自动创建，不做剧情线管理 UI）
- `scene_nodes.seq` 为显示顺序，上下移动即交换 seq
- `characterIds`：存百科 **character 条目 name** 的数组（与 seed 数据及组装器检索约定一致；P0 不用条目 id，避免百科重建后悬空引用）
- `foreshadowRefs`：存任意百科条目 name 的数组，语义为「本场景呼应的伏笔/设定条目」

### 2.2 页面 `/projects/[id]/script`（RSC 列表 + client 编辑岛，Server Actions）

- 左侧：场景节点列表（序号 + title + POV/地点摘要），支持新建、删除、上移、下移
- 右侧：选中节点的属性面板——`title`、`pov`、`characterIds`（从百科 character 条目 checkbox 勾选；该作品无 character 条目时允许逗号分隔手输）、`time`、`place`、`beats`（Textarea）、`foreshadowRefs`（从全部百科条目 checkbox 勾选）
- 保存即持久化（Server Action + zod 校验），无需整页保存按钮（逐字段或逐面板保存均可，交互从简）
- 每个节点提供「去生成」链接 → `/projects/[id]/write/[sceneId]`

## 三、验收标准

- [ ] seed 数据的 3 个场景节点完整展示
- [ ] 新建节点、编辑各属性、刷新后仍在
- [ ] 上移/下移后顺序持久化
- [ ] characterIds 勾选百科角色后保存，重新打开选中状态正确
- [ ] 删除节点有确认，删除后列表与 seq 正确
