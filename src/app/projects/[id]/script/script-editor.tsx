"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2 } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import { createSceneNode, deleteSceneNode, generateSceneDrafts, moveSceneNode } from "./actions";
import { NodeForm } from "./node-form";

/** 场景节点在客户端使用的可序列化形态（characterIds/foreshadowRefs 已解析为 name 数组） */
export interface SceneNodeDTO {
  id: number;
  seq: number;
  title: string;
  pov: string | null;
  characterIds: string[];
  time: string | null;
  place: string | null;
  beats: string;
  foreshadowRefs: string[];
}

export interface BibleEntryOption {
  name: string;
  kind: string;
}

interface ScriptEditorProps {
  projectId: number;
  storylineTitle: string;
  nodes: SceneNodeDTO[];
  bibleEntries: BibleEntryOption[];
  selectedNodeId: number | null;
}

export function ScriptEditor({
  projectId,
  storylineTitle,
  nodes,
  bibleEntries,
  selectedNodeId,
}: ScriptEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  // NodeForm 上报的未保存编辑状态：切换节点前需确认，避免静默丢失
  const [formDirty, setFormDirty] = useState(false);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  const selectHref = (nodeId: number | null) =>
    nodeId === null
      ? `/projects/${projectId}/script`
      : `/projects/${projectId}/script?node=${nodeId}`;

  const guardNodeSwitch = (e: React.MouseEvent) => {
    if (
      formDirty &&
      !window.confirm("当前场景有未保存的修改，切换节点后将丢失。确定要切换吗？")
    ) {
      e.preventDefault();
    }
  };

  const runAction = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setActionError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setActionError(res.error ?? "操作失败");
    });
  };

  const handleCreate = () => {
    // 新建即切换到新节点，同样守卫未保存编辑
    if (
      formDirty &&
      !window.confirm("当前场景有未保存的修改，切换节点后将丢失。确定要切换吗？")
    ) {
      return;
    }
    setActionError(null);
    startTransition(async () => {
      const res = await createSceneNode({ projectId });
      if (res.ok && res.nodeId !== undefined) {
        router.push(selectHref(res.nodeId), { scroll: false });
      } else if (!res.ok) {
        setActionError(res.error);
      }
    });
  };

  const handleMove = (nodeId: number, direction: "up" | "down") =>
    runAction(() => moveSceneNode({ projectId, nodeId, direction }));

  const handleAiDraft = () => {
    setActionError(null);
    startTransition(async () => {
      const res = await generateSceneDrafts({ projectId });
      if (!res.ok) setActionError(res.error);
    });
  };

  const handleDelete = (node: SceneNodeDTO) => {
    setActionError(null);
    startTransition(async () => {
      const res = await deleteSceneNode({ projectId, nodeId: node.id });
      if (!res.ok) {
        setActionError(res.error);
        return;
      }
      // 删除的是当前选中节点时，选中顺延到剩余的第一个
      if (selectedNodeId === node.id) {
        setFormDirty(false);
        const rest = nodes.filter((n) => n.id !== node.id);
        router.push(selectHref(rest[0]?.id ?? null), { scroll: false });
      }
    });
  };

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold">脚本大纲</h1>
          <p className="text-xs text-muted-foreground">剧情线：{storylineTitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog>
            <DialogTrigger
              render={
                <Button variant="outline" size="sm" disabled={isPending} />
              }
            >
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              AI 场景草案
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>生成场景草案</DialogTitle>
                <DialogDescription>
                  将根据原作章节概述调用 AI 生成一批场景节点，追加到当前剧情线末尾（不覆盖已有节点）。需要先在项目页生成章节概述。
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>
                  取消
                </DialogClose>
                <DialogClose
                  render={<Button onClick={handleAiDraft} disabled={isPending} />}
                >
                  {isPending ? "生成中…" : "开始生成"}
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Link
            href={`/projects/${projectId}/bible`}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            ← 返回百科
          </Link>
          <Link
            href={`/projects/${projectId}`}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            返回项目
          </Link>
          <a
            href={`/api/projects/${projectId}/export`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            导出 TXT
          </a>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col border-r">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="text-sm font-medium">场景节点（{nodes.length}）</span>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCreate}
              disabled={isPending}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              新建场景
            </Button>
          </div>
          {actionError && (
            <p className="border-b px-4 py-2 text-xs text-destructive">{actionError}</p>
          )}
          <ScrollArea className="min-h-0 flex-1">
            {nodes.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                暂无场景，点击「新建场景」开始编排。
              </p>
            ) : (
              <ul>
                {nodes.map((node, index) => {
                  const selected = node.id === selectedNodeId;
                  const summary =
                    [node.pov, node.place].filter(Boolean).join(" · ") ||
                    "未设置 POV / 地点";
                  return (
                    <li
                      key={node.id}
                      className={cn("border-b px-3 py-2", selected && "bg-muted")}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-5 shrink-0 text-center text-xs text-muted-foreground">
                          {index + 1}
                        </span>
                        <Link
                          href={selectHref(node.id)}
                          scroll={false}
                          onClick={guardNodeSwitch}
                          className={cn(
                            "min-w-0 flex-1 truncate text-sm font-medium hover:text-primary",
                            selected && "text-primary"
                          )}
                        >
                          {node.title}
                        </Link>
                        <div className="flex shrink-0 items-center">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="上移"
                            disabled={isPending || index === 0}
                            onClick={() => handleMove(node.id, "up")}
                          >
                            <ArrowUp />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="下移"
                            disabled={isPending || index === nodes.length - 1}
                            onClick={() => handleMove(node.id, "down")}
                          >
                            <ArrowDown />
                          </Button>
                          <Dialog>
                            <DialogTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  aria-label="删除"
                                  disabled={isPending}
                                />
                              }
                            >
                              <Trash2 />
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>删除场景</DialogTitle>
                                <DialogDescription>
                                  确定要删除「{node.title}」吗？此操作不可撤销。
                                </DialogDescription>
                              </DialogHeader>
                              <DialogFooter>
                                <DialogClose render={<Button variant="outline" />}>
                                  取消
                                </DialogClose>
                                <DialogClose
                                  render={
                                    <Button
                                      variant="destructive"
                                      onClick={() => handleDelete(node)}
                                    />
                                  }
                                >
                                  确认删除
                                </DialogClose>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </div>
                      </div>
                      <div className="mt-1 flex items-center gap-2 pl-7">
                        <Link
                          href={selectHref(node.id)}
                          scroll={false}
                          onClick={guardNodeSwitch}
                          className="min-w-0 flex-1 truncate text-xs text-muted-foreground hover:text-foreground"
                        >
                          {summary}
                        </Link>
                        <Link
                          href={`/projects/${projectId}/write/${node.id}`}
                          className="shrink-0 text-xs text-primary hover:underline"
                        >
                          去生成 →
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </ScrollArea>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          {selectedNode ? (
            <NodeForm
              key={selectedNode.id}
              projectId={projectId}
              node={selectedNode}
              bibleEntries={bibleEntries}
              onDirtyChange={setFormDirty}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
              {nodes.length === 0
                ? "点击左上角「新建场景」创建第一个场景节点"
                : "请选择左侧的场景节点"}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
