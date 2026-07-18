# 持续迭代工程体系（Harness / Design Engineering）

> 目标：让"人 + AI 编码代理"能够长期、高质量地迭代这个产品。当前已适配：Kimi Code、Claude Code（接触点见 §5.1 适配矩阵）。
> 核心思路：**把"什么是对的"沉淀为机器可验证的资产**——文档即规格、fixture 即合同、评测即回归、截图即验收。代理每次迭代都在这套护栏内工作，人只在护栏边界上做决策。
>
> 配套产品文档：[product-design.md](./product-design.md)

---

## 1. 总体结构：三层 Harness

```
┌─ 规格层（docs/）────────── 决定"做什么、为什么"
│   product-design.md        产品单一事实源
│   specs/<module>.md        模块级规格（数据模型 + 交互 + 验收标准）
│   adr/NNN-*.md             架构决策记录（为什么选 SQLite、为什么场景级粒度…）
│
├─ 实现层（src/ 约定）────── 决定"在哪做、怎么做"
│   AGENTS.md                代理入口：命令、约定、坑（保持精炼）
│   src/lib/ai/              AI 封装层：prompt 注册表、上下文组装器、mock
│   src/lib/db/schema.ts     zod schema 单一来源（DB / API / 抽取 schema 共用）
│
└─ 验证层───────────────── 决定"怎么算做对了"
    fixtures/                公版小说样本 + golden 数据（不调 API 也能开发）
    scripts/eval/            AI 质量评测（抽取准确性 + 生成质量 judge）
    /design 工作台 + 截图     UI 可视化自验证
    lint + tsc + build + 单测 常规 CI 门禁
```

**迭代闭环（每个功能都走一遍）：**

```
改规格（specs/*.md）→ 计划 → 实现 → 验证（tsc/测试/评测/截图）→ 回写文档（AGENTS.md/ADR）
```

规格先行不是官僚流程：规格文件就是给 Claude Code 的 prompt 素材，写清验收标准后，"实现 + 自验证"大部分可以交给代理完成。

---

## 2. 规格层建设

### 2.1 docs/ 目录规划

```
docs/
├── product-design.md        # 已有，v0.2
├── harness-engineering.md   # 本文档
├── specs/
│   ├── data-model.md        # 实体定义 + zod schema 摘录 + 关系图
│   ├── ingest.md            # 摄取管线：状态机、批处理、失败恢复、验收标准
│   ├── bible.md             # 原作百科：浏览/编辑/出处锚点交互
│   ├── script.md            # 脚本大纲编辑器
│   └── generate.md          # 生成工作台：SSE 协议、上下文组装规则、版本链
└── adr/
    └── 001-sqlite-drizzle.md 等
```

规格模板三段式：**背景与目标 / 设计（数据 + 接口 + 交互）/ 验收标准（可勾选清单）**。验收标准写成代理可自查的形式（"上传 fixtures 中的样本 TXT 后，章节数 = 12，且每章 token 数已落库"），而不是形容词（"解析准确"）。

### 2.2 AGENTS.md 维护纪律

AGENTS.md 是代理每次会话都读的文件，只放三类内容，超过 60 行就精简：

1. **命令**：dev / build / test / eval / seed 怎么跑
2. **硬约定**：技术栈版本坑（现有内容）、目录职责、"prompt 只能改 `src/lib/ai/prompts/`"这类边界
3. **指针**：改功能前先读对应 `docs/specs/*.md`

每次迭代结束，把新踩的坑回写进来（一行一个），这是复利最高的一件事。

---

## 3. Design 工程

### 3.1 设计令牌：单一来源

Tailwind 4 的 `@theme`（`src/app/globals.css`）是唯一的 token 定义处。为本产品补充语义 token（长文阅读是核心场景）：

- `--font-serif-reading`（正文阅读衬线字体）、阅读行高/行宽（约 68–72ch）
- 工作台三栏布局的面板宽度、批注色（一致性检查器的提示色阶）
- 明暗双主题从第一天就验证（写作者夜间使用比例高）

### 3.2 `/design` 组件工作台（把现有 kitchen-sink 变成资产）

当前 `src/app/page.tsx` 是一个 shadcn 全组件演示页——**不要删，把它迁到 `src/app/design/page.tsx`**，扩展成设计工作台：

```
/design            全组件 + token 总览（现有页面）
/design/reading    阅读排版样张（用 fixture 章节渲染真实中文长文）
/design/bible      百科条目卡片/编辑态样张
/design/script     大纲树 + 场景节点面板样张
/design/generate   生成工作台样张（流式打字效果用 mock 驱动）
```

