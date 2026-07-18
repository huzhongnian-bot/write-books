/**
 * T10 临时端到端验证脚本（跑完即删）。
 * 直接调用 route.ts 的 POST，验证：
 *  1. SSE 事件流 delta → done，done 后 scene_drafts / ai_calls 落库（mock usage 透传）
 *  2. 三模式版本链 parentDraftId：instruct→null，continue→当前稿，rewrite→baseDraftId
 *  3. 中断（AbortController）不产生半成品 draft、无 done 事件
 *  4. 参数校验：400（坏 mode / 跨节点 baseDraftId）、404（场景不存在）
 * 使用独立临时 DB 副本，不污染 ./sqlite.db。
 */
import fs from "node:fs";

process.env.MOCK_AI = "1";
process.env.DATABASE_URL = "./tmp-verify.db";

fs.copyFileSync("./sqlite.db", "./tmp-verify.db");

const { db } = await import("@/lib/db");
const s = await import("@/lib/db/schema");
const { eq } = await import("drizzle-orm");

// 清库（先子后父）
await db.delete(s.sceneDrafts);
await db.delete(s.aiCalls);
await db.delete(s.sceneNodes);
await db.delete(s.storylines);
await db.delete(s.bibleEntries);
await db.delete(s.ingestJobs);
await db.delete(s.chapters);
await db.delete(s.sourceWorks);
await db.delete(s.projects);

const [project] = await db
  .insert(s.projects)
  .values({ name: "验证项目" })
  .returning();
const [work] = await db
  .insert(s.sourceWorks)
  .values({ projectId: project.id, title: "验证小说", ingestStatus: "done" })
  .returning();
await db.insert(s.bibleEntries).values({
  workId: work.id,
  kind: "character",
  name: "孙悟空",
  data: {
    personality: "机智果敢",
    abilities: ["七十二变"],
    speechPatternSamples: ["俺老孙来也！"],
  },
  anchors: [],
  confidence: 0.9,
});
const [storyline] = await db
  .insert(s.storylines)
  .values({ projectId: project.id, title: "验证线" })
  .returning();
const nodes = await db
  .insert(s.sceneNodes)
  .values([
    {
      storylineId: storyline.id,
      seq: 1,
      title: "场景一",
      beats: "要点一",
      characterIds: ["孙悟空"],
      foreshadowRefs: [],
    },
    {
      storylineId: storyline.id,
      seq: 2,
      title: "场景二",
      beats: "要点二",
      characterIds: ["孙悟空"],
      foreshadowRefs: [],
    },
  ])
  .returning();

const { POST } = await import(
  "./src/app/api/scenes/[id]/generate/route"
);

interface SseEvent {
  event: string;
  data: string;
}

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}`, extra ?? "");
  }
}

async function runGenerate(
  sceneId: number,
  body: Record<string, unknown>,
  opts: { abortAfterFirstDelta?: boolean } = {}
) {
  const controller = new AbortController();
  const req = new Request(`http://test/api/scenes/${sceneId}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  const res = await POST(req, {
    params: Promise.resolve({ id: String(sceneId) }),
  });
  const events: SseEvent[] = [];
  if (!res.body) return { res, events };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (!raw.trim()) continue;
      let event = "message";
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      events.push({ event, data: dataLines.join("\n") });
      if (opts.abortAfterFirstDelta && event === "delta") {
        controller.abort();
      }
    }
  }
  return { res, events };
}

// ---------- 1. instruct：SSE 全流程 + 落库 ----------
console.log("[1] instruct 模式（场景二，无前序稿）");
{
  const { res, events } = await runGenerate(nodes[1].id, {
    mode: "instruct",
    instruction: "突出石猴的天真",
  });
  check(
    "Content-Type 为 text/event-stream",
    (res.headers.get("content-type") ?? "").includes("text/event-stream")
  );
  const deltas = events.filter((e) => e.event === "delta");
  const done = events.find((e) => e.event === "done");
  check("收到多个 delta 事件", deltas.length > 1, deltas.length);
  check("收到 done 事件", !!done);
  const doneData = done ? JSON.parse(done.data) : null;
  check(
    "done 携带 draftId 与 mock usage（cache_read_input_tokens=900）",
    doneData?.draftId > 0 &&
      doneData?.usage?.cache_read_input_tokens === 900,
    doneData
  );
  const fullText = deltas
    .map((d) => (JSON.parse(d.data) as { text: string }).text)
    .join("");
  const drafts = await db
    .select()
    .from(s.sceneDrafts)
    .where(eq(s.sceneDrafts.sceneNodeId, nodes[1].id));
  check("落库 1 条 draft", drafts.length === 1, drafts.length);
  check(
    "draft 内容与流式文本一致",
    drafts[0]?.content === fullText && fullText.length > 0
  );
  check(
    "parentDraftId=null、instruction/model 已写",
    drafts[0]?.parentDraftId === null &&
      drafts[0]?.instruction === "突出石猴的天真" &&
      drafts[0]?.model === "claude-opus-4-8",
    drafts[0]
  );
  const calls = await db.select().from(s.aiCalls);
  check(
    "ai_calls 落库（含 cache_read_input_tokens=900）",
    calls.length === 1 &&
      calls[0]?.purpose === "generate-scene" &&
      calls[0]?.cacheReadTokens === 900,
    calls
  );
  var draftA = drafts[0].id;
}

