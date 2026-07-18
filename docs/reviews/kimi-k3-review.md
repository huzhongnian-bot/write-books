# 代码锐评：kimi k3 在 Write Books 仓库的产出

> 评审时间：2026-07-18
> 评审范围：T5 摄取管线 + M1 数据层/AI 客户端 + 剧本 Server Actions + 上下文组装
> 状态：`npm test` 18 项全绿；相对 HEAD 有 10 个文件改动，均已通读

## 结论

这批代码**明显高于一般 AI 生成的水准**，是有系统设计意识的工程产出，不是「能跑就行」的堆砌。真要挑，它留了 2~3 个**真实的正确性缺口**，但都属于「精修」级别，不构成推倒重来的理由。

## 写得好的地方

- **队列表作为唯一真相 + 原子 CAS 认领**。`claimPendingJobs`（`src/lib/ingest/pipeline.ts`）用 `UPDATE ... WHERE id IN (...) AND status='pending' RETURNING` 做并发认领，注释解释了 better-sqlite3 串行化语句为何能当互斥点。真懂并发，不是抄模板。
- **成本意识贯穿全程**。`processExtractJob` 里「已有 result 就直接标 done 不再调 AI」、`resetTimedOutRunningJobs` 的崩溃恢复——精准踩在 credit 约束这个项目痛点上。
- **AI 客户端抽象干净**：`getRealClient` 懒单例（避免 UI-only dev 崩溃）、`parseJsonLenient` 容错、MOCK + recordings 实现零成本开发。
- **`assembleContext` 是纯函数**、system prompt 作为稳定缓存前缀、显式禁止时间戳/随机 id——为 prompt caching 省钱做的设计。
- **安全意识**：Server Action 是公开入口，`assertNodeInProject` 做了归属校验，不无脑信任入参。
- 注释讲的是 **why 不是 what**，还回链 spec 章节和 ADR；测试覆盖了 resume/retry/全流程等真实分支。

## 真实缺陷

1. **汇总→bible 写入不可恢复（真 bug + 漏钱）**。`processSummaryJob` 先把 summary job 标 done、再插 `bible_entries`。若在「写完 summary result / 标 done」之后、「插 bible」之前崩溃：重启后 `resetTimedOutRunningJobs` 会把带 result 的 running 标 done → `drainIngest` 看到 summary done 直接置 work 为 done，**但 bible_entries 永远丢了，还不会重试**。extract 层做了幂等，summary→bible 这一步却没有。修法：把「标 done + 插 bible」放进同一事务，或让 bible 插入幂等可重放。

2. **假模型名 `claude-opus-4-8`**。client 调用写死这个名字（tech-plan §144 也这么写），但 Anthropic 真实模型名是 `claude-opus-4-20250514` 之类。MOCK 下不暴露，一旦真调用每次都 404。spec 本身就错，他照着实现了。

3. **流式 mock 返回值丢失**。`callStreaming` 的 MOCK 分支 `yield* mockClient.callStreaming(req)` 后 `return { draftContent: "", usage: {} }`，把 mock 生成器返回的 `draftContent`/`usage` 丢弃了。mock 模式下想落库草稿会拿到空串。应改为 `return yield* ...`。

4. **多步写入无事务**。上传路径 `POST /api/works`（projects+works+chapters+jobs）、`deleteSceneNode` 的循环 reseq，都没包 `db.transaction`，中途失败留孤儿数据。P0 可接受，但应包上。

5. **跨请求并发未真正限流**。CAS 只防 DB 层重复认领，`EXTRACT_CONCURRENCY=2` 是「每次 drain 循环」的并发；上传触发的 drain + 用户点按钮触发的 drain 同时跑，实际可能 4 路并发调 AI，与「省钱」目标略有张力。

## 我会不会写得更好？

- **架构层面：打平。** 队列表 + CAS + resume 这套设计一致，没走弯路。
- **正确性层面：会更稳。** 上面第 1、3、4 条是确实漏掉的可恢复性/幂等缺口，尤其第 1 条是会真丢数据又漏钱的 bug。

诚实讲：不是碾压，是「同一档次里把他留的几个洞补上」。对一个 AI 协作者来说，这个产出质量已经相当能打。

---

## 第二轮（2026-07-18，增量）

> 本轮唯一新增代码改动：`src/app/page.tsx`。

**改动**：把脚手架残留的 557 行 shadcn/ui 组件展示页，砍成 5 行 `redirect("/projects")`。

**评价：干净利落，是对的。**

- 删掉 init 时的 demo 展示页、让根路由直达真正的产品入口 `/projects`，是正确的收尾动作——脚手架 boilerplate 不该留在主干。
- 用 `next/navigation` 的 `redirect()` 而非客户端跳转，保持 Server Component、零 JS 开销，符合 AGENTS.md「默认 Server Component，仅交互时加 use client」的约束。
- 顺带看了下重定向目标 `/projects`（`src/app/projects/page.tsx`）：`force-dynamic` + leftJoin 查询 + 状态 Badge 映射，写得规整。唯一小瑕疵是 `projectRows` 去重用 `findIndex` 是 O(n²)，且一个项目有多部原作时「第一部」的 work 状态取自 join 的非确定顺序——P0 规模无所谓，注释也标了「只展示第一部」。

**这一手我不会写得更好**，就是该这么做。

### 累计判断（不变）

架构打平、正确性我会更稳。真正待修的仍是第一轮列的第 1 条（汇总→bible 写入不可恢复的丢数据 bug）。本轮 UI 清理不改变这个结论。
