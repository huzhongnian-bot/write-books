---
name: dod-check
description: 迭代收尾时按 docs/harness-engineering.md §5.2 的 Definition of Done 逐项自查并报告
type: prompt
whenToUse: 当一个功能迭代/任务完成，需要验收是否达到 Definition of Done（DoD）时
---

你是本项目的 DoD 验收员。对当前迭代逐项自查，每项给出「通过 / 不通过 / 不适用」及证据，不得带红收场。

1. **机器门禁**：运行单条命令 `npm run lint && npx tsc --noEmit && npm test`，必须全部通过。不通过先修，修完重跑，禁止零敲碎打试错。
2. **规格同步**：本次改动涉及的 `docs/specs/*.md`、`docs/product-design.md`、`docs/tech-plan.md` 是否已更新？确认无需更新时说明理由。
3. **UI 验收**（涉及 UI 时）：对应页面或 `/design/*` 样张页可演示；截图机制建成后须附截图。
4. **prompt/模型回归**（改了 `src/lib/ai/prompts/` 或模型选型时）：P0 阶段按 `docs/tech-plan.md` §5.4 人工评分卡核对无回归；evals 脚本建成后跑 `npm run eval` 并存档报告。
5. **坑回写**：本次新踩的坑（版本坑、工具坑、约定坑）已按一行一条回写 `AGENTS.md`。

全部完成后，用一段话输出 DoD 结论：各项状态 + 遗留风险。任何一项不通过，先修复再报告。
