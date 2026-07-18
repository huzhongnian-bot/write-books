"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

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
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import { createSceneNode, deleteSceneNode, moveSceneNode } from "./actions";
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

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  const selectHref = (nodeId: number | null) =>
    nodeId === null
      ? `/projects/${projectId}/script`
      : `/projects/${projectId}/script?node=${nodeId}`;

  const runAction = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setActionError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setActionError(res.error ?? "操作失败");
    });
  };

  const handleCreate = () => {
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
        const rest = nodes.filter((n) => n.id !== node.id);
        router.push(selectHref(rest[0]?.id ?? null), { scroll: false });
      }
    });
  };

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b px-6 py-3">
        <h1 className="text-lg font-semibold">脚本大纲</h1>
        <p className="text-xs text-muted-foreground">剧情线：{storylineTitle}</p>
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
