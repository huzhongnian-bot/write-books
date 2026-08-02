"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { deleteProject } from "./actions";

export function DeleteProjectButton({
  projectId,
  projectName,
}: {
  projectId: number;
  projectName: string;
}) {
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    startTransition(async () => {
      const res = await deleteProject({ projectId });
      if (!res.ok) {
        toast.error(`删除失败：${res.error}`);
      }
      // 成功由 action 内 revalidatePath("/projects") 刷新列表
    });
  };

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" disabled={isPending}>
            删除
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除项目</DialogTitle>
          <DialogDescription>
            确定要删除项目「{projectName}」吗？其原作、百科、脚本与全部草稿会一并删除，此操作不可撤销。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
          <DialogClose
            render={
              <Button
                variant="destructive"
                disabled={isPending}
                onClick={handleDelete}
              />
            }
          >
            {isPending ? "删除中…" : "确认删除"}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