价值：① 新组件先在样张页用 fixture 数据搭出来，再接真数据——UI 迭代不依赖后端与 API key；② 给代理一个**确定性的视觉验收入口**——每个样张页 URL 稳定、数据固定，截图可对比。

### 3.3 可视化自验证回路

给代理一条标准验收路径（写进 AGENTS.md）：

```bash
npm run dev          # 起 dev server
# 访问 /design/<页> 截图，对照 specs 中的交互描述自查
```

后续引入 Playwright 后升级为 `npm run screenshot`（遍历样张页出图到 `\.screenshots/`，git-ignore），UI PR 附前后对比图。人审美学，代理审还原度。

---

## 4. AI Harness（产品内 AI 能力的迭代护栏）

这是本产品最需要工程化的部分：prompt 和模型选择必须**可版本化、可回归、可离线**。

### 4.1 AI 封装层结构

```
src/lib/ai/
├── client.ts            # Anthropic client 单例；MOCK_AI=1 时返回 mock 实现
├── prompts/             # 每个 prompt 一个文件：模板 + 版本号 + changelog 注释
│   ├── extract-chapter.ts
│   ├── merge-entities.ts
│   ├── summarize-arc.ts
│   ├── generate-scene.ts
│   └── judge-consistency.ts
├── schemas/             # 抽取/生成的 zod schema（与 db schema 同源复用）
├── assemble-context.ts  # 上下文组装器：纯函数，输入结构化数据输出 messages
└── mock/                # 录制的真实响应回放
```

两条铁律：

1. **业务代码不直接 import `@anthropic-ai/sdk`**，只走封装层——模型升级、缓存策略调整、usage 记录都只改一处
2. **上下文组装器是纯函数**：`(bible, overlay, sceneNode, history, instruction) => messages`。可以单测（"角色 A 出场时其口吻样例必须在 messages 中"）、可以 snapshot（prompt 变更 diff 一目了然）、可以离线调试

### 4.2 Fixtures：不烧 token 的开发环境

```
fixtures/
├── novels/xiyouji-12ch.txt      # 公版小说节选（西游记前 12 回等），版权安全
├── golden/
│   ├── xiyouji-bible.json       # 人工校订的期望抽取结果（golden）
│   └── extract-ch01.json        # 单章抽取期望输出
└── recordings/                  # 录制的真实 API 响应（供 mock 回放）
```

- `npm run seed`：fixture 小说 + golden 百科灌入本地 SQLite → 打开项目就有一个"已完成摄取"的项目可用，**UI 开发全程零 API 调用**
- `MOCK_AI=1 npm run dev`：生成工作台回放录制响应（含模拟流式），演示与 E2E 都用它

### 4.3 评测（evals）：prompt 的回归测试

```
scripts/eval/
├── extract.eval.ts    # 跑 fixture 章节抽取，对照 golden 出 P/R 分数
├── generate.eval.ts   # 固定场景集生成 → LLM-judge 评分卡（一致性/文风/推进，1–5 分）
└── report.ts          # 输出 markdown 报告到 eval-reports/（入库存档）
```

- `npm run eval -- --only extract`，跑真实 API、有成本，**改 prompt/换模型时手动触发**，不进常规 CI
- 报告记录：prompt 版本、模型、分数、成本——"能不能把逐章抽取降级到 haiku"这类决策就看这份报告（对应产品文档 §5.3）
- judge 用固定评分卡 prompt + `claude-opus-4-8`，判分模型与被测模型分离

### 4.4 用量与成本可观测

封装层统一记录每次调用的 `usage`（含 `cache_read_input_tokens`）到本地表。开发期两个作用：① 缓存命中率下降立即可见（前缀被意外打破是最常见的静默成本事故）；② 成本模型（产品文档 §5.4）用真实数据校准。

---

## 5. 代理协作约定

> **工具中立原则**：规格三段式（§2.1）、DoD 自查清单（§5.2）、CI 门禁（§5.3）与具体编码代理无关，对任何代理同样适用；P0 阶段实现由 Qoder 执行（见 [tech-plan.md](./tech-plan.md)），其任务 prompt 应直接复用它们。AGENTS.md 是所有代理共读的入口，保持工具无关的措辞。代理专属机制只有两类——skills 内容沉淀（§5.1）与各工具的入口/权限配置文件——全部按 §5.1 的适配矩阵维护：新增代理只加一行矩阵 + 一份入口文件，不动本节其他内容。

