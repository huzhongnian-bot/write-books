# 规格：原作导入与摄取管线（ingest）

> 对应模块：产品文档 §三 模块一；实现：`src/lib/ingest/`、`src/app/api/works/`、`/projects` 页面。
> 关联：tech-plan §5.1 与 ADR-002（drain 模型）、harness §4.2（fixtures）。

## 一、背景与目标

把用户上传的 TXT 原作转成结构化「原作百科」初稿（全自动初稿 + 用户校订模式的前半段）。P0 目标：≤60 章 / ≤50 万字规模下全流程可跑通、失败可恢复、单章可重试，开发期零 API 成本（`MOCK_AI=1`）。

## 二、设计

### 2.1 上传（`POST /api/works`，multipart 表单）

- 字段：项目名、TXT 文件
- **编码**：`decodeText()`（`src/lib/ingest/split.ts`）——先按 UTF-8 严格解码（`TextDecoder` fatal 模式），失败则按 GBK 解码（iconv-lite）。中文网文 TXT 大量为 GBK，不做探测会乱码
- **切分**：`splitChapters()`，正则「第X章/回/节/卷」+ 空行启发；无匹配则全文作单章
- **上限**：>60 章或 >50 万字 → 400 拒绝并提示（不替用户截断，由用户自行分卷）
- **token 估算**：P0 不引入 tokenizer 依赖，`charCount × 1.3`（中文 1 字 ≈ 1–1.6 token 取中位）仅用于展示量级；真实成本以 `ai_calls` 实测落库为准
- 成功路径：建 `projects` + `source_works`（ingestStatus=running）+ `chapters` + 每章 `ingest_jobs(kind=extract)`，触发 `drainIngest(workId)`（fire-and-forget，不阻塞响应），返回 `{ projectId, workId }`

### 2.2 摄取管线（T5 已实现，本 spec 固化 as-built 行为）

- 三层：逐章抽取（并发 2）→ 归并（**P0 为精确去重，无别名表、无 haiku 裁决**——tech-plan 降级清单第 5 条已执行）→ 全书汇总写入 `bible_entries`
- `ingest_jobs` 是摄取状态与产物的唯一真相（`status` + `result` JSON 列）；认领为**原子 CAS**：`UPDATE ... WHERE id IN (...) AND status='pending' RETURNING`，并发 drain 不会重复认领
- 失败：单章 `failed` 不连坐；「重试失败章节」= `retryFailedChapter` 重置 pending 后 drain；`running` 超 5 分钟重置 `failed`；`attemptCount` 只增不减
- 汇总输入的章节 `seq` 取自 `chapters.seq`（不是 job id）
- `source_works.ingestStatus` 是 job 聚合态的去规范化缓存，状态变更时同步更新

### 2.3 进度（`GET /api/works/[id]/status` + `/projects/[id]` 轮询）

- 前端每 2s 轮询 `getIngestStatus`
- 发现「有 pending/failed 且无 running」（如进程重启后）→ 提示并可再次触发 drain（`POST /api/works/[id]/drain`）
- 「重试失败章节」按钮逐章展示

## 三、验收标准

- [ ] `MOCK_AI=1` 下上传 fixture TXT（12 章）：状态 running → done，`bible_entries` 有数据
- [ ] 上传 GBK 编码 TXT：不乱码，章节数正确
- [ ] 上传 >60 章文件：400 + 明确提示，不写库
- [ ] 人为置一章 failed 后重试：该章跑通，其余章不重复调用 AI
- [ ] drain 中途杀进程后重新触发：已有 `result` 的 job 不重复调用 AI
- [ ] `npm test` 中 pipeline / split 用例全绿
