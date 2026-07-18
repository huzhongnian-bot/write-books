"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

import { getChapterExcerpt } from "./actions";
import type { AnchorDTO, ChapterExcerpt } from "./shared";

type ExcerptState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; excerpt: ChapterExcerpt | null };

/** 出处锚点：点击弹出对应章节原文并高亮 quote（spec bible.md §2.2） */
export function AnchorDialog({
  workId,
  anchor,
}: {
  workId: number;
  anchor: AnchorDTO;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ExcerptState>({ status: "idle" });
  const requestIdRef = useRef(0);

  // 打开弹层时按需取章节原文（P0 不做独立章节页）
  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) return;
    const requestId = ++requestIdRef.current;
    setState({ status: "loading" });
    getChapterExcerpt(workId, anchor.chapterSeq)
      .then((excerpt) => {
        if (requestIdRef.current === requestId) {
          setState({ status: "loaded", excerpt });
        }
      })
      .catch(() => {
        if (requestIdRef.current === requestId) {
          setState({ status: "error" });
        }
      });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            className="h-auto max-w-full justify-start px-2 py-1 font-normal"
          />
        }
      >
        <span className="shrink-0 text-muted-foreground">
          第{anchor.chapterSeq}回
        </span>
        <span className="truncate">{anchor.quote}</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            出处 · 第{anchor.chapterSeq}回
            {state.status === "loaded" && state.excerpt?.title
              ? ` · ${state.excerpt.title}`
              : ""}
          </DialogTitle>
          <DialogDescription>引用：{anchor.quote}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[55vh] rounded-md border bg-muted/30 p-4">
          {state.status === "idle" || state.status === "loading" ? (
            <p className="text-sm text-muted-foreground">加载章节原文中…</p>
          ) : state.status === "error" ? (
            <p className="text-sm text-destructive">
              加载章节原文失败，请稍后重试。
            </p>
          ) : state.excerpt === null ? (
            <p className="text-sm text-muted-foreground">
              未找到第{anchor.chapterSeq}回的章节原文。
            </p>
          ) : (
            <HighlightedContent
              content={state.excerpt.content}
              quote={anchor.quote}
            />
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

/** 高亮 quote；原文中找不到时退化为只显示原文（spec bible.md §2.2） */
function HighlightedContent({
  content,
  quote,
}: {
  content: string;
  quote: string;
}) {
  const index = quote ? content.indexOf(quote) : -1;
  if (index < 0) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          未能在原文中定位该引用，以下为章节原文。
        </p>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{content}</p>
      </div>
    );
  }
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {content.slice(0, index)}
      <mark className="rounded-sm bg-yellow-200 px-0.5 dark:bg-yellow-500/40">
        {content.slice(index, index + quote.length)}
      </mark>
      {content.slice(index + quote.length)}
    </p>
  );
}
