"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

const POLL_INTERVAL_MS = 2000;

interface JobStatus {
  id: number;
  kind: string;
  status: string;
  chapterId: number | null;
  error: string | null;
  attemptCount: number;
  hasResult: boolean;
}

interface IngestStatus {
  workStatus: string;
  workError: string | null;
  jobs: JobStatus[];
}

interface ChapterInfo {
  id: number;
  seq: number;
  title: string | null;
}

const STATUS_MAP: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  idle: { label: "未开始", variant: "outline" },
  running: { label: "摄取中", variant: "default" },
  done: { label: "已完成", variant: "secondary" },
  failed: { label: "摄取失败", variant: "destructive" },
};

function formatTokenEstimate(totalChars: number): string {
  const tokens = Math.round(totalChars * 1.3);
  if (tokens >= 10000) {
    return `约 ${(tokens / 10000).toFixed(1)} 万 tokens`;
  }
  return `约 ${tokens.toLocaleString("zh-CN")} tokens`;
}

export function IngestProgress({
  workId,
  workTitle,
  chapters,
  totalChars,
}: {
  workId: number;
  workTitle: string;
  chapters: ChapterInfo[];
  totalChars: number;
}) {
  const [status, setStatus] = useState<IngestStatus | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/works/${workId}/status`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setStatus((await res.json()) as IngestStatus);
      setFetchError(null);
    } catch {
      setFetchError("状态获取失败，稍后自动重试");
    }
  }, [workId]);

  useEffect(() => {
    // 首次拉取推迟到宏任务，避免在 effect 体内同步触发 setState
    const initial = setTimeout(refresh, 0);
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);

  async function postAndRefresh(url: string) {
    setActing(true);
    try {
      await fetch(url, { method: "POST" });
      await refresh();
    } finally {
      setActing(false);
    }
  }

  const extractJobs =
    status?.jobs.filter((job) => job.kind === "extract") ?? [];
  const summaryJob = status?.jobs.find((job) => job.kind === "summary");

  const doneCount = extractJobs.filter((j) => j.status === "done").length;
  const failedJobs = extractJobs.filter((j) => j.status === "failed");
  const pendingCount = extractJobs.filter((j) => j.status === "pending").length;
  const runningCount =
    status?.jobs.filter((j) => j.status === "running").length ?? 0;

  const totalChapters = chapters.length;
  const progressValue =
    totalChapters > 0 ? Math.round((doneCount / totalChapters) * 100) : 0;

  // 「有 pending/failed 且无 running」：可能进程重启过，提示可重新触发 drain
  const stalled =
    status !== null &&
    status.workStatus !== "done" &&
    runningCount === 0 &&
    status.jobs.some((j) => j.status === "pending" || j.status === "failed");

  const chapterLabel = (job: JobStatus) => {
    const chapter = chapters.find((c) => c.id === job.chapterId);
    if (!chapter) return `章节 #${job.chapterId ?? "?"}`;
    return `第 ${chapter.seq} 章${chapter.title ? ` ${chapter.title}` : ""}`;
  };

  const workStatus = STATUS_MAP[status?.workStatus ?? "idle"];

  return (
    <div className="mt-6 space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">《{workTitle}》摄取进度</CardTitle>
            <Badge variant={workStatus.variant}>{workStatus.label}</Badge>
          </div>
          <CardDescription>
            共 {totalChapters} 章，约 {totalChars.toLocaleString("zh-CN")} 字
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Progress value={progressValue} />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-2xl font-bold">{totalChapters}</p>
              <p className="text-xs text-muted-foreground">总章数</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{doneCount}</p>
              <p className="text-xs text-muted-foreground">已完成</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{pendingCount}</p>
              <p className="text-xs text-muted-foreground">待处理</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{failedJobs.length}</p>
              <p className="text-xs text-muted-foreground">失败</p>
            </div>
          </div>
          {summaryJob && (
            <p className="text-xs text-muted-foreground">
              全书汇总：
              {summaryJob.status === "done"
                ? "已完成"
                : summaryJob.status === "running"
                  ? "进行中"
                  : "待开始"}
            </p>
          )}
        </CardContent>
      </Card>

      {fetchError && (
        <Alert variant="destructive">
          <AlertDescription>{fetchError}</AlertDescription>
        </Alert>
      )}

      {status?.workStatus === "done" && (
        <Alert>
          <AlertTitle>摄取完成</AlertTitle>
          <AlertDescription>
            原作百科初稿已生成。本次摄取输入规模约{" "}
            {formatTokenEstimate(totalChars)}（按 字数 × 1.3 估算，仅供参考）。
          </AlertDescription>
        </Alert>
      )}

      {stalled && (
        <Alert>
          <AlertTitle>摄取似乎已中断</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>
              还有章节待处理或失败，且当前没有正在运行的任务（可能是进程重启过）。
            </span>
            <Button
              size="sm"
              disabled={acting}
              onClick={() =>
                postAndRefresh(`/api/works/${workId}/drain`)
              }
            >
              继续摄取
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {failedJobs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">失败章节</CardTitle>
            <CardDescription>可逐章重试，不影响其他章节。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {failedJobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between gap-4 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {chapterLabel(job)}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {job.error ?? "未知错误"}（已尝试 {job.attemptCount} 次）
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={acting}
                  onClick={() =>
                    postAndRefresh(
                      `/api/works/${workId}/chapters/${job.chapterId}/retry`
                    )
                  }
                >
                  重试
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {status === null && !fetchError && (
        <p className="text-sm text-muted-foreground">正在加载状态…</p>
      )}
    </div>
  );
}