// ---------- 2. continue：parentDraftId = 此前当前稿 ----------
console.log("[2] continue 模式");
{
  const { events } = await runGenerate(nodes[1].id, {
    mode: "continue",
    instruction: "继续写他跃入瀑布",
  });
  const done = events.find((e) => e.event === "done");
  check("收到 done 事件", !!done);
  const drafts = await db
    .select()
    .from(s.sceneDrafts)
    .where(eq(s.sceneDrafts.sceneNodeId, nodes[1].id));
  check("共 2 条 draft", drafts.length === 2, drafts.length);
  const latest = drafts.sort((a, b) => b.id - a.id)[0];
  check(
    "新稿 parentDraftId = 此前当前稿 id",
    latest.parentDraftId === draftA,
    latest.parentDraftId
  );
  var draftB = latest.id;
}

// ---------- 3. rewrite + baseDraftId ----------
console.log("[3] rewrite 模式（显式 baseDraftId=draftA）");
{
  const { events } = await runGenerate(nodes[1].id, {
    mode: "rewrite",
    instruction: "改写得更凝练",
    baseDraftId: draftA,
  });
  const done = events.find((e) => e.event === "done");
  check("收到 done 事件", !!done);
  const drafts = await db
    .select()
    .from(s.sceneDrafts)
    .where(eq(s.sceneDrafts.sceneNodeId, nodes[1].id));
  check("版本链共 3 条记录", drafts.length === 3, drafts.length);
  const latest = drafts.sort((a, b) => b.id - a.id)[0];
  check(
    "新稿 parentDraftId = baseDraftId（draftA）",
    latest.parentDraftId === draftA,
    latest.parentDraftId
  );
  check("draftB 未被覆盖", drafts.some((d) => d.id === draftB));
}

// ---------- 4. 中断：不落库 ----------
console.log("[4] 首个 delta 后中断");
{
  const before = (
    await db
      .select()
      .from(s.sceneDrafts)
      .where(eq(s.sceneDrafts.sceneNodeId, nodes[0].id))
  ).length;
  const { events } = await runGenerate(
    nodes[0].id,
    { mode: "instruct", instruction: "写石猴睁眼" },
    { abortAfterFirstDelta: true }
  );
  const after = (
    await db
      .select()
      .from(s.sceneDrafts)
      .where(eq(s.sceneDrafts.sceneNodeId, nodes[0].id))
  ).length;
  check(
    "有 delta 但无 done 事件",
    events.some((e) => e.event === "delta") &&
      !events.some((e) => e.event === "done"),
    events.map((e) => e.event)
  );
  check("中断后不产生半成品 draft", before === 0 && after === 0, {
    before,
    after,
  });
}

// ---------- 5. 参数校验 ----------
console.log("[5] 参数校验");
{
  const { res: r1, events: e1 } = await runGenerate(nodes[1].id, {
    mode: "bad-mode",
    instruction: "x",
  });
  check("非法 mode → 400", r1.status === 400 && e1.length === 0, r1.status);

  const { res: r2 } = await runGenerate(99999, {
    mode: "instruct",
    instruction: "x",
  });
  check("场景不存在 → 404", r2.status === 404, r2.status);

  // 跨节点 baseDraftId：draftA 属于场景二，对场景一使用 → 400
  const { res: r3 } = await runGenerate(nodes[0].id, {
    mode: "rewrite",
    instruction: "x",
    baseDraftId: draftA,
  });
  check("跨节点 baseDraftId → 400", r3.status === 400, r3.status);
}

fs.rmSync("./tmp-verify.db", { force: true });
console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
