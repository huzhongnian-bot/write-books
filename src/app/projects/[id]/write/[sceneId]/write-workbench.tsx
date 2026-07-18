"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Square } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// Spec: docs/specs/generate.md §2.3 — 三栏工作台（场景要点 / 正文 / 指令输入）。

type Mode = "instruct" | "continue" | "rewrite";

export interface SceneInfo {
  id: number;
  seq: number;
  title: string;
  pov: string | null;
  time: string | null;
  place: string | null;
  beats: string;
  characterIds: string[];
  foreshadowRefs: string[];
}

export interface DraftItem {
  id: number;
  content: string;
  instruction: string;
  model: string;
  parentDraftId: number | null;
  createdAt: string; // ISO string，RSC → client 可序列化
}

interface UsageInfo {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** 确定性时间格式，避免 SSR/CSR locale 差异导致 hydration 不一致。 */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function summarize(text: string, max = 10): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function InfoField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

export function WriteWorkbench({
  projectId,
  scene,
  initialDrafts,
}: {
  projectId: number;
  scene: SceneInfo;
  initialDrafts: DraftItem[];
}) {
  const [drafts, setDrafts] = useState<DraftItem[]>(initialDrafts);
  const [selectedDraftId, setSelectedDraftId] = useState<number | null>(
    initialDrafts[0]?.id ?? null
  );
  const [mode, setMode] = useState<Mode>("instruct");
  const [instruction, setInstruction] = useState("");
  const [baseDraftId, setBaseDraftId] = useState<number | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamedText, setStreamedText] = useState("");
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUsage, setLastUsage] = useState<UsageInfo | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 关闭/离开页面即中断生成（spec §2.3）
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const selectedDraft = drafts.find((d) => d.id === selectedDraftId) ?? null;
  const rewriteBase = baseDraftId ?? selectedDraftId;

  const modeHint =
    mode === "instruct"
      ? "按你的指令从零创作本场景。"
      : mode === "continue"
        ? "紧接该场景的当前稿（最新版本）续写。"
        : rewriteBase
          ? `以版本 #${rewriteBase} 为底稿做局部改写。`
          : "本场景尚无草稿，将按情节要点创作初稿。";

  function handleSelectDraft(value: string) {
    setSelectedDraftId(Number(value));
    // 切换查看历史稿时丢弃未保存的流式残留
    setStreamedText("");
    setStopped(false);
    setError(null);
  }

  function handleRewriteFrom() {
    if (!selectedDraft) return;
    setMode("rewrite");
    setBaseDraftId(selectedDraft.id);
  }

  async function handleGenerate() {
    if (!instruction.trim() || streaming) return;

    setError(null);
    setStopped(false);
    setStreamedText("");
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const finalInstruction = instruction.trim();
    let accumulated = "";
    let doneDraftId: number | null = null;
    let doneUsage: UsageInfo | null = null;

    // 解析一个 SSE 事件块（event: xxx\ndata: {...}）
    const handleRawEvent = (raw: string) => {
      let event = "message";
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) {
          event = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trimStart());
        }
      }
      const data = dataLines.join("\n");
      if (event === "delta") {
        const payload = JSON.parse(data) as { text: string };
        accumulated += payload.text;
        setStreamedText(accumulated);
      } else if (event === "done") {
        const payload = JSON.parse(data) as {
          draftId: number;
          usage: UsageInfo;
        };
        doneDraftId = payload.draftId;
        doneUsage = payload.usage;
      } else if (event === "error") {
        const payload = JSON.parse(data) as { message: string };
        throw new Error(payload.message);
      }
    };

    try {
      const res = await fetch(`/api/scenes/${scene.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          instruction: finalInstruction,
          baseDraftId:
            mode === "rewrite" ? (rewriteBase ?? undefined) : undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        let message = `生成请求失败（${res.status}）`;
        try {
          const data = (await res.json()) as { error?: string };
          if (data.error) message = data.error;
        } catch {
          // 保留默认错误信息
        }
        throw new Error(message);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sepIndex: number;
        while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);
          if (raw.trim()) handleRawEvent(raw);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) handleRawEvent(buffer);

      if (doneDraftId !== null) {
        // 服务端已落库同内容的新稿，本地同步版本链（spec §2.3）
        const newDraft: DraftItem = {
          id: doneDraftId,
          content: accumulated,
          instruction: finalInstruction,
          model: "",
          parentDraftId:
            mode === "rewrite"
              ? (rewriteBase ?? selectedDraftId)
              : selectedDraftId,
          createdAt: new Date().toISOString(),
        };
        setDrafts((prev) => [newDraft, ...prev]);
        setSelectedDraftId(doneDraftId);
        setStreamedText("");
        if (doneUsage) setLastUsage(doneUsage);
      } else {
        throw new Error("生成中断，内容未保存");
      }
    } catch (err) {
      if (controller.signal.aborted) {
        // 用户停止 / 离开页面：半成品不落库，界面保留已生成部分
        setStopped(true);
      } else {
        setError(err instanceof Error ? err.message : "生成失败，请重试");
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_320px]">
        {/* ① 场景要点（只读） */}
        <aside className="overflow-y-auto border-r p-4">
          <Link
            href={`/projects/${projectId}/script`}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "w-full"
            )}
          >
            <ArrowLeft />
            返回脚本页
          </Link>

          <div className="mt-4">
            <h1 className="text-base font-semibold">{scene.title}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              第 {scene.seq} 场
            </p>
          </div>
          <Separator className="my-3" />

          <dl className="space-y-3">
            <InfoField label="POV">{scene.pov ?? "—"}</InfoField>
            <InfoField label="时间">{scene.time ?? "—"}</InfoField>
            <InfoField label="地点">{scene.place ?? "—"}</InfoField>
            <InfoField label="出场角色">
              {scene.characterIds.length > 0 ? (
                <span className="flex flex-wrap gap-1">
                  {scene.characterIds.map((name) => (
                    <Badge key={name} variant="secondary">
                      {name}
                    </Badge>
                  ))}
                </span>
              ) : (
                "—"
              )}
            </InfoField>
            <InfoField label="伏笔/设定引用">
              {scene.foreshadowRefs.length > 0 ? (
                <span className="flex flex-wrap gap-1">
                  {scene.foreshadowRefs.map((name) => (
                    <Badge key={name} variant="outline">
                      {name}
                    </Badge>
                  ))}
                </span>
              ) : (
                "—"
              )}
            </InfoField>
            <InfoField label="情节要点">
              <span className="whitespace-pre-wrap leading-6">
                {scene.beats}
              </span>
            </InfoField>
          </dl>
        </aside>

        {/* ② 正文（当前稿 + 流式渲染） */}
        <section className="flex min-h-0 flex-col">
          <div className="flex h-11 items-center justify-between border-b px-4">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              {streaming ? (
                <Badge>生成中…</Badge>
              ) : streamedText ? (
                <Badge variant="outline">
                  {stopped ? "已停止（未保存）" : "生成中断（未保存）"}
                </Badge>
              ) : selectedDraft ? (
                <>
                  <Badge variant="secondary">版本 #{selectedDraft.id}</Badge>
                  <span className="truncate text-xs text-muted-foreground">
                    {formatDateTime(selectedDraft.createdAt)}
                    {selectedDraft.model
                      ? ` · ${selectedDraft.model}`
                      : ""}
                    {selectedDraft.parentDraftId
                      ? ` · 基于 #${selectedDraft.parentDraftId}`
                      : ""}
                  </span>
                </>
              ) : (
                <Badge variant="outline">尚无草稿</Badge>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {scene.title}
            </span>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="px-6 py-4">
              {streaming || streamedText ? (
                <p className="whitespace-pre-wrap text-sm leading-7">
                  {streamedText}
                  {streaming && (
                    <span className="animate-pulse text-muted-foreground">
                      ▍
                    </span>
                  )}
                </p>
              ) : selectedDraft ? (
                <p className="whitespace-pre-wrap text-sm leading-7">
                  {selectedDraft.content}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  尚无草稿。在右侧输入写作指令，点击「开始生成」。
                </p>
              )}
            </div>
          </ScrollArea>
        </section>

        {/* ③ 指令输入（三模式 + 版本链） */}
        <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-l p-4">
          <div>
            <Label>生成模式</Label>
            <Tabs
              value={mode}
              onValueChange={(v) => setMode(v as Mode)}
              className="mt-1.5"
            >
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="instruct" disabled={streaming}>
                  指令生成
                </TabsTrigger>
                <TabsTrigger value="continue" disabled={streaming}>
                  续写
                </TabsTrigger>
                <TabsTrigger value="rewrite" disabled={streaming}>
                  改写
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <p className="mt-1.5 text-xs text-muted-foreground">{modeHint}</p>
          </div>

          <Separator />

          <div>
            <Label>版本链（新 → 旧）</Label>
            <Select
              value={selectedDraftId !== null ? String(selectedDraftId) : ""}
              onValueChange={(value) => {
                if (value) handleSelectDraft(value);
              }}
              disabled={streaming || drafts.length === 0}
            >
              <SelectTrigger className="mt-1.5 w-full">
                <SelectValue placeholder="暂无历史版本" />
              </SelectTrigger>
              <SelectContent>
                {drafts.map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>
                    #{d.id} · {formatDateTime(d.createdAt)} ·{" "}
                    {summarize(d.instruction)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              disabled={!selectedDraft || streaming}
              onClick={handleRewriteFrom}
            >
              基于此稿重写
            </Button>
          </div>

          <Separator />

          <div className="flex flex-1 flex-col">
            <Label htmlFor="instruction">写作指令</Label>
            <Textarea
              id="instruction"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={streaming}
              placeholder="例如：突出石猴的天真与灵气，800 字左右。"
              className="mt-1.5 min-h-28 flex-1"
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {streaming ? (
            <Button variant="destructive" onClick={handleStop}>
              <Square />
              停止
            </Button>
          ) : (
            <Button
              onClick={handleGenerate}
              disabled={!instruction.trim()}
            >
              开始生成
            </Button>
          )}

          {lastUsage && (
            <p className="text-xs text-muted-foreground">
              上次生成用量：输入 {lastUsage.input_tokens ?? 0} / 输出{" "}
              {lastUsage.output_tokens ?? 0} tokens
              {lastUsage.cache_read_input_tokens
                ? `（缓存命中 ${lastUsage.cache_read_input_tokens}）`
                : ""}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
