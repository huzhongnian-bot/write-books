"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { EntryForm } from "./entry-form";
import { bibleKindLabels, type BibleEntryDTO } from "./shared";

/** 编辑已有条目：保存后原地更新（spec bible.md §2.1，不新建条目） */
export function EditEntryDialog({
  entry,
  projectId,
}: {
  entry: BibleEntryDTO;
  projectId: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="xs" />}>
        编辑
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            编辑条目 · {bibleKindLabels[entry.kind]}
          </DialogTitle>
          <DialogDescription>
            {entry.origin === "user"
              ? "该条目为「二创设定」，保存后仍保持二创语义。"
              : "保存后条目标记为「已校订」（修正抽取结果），不会新建条目。"}
          </DialogDescription>
        </DialogHeader>
        <EntryForm
          mode="edit"
          projectId={projectId}
          entry={entry}
          onSuccess={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