### 5.1 代理适配矩阵 + 项目 Skills

**适配矩阵**（harness 与各编码代理的全部接触点，一处维护）：

| 接触点 | Kimi Code | Claude Code |
|--------|-----------|-------------|
| 入口指令 | 原生读 `AGENTS.md` | `CLAUDE.md` → `@AGENTS.md` 导入，单一来源仍是 AGENTS.md |
| 项目 skills | 原生扫描 `.agents/skills/`（另支持 `.kimi-code/skills/`） | 扫 `.claude/skills/`，内放同名 stub 指向 `.agents/` 正本 |
| 权限/设置 | 用户级 `~/.kimi-code/config.toml` 的 `[[permission.rules]]`；`.kimi-code/local.toml` 为机器私有，不入库 | `.claude/settings.json`（共享）、`settings.local.json`（个人，git-ignore） |

**Skills 单一来源在 `.agents/skills/<name>/SKILL.md`**（Kimi Code 原生扫描，也是跨工具通用约定）。Claude Code 不扫描该目录，故在 `.claude/skills/<name>/SKILL.md` 放 stub：frontmatter 的 name/description 与正本一致，正文仅一句指向正本。改 skill 先改 `.agents/` 正本，stub 只同步 frontmatter；不用符号链接（Windows 不友好）。skills 挂载骨架已建（`dod-check` 为验证示例），以下内容沉淀仍排在建设顺序（§6）最后一步：

| Skill | 内容 |
|-------|------|
| `dod-check` | 已建。按 §5.2 DoD 清单逐项自查并报告（兼作双代理挂载的验证） |
| `new-module` | 读对应 spec → 建 schema/route/组件骨架 → 建样张页 → 更新 AGENTS.md 指针 |
| `run-evals` | 跑评测 → 写报告 → 对比上次分数，退步则列出 prompt diff |
| `update-spec` | 实现与规格出现偏差时，引导"改规格还是改实现"的决策并同步文档 |

### 5.2 每次迭代的定义（Definition of Done）

写进 AGENTS.md，让代理自查：

- [ ] 对应 `docs/specs/*.md` 已更新（或确认无需更新）
- [ ] `npm run lint && tsc --noEmit && npm run build` 通过
- [ ] 涉及 UI：样张页可演示，附截图
- [ ] 涉及 prompt/模型：`npm run eval` 无回归，报告已存档
- [ ] 新坑回写 AGENTS.md

### 5.3 CI 门禁（GitHub Actions）

常规门禁：lint + typecheck + build + 单测（组装器/切分器等纯函数）。评测不进 CI（成本），但 PR 模板要求勾选"是否触碰 prompt，若是附评测报告链接"。

---

## 6. 建设顺序（harness 本身的 roadmap）

harness 不要一次建全，跟着产品 P0 的节奏铺：

| 步骤 | 内容 | 产出 |
|------|------|------|
| 1 | docs/specs 骨架 + data-model.md；page.tsx 迁 `/design`；建 fixtures（公版小说 + 手工 golden 初版） | 规格层可用，UI 开发解锁 |
| 2 | `src/lib/ai/` 封装层 + mock；SQLite + Drizzle + seed 脚本 | 零 API 开发环境 |
| 3 | 摄取管线（按需 drain 模型，Batch API 延至 P1）+ extract.eval | 第一个带回归护栏的 AI 能力 |
| 4 | 生成工作台 + 上下文组装器（含单测/snapshot）+ generate.eval | 核心体验 + 质量基线 |
| 5 | usage 看板、Playwright 截图、skills 内容沉淀（挂载骨架已建） | 迭代提效 |

判断 harness 是否成立的标准：**一个新会话的编码代理（Kimi Code / Claude Code），只读 AGENTS.md 和相关 spec，能独立完成一个模块迭代并自证质量**。达不到，说明规格或验证层有洞，补洞优先于写新功能。

---

*v1.2 — 2026-07-18。v1.2 变更：§5.1 改为代理适配矩阵 + skills 双挂载（正本 `.agents/skills/`，Claude Code 用 stub），去除 Claude Code 单一绑定；§6 判断标准泛化为任意已适配代理。v1.1 变更：§5 增加工具中立原则（P0 执行者为 Qoder，规格/DoD/CI 门禁对任何代理通用）。随首个模块落地后回顾修订*
