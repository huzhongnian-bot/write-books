# 规格：SillyTavern 集成（sillytavern）

> 状态：**MVP v1.0（2026-08-02，已实现 + ST 1.18 实测验收通过，验收记录见 §五）**
> 实现：`src/lib/sillytavern/map.ts`（映射纯函数 + 16 单测）、`src/app/api/projects/[id]/sillytavern/`（lorebook / characters/[entryId] 导出端点）、项目页顶栏 `st-export.tsx` 导出入口。
> 关联：specs/bible.md（数据源）、specs/ingest.md §2.4（章节概述）、specs/generate.md §2.1（检索与组装，P3 复用）。

## 一、背景与目标

SillyTavern（ST）是成熟的 LLM 对话/角色扮演前端，拥有庞大的角色卡（charaCard V2）与世界书（World Info / lorebook）生态。本项目已有结构化百科（角色/设定/关系/情节线/时间线）、章节检索与生成管线——把这两者接通，用户即可在 ST 里直接用自己的书跑角色扮演、对话续写与灵感试探，而世界观事实由本项目单一维护。

可对接面有三个，按工程成本与价值排序：

- **A. 导出（本项目 → ST）**：bible → ST 世界书 JSON；character 条目 → charaCard V2 角色卡 JSON。纯格式转换、零 AI 调用、零新依赖
- **B. 导入（ST → 本项目）**：ST 角色卡 JSON/PNG → character 百科条目。需解析卡格式（PNG 还要解 tEXt chunk），中等成本
- **C. 聊天后端（本项目作 ST 的模型端点）**：提供 OpenAI 兼容 `chat/completions`，内部复用 `assembleContext`（bible + 章节检索注入）+ `callStreaming` 转发 ZenMux。价值最大（ST 对话全程带原作 RAG），成本也最大（SSE 透传、ST 参数兼容、会话管理）

**MVP = A**。理由：数据源（bible）已就绪且为用户校订后的高置信内容；格式均为公开规范；导出物立刻可在 ST 使用形成闭环；不引入任何运行期耦合，失败面只在格式映射本身。

## 二、MVP 设计（导出）

### 2.1 百科 → ST 世界书（lorebook JSON）

顶层结构 `{ "entries": { "<数字字符串>": entry } }`，`uid` 全表唯一。条目映射：

| bible 字段 | lorebook entry 字段 | 说明 |
|---|---|---|
| `name` + character 的 `data.aliases` | `key: string[]` | 触发词：角色别名一并进触发（检索词本质是专有名词，与 ingest §2.4 同理） |
| kind 标签 + `data` 渲染文本 | `content` | character 结构化渲染（性格/能力/口吻样例/成长线分段）；其余 kind 把 data 的字符串/数组字段按 `键：值` 逐行拼接（P0 这些 kind 允许 JSON 直改，形状有漂移，不写死字段名） |
| `anchors`（章节号+原文引用） | `comment` | 溯源信息（如「出自第 1 章」），不进触发不进注入 |
| — | `constant: false, selective: false, keysecondary: [], position: 0, order: 100, disable: false, probability: 100, useProbability: false, depth: 4` | ST 默认值；position 0 = before_char |

- 单条 `content` 渲染后截断 ≤500 字（防世界书膨胀挤占 ST 上下文；截断在句读处）
- 端点：`GET /api/projects/[id]/sillytavern/lorebook` → JSON 文件下载（`Content-Disposition: filename*=UTF-8''<作品名>-lorebook.json`）
- 入口：**项目页顶栏**「ST 世界书」（2026-08-02 评审定：入口统一放项目顶栏，不放百科页）

### 2.2 character 条目 → charaCard V2 角色卡 JSON

每条 character 一张卡：

| bible 字段 | 卡片 `data.*` 字段 | 说明 |
|---|---|---|
| `name` | `name` | |
| personality + abilities + growthArc 渲染 | `description` | 完整人设描述 |
| `data.personality` | `personality` | 摘要 |
| `data.speechPatternSamples` | `mes_example` | 渲染为 `<START>` 分隔的示例独白（无对话对数据，不编造 {{user}} 回合） |
| 口吻样例首条 | `first_mes` | 零 AI 原则：直接取既有口吻样例，不足则给静态模板占位，不用 AI 生成 |
| — | `scenario` 空、`system_prompt` 空、`creator_notes` 填「由 write-books 导出自《作品名》」 | 不污染用户 ST 全局预设 |
| 与该角色相关的 relationship 条目 | `character_book.entries`（可选，P0.5） | 卡内嵌关系小世界书；**注意字段命名不同**：embedded book 用 `keys`/`secondary_keys`/`insertion_order`/`position: "before_char"`（字符串），与独立世界书的 `key`/`keysecondary`/`order`/`position: 0`（数值）不通用 |

