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
import { bibleKindLabels, type BibleKind } from "./shared";

/** 新建「二创设定」：origin=user，与修正抽取结果的「校订」明确区分（spec bible.md §2.1） */
export function CreateEntryDialog({
  projectId,
  workId,
  kind,
}: {
  projectId: number;
  workId: number;
  kind: BibleKind;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>新建二创设定</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建二创设定 · {bibleKindLabels[kind]}</DialogTitle>
          <DialogDescription>
            二创设定是偏离原作的自建设定（origin=user），与修正抽取结果的「校订」不同。
          </DialogDescription>
        </DialogHeader>
        <EntryForm
          mode="create"
          projectId={projectId}
          workId={workId}
          kind={kind}
          onSuccess={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
