"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// 章节概述面板（docs/specs/ingest.md §2.4）：POST /api/works/[id]/summarize
// 的 SSE 进度消费端，模式同 write-workbench。两种触发：
//   - 补全缺失：不带 body，服务端只补缺章，重复点击/断线重跑安全；
//   - 生成所选：body { seqs }，所选章节强制重生成（含已有概述的）。

export interface PanelChapter {
  seq: number;
  title: string | null;
  charCount: number;
  hasSummary: boolean;
}

interface SummarizePanelProps {
  workId: number;
  chapters: PanelChapter[];
  /** 初始已生成概述的章数（RSC 传入） */
  summarized: number;
}

export function SummarizePanel({
  workId,
  chapters,
  summarized: initialSummarized,
}: SummarizePanelProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [runTotal, setRunTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const total = chapters.length;
  const allDone = initialSummarized >= total;
  const allSelected = total > 0 && selected.size === total;

  async function handleRun(seqs?: number[]) {
    if (running) return;
    setError(null);
    setDone(0);
    setRunTotal(0);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;

    let finished = false;

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
      if (event === "progress") {
        const payload = JSON.parse(data) as {
          summarized: number;
          total: number;
        };
        setDone(payload.summarized);
        setRunTotal(payload.total);
      } else if (event === "done") {
        finished = true;
      } else if (event === "error") {
        const payload = JSON.parse(data) as { message: string };
        throw new Error(payload.message);
      }
    };

    try {
      const res = await fetch(`/api/works/${workId}/summarize`, {
        method: "POST",
        signal: controller.signal,
        ...(seqs
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ seqs }),
            }
          : {}),
      });
      if (!res.ok || !res.body) {
        let message = `概述请求失败（${res.status}）`;
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
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
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

      if (finished) {
        // 概述已落库，刷新 RSC 让表格 ✓ 与计数更新
        setSelected(new Set());
        router.refresh();
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(
          err instanceof Error ? err.message : "概述生成失败，请重试（已完成的章节不会重复生成）"
        );
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
      // 中断/停止时已有部分章节落库，同样刷新计数与表格
      if (!finished && done > 0) router.refresh();
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  function toggleChapter(seq: number, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(seq);
      } else {
        next.delete(seq);
      }
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(chapters.map((c) => c.seq)) : new Set());
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {running ? (
          <Button variant="outline" size="sm" onClick={handleStop}>
            停止（{done}/{runTotal || "…"}）
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleRun([...selected])}
              disabled={selected.size === 0}
            >
              生成所选概述{selected.size > 0 ? `（${selected.size}）` : ""}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleRun()}
              disabled={allDone}
            >
              {allDone
                ? "概述已完成"
                : initialSummarized > 0
                  ? "补全缺失概述"
                  : "生成章节概述"}
            </Button>
          </>
        )}
        <span className="text-xs text-muted-foreground">
          已生成 {initialSummarized}/{total} 章概述
        </span>
      </div>
      {running && runTotal > 0 && (
        <Progress value={(done / runTotal) * 100} className="h-1.5" />
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                aria-label="全选"
                checked={
                  allSelected
                    ? true
                    : selected.size > 0
                      ? "indeterminate"
                      : false
                }
                onCheckedChange={(v) => toggleAll(v === true)}
                disabled={running || total === 0}
              />
            </TableHead>
            <TableHead className="w-16">序号</TableHead>
            <TableHead>标题</TableHead>
            <TableHead className="w-16 text-right">概述</TableHead>
            <TableHead className="w-28 text-right">字数</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {chapters.map((chapter) => (
            <TableRow key={chapter.seq}>
              <TableCell>
                <Checkbox
                  aria-label={`选择第 ${chapter.seq} 章`}
                  checked={selected.has(chapter.seq)}
                  onCheckedChange={(v) => toggleChapter(chapter.seq, v === true)}
                  disabled={running}
                />
              </TableCell>
              <TableCell>{chapter.seq}</TableCell>
              <TableCell className="max-w-0 truncate">
                {chapter.title || "（无标题）"}
              </TableCell>
              <TableCell className="text-right">
                {chapter.hasSummary ? "✓" : ""}
              </TableCell>
              <TableCell className="text-right">
                {chapter.charCount.toLocaleString("zh-CN")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