- 顶层：`{ "spec": "chara_card_v2", "spec_version": "2.0", "data": { ... } }`
- 端点：`GET /api/projects/[id]/sillytavern/characters/[entryId]` → 单卡 JSON 下载；入口为**项目页顶栏**角色卡选择导出（下拉选 character 条目后下载）
- `first_mes` 零 AI 占位为暂定方案——**TODO：用户实际看过开场白效果后评估是否破例用 AI 生成**（评估前不得自行改 AI 生成）
- **不做 PNG 卡**：PNG 角色卡需要立绘 + tEXt chunk 嵌入，P0 无立绘资产；ST 支持直接导入 JSON 卡

### 2.3 MVP 不做清单

- 不做 PNG 卡、不做 ST 侧任何回写、不做 bible→ST 的实时同步（改了重新导出即可，本地单用户）
- 不做导入（B）与聊天后端（C），见 §三
- 不引入新 npm 依赖、不改数据库 schema

## 三、后续阶段（非 MVP，仅记录方向）

- **P2 导入**：上传 ST 角色卡 JSON/PNG → character 条目（PNG 解 `chara`/`ccv3` tEXt chunk，base64 → JSON）；入口复用百科页新建条目 Dialog
- **P3 聊天后端**：`POST /api/st/v1/chat/completions`（OpenAI 兼容子集）——从 ST 消息中提取最近对话与触发名，`buildRetrievalTerms` + `searchSummaries`/`searchChunks` 检索原作段落，`assembleContext` 思路注入，`callStreaming` 转发 ZenMux 并透传 SSE；ST 侧配自定义 OpenAI 端点直连。usage 落 `ai_calls`（`purpose=st-chat`）
- **P4 素材回流**：ST 聊天记录导出 → 场景草稿/章节素材

## 四、技术要点

- 映射层收口 `src/lib/sillytavern/` 纯函数（`bibleEntryToLorebookEntry` / `bibleEntryToCharaCard` / `renderEntryContent`），无 DB 无网络，可单测；端点只做查库 + 调用映射 + 下载响应
- 格式依据：[charaCard V2 spec](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md)、ST World Info 字段约定（uid 唯一、entries 数字字符串 key、`key` 数组、position/order/depth 语义）
- 验收依赖真实 ST 导入实测（格式兼容性的唯一可信判据）；本地无 ST 时以规范逐字段比对 + JSON schema 自检代替
- 导出端点只读，无需事务；文件名 UTF-8 编码兼容中文作品名

## 五、验收标准

- [x] 西游记项目导出 lorebook：条目 = bible 条目数（character 别名展开），ST 1.18 导入落盘（`data/default-user/worlds/西游记.json`）与导出逐字节一致（2026-08-02 实测；对话触发高亮属 ST 标准 key 匹配行为，开聊时目视确认即可）
- [x] 孙悟空角色卡：ST 导入成功（ST 1.18 转存为 chara_card_v3 PNG，兼容 V2），first_mes/personality/description/mes_example/creator_notes 与百科逐字节一致（2026-08-02 实测）
- [x] 长 data 条目 content 截断 ≤500 字且断在句读处；uid 全表唯一（单测覆盖）
- [x] 映射纯函数单测覆盖五种 kind + aliases 展开 + 截断 + 空 data 兜底（16 例）
- [x] `npm run lint && npx tsc --noEmit && npx vitest run && npm run build` 全绿

### 实测备注（2026-08-02，ST 1.18.0）

- ST API 需 `GET /csrf-token` 拿 token + session cookie，之后所有 POST 带 `X-CSRF-Token`
- `POST /api/worldinfo/import` 走 multipart 实测 500——世界书导入是前端解析后经 `POST /api/worldinfo/edit`（body `{name, data}`）落盘；`/api/worldinfo/get` 回读有 quirk（落盘文件为准）
- 角色卡导入 `POST /api/characters/import`（multipart，`avatar` 字段 + `file_type=json`）直接吃 V2 JSON，落盘转 v3 PNG
- 遗留：`first_mes` 零 AI 效果待用户在 ST 开聊评估（§2.2 TODO）
