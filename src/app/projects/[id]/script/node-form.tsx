"use client";

import { useMemo, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

import { updateSceneNode } from "./actions";
import type { BibleEntryOption, SceneNodeDTO } from "./script-editor";

const KIND_LABELS: Record<string, string> = {
  setting: "设定",
  character: "角色",
  relationship: "关系",
  plot_arc: "剧情弧",
  timeline_event: "时间线",
};

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

interface NodeFormProps {
  projectId: number;
  node: SceneNodeDTO;
  bibleEntries: BibleEntryOption[];
}

export function NodeForm({ projectId, node, bibleEntries }: NodeFormProps) {
  const [title, setTitle] = useState(node.title);
  const [pov, setPov] = useState(node.pov ?? "");
  const [time, setTime] = useState(node.time ?? "");
  const [place, setPlace] = useState(node.place ?? "");
  const [beats, setBeats] = useState(node.beats);
  const [characterIds, setCharacterIds] = useState<string[]>(node.characterIds);
  const [foreshadowRefs, setForeshadowRefs] = useState<string[]>(
    node.foreshadowRefs
  );
  // 百科无 character 条目时的兜底手输（逗号分隔）
  const [manualCharacters, setManualCharacters] = useState(
    node.characterIds.join("，")
  );
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });

  const characterOptions = useMemo(
    () => bibleEntries.filter((e) => e.kind === "character").map((e) => e.name),
    [bibleEntries]
  );
  // 与节点已存引用取并集：百科中被改名/删除的历史 name 仍可看到并取消勾选，避免保存时被静默丢弃
  const characterChoices = useMemo(
    () => [...new Set([...characterOptions, ...node.characterIds])],
    [characterOptions, node.characterIds]
  );
  const foreshadowChoices = useMemo(
    () => [...new Set([...bibleEntries.map((e) => e.name), ...node.foreshadowRefs])],
    [bibleEntries, node.foreshadowRefs]
  );
  const kindByName = useMemo(
    () => new Map(bibleEntries.map((e) => [e.name, e.kind])),
    [bibleEntries]
  );

  const toggleName = (list: string[], name: string, checked: boolean) =>
    checked ? [...list, name] : list.filter((v) => v !== name);

  const handleSave = () => {
    startTransition(async () => {
      const characters =
        characterOptions.length > 0
          ? characterIds
          : manualCharacters
              .split(/[,，]/)
              .map((s) => s.trim())
              .filter(Boolean);
      const res = await updateSceneNode({
        projectId,
        nodeId: node.id,
        title,
        pov,
        characterIds: [...new Set(characters)],
        time,
        place,
        beats,
        foreshadowRefs,
      });
      setStatus(
        res.ok ? { kind: "saved" } : { kind: "error", message: res.error }
      );
    });
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold">场景属性</h2>
        <div className="flex items-center gap-3">
          {status.kind === "saved" && !isPending && (
            <span className="text-xs text-muted-foreground">已保存</span>
          )}
          {status.kind === "error" && (
            <span className="text-xs text-destructive">{status.message}</span>
          )}
          <Button size="sm" onClick={handleSave} disabled={isPending}>
            {isPending ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
      <Separator className="my-4" />

      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="scene-title">标题</Label>
          <Input
            id="scene-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="场景标题"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="scene-pov">POV 视角</Label>
            <Input
              id="scene-pov"
              value={pov}
              onChange={(e) => setPov(e.target.value)}
              placeholder="如：孙悟空"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="scene-time">时间</Label>
            <Input
              id="scene-time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              placeholder="如：石猴出世后某日"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="scene-place">地点</Label>
          <Input
            id="scene-place"
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            placeholder="如：花果山巅"
          />
        </div>

        <div className="space-y-2">
          <Label>出场角色</Label>
          {characterOptions.length > 0 ? (
            <div className="space-y-2 rounded-md border p-3">
              {characterChoices.map((name) => (
                <div key={name} className="flex items-center gap-2">
                  <Checkbox
                    id={`char-${name}`}
                    checked={characterIds.includes(name)}
                    onCheckedChange={(v) =>
                      setCharacterIds((prev) => toggleName(prev, name, v === true))
                    }
                  />
                  <Label htmlFor={`char-${name}`} className="font-normal">
                    {name}
                  </Label>
                </div>
              ))}
            </div>
          ) : (
            <>
              <Input
                value={manualCharacters}
                onChange={(e) => setManualCharacters(e.target.value)}
                placeholder="多个角色用逗号分隔，如：孙悟空，唐僧"
              />
              <p className="text-xs text-muted-foreground">
                该作品的百科暂无角色条目，可手动输入（逗号分隔）。
              </p>
            </>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="scene-beats">情节要点</Label>
          <Textarea
            id="scene-beats"
            className="min-h-28"
            value={beats}
            onChange={(e) => setBeats(e.target.value)}
            placeholder="本场景发生的关键情节…"
          />
        </div>

        <div className="space-y-2">
          <Label>伏笔 / 设定呼应</Label>
          {foreshadowChoices.length > 0 ? (
            <div className="space-y-2 rounded-md border p-3">
              {foreshadowChoices.map((name) => {
                const kind = kindByName.get(name);
                return (
                  <div key={name} className="flex items-center gap-2">
                    <Checkbox
                      id={`fs-${name}`}
                      checked={foreshadowRefs.includes(name)}
                      onCheckedChange={(v) =>
                        setForeshadowRefs((prev) =>
                          toggleName(prev, name, v === true)
                        )
                      }
                    />
                    <Label htmlFor={`fs-${name}`} className="font-normal">
                      {name}
                    </Label>
                    {kind && (
                      <Badge variant="outline" className="text-[10px]">
                        {KIND_LABELS[kind] ?? kind}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              百科暂无条目，完成摄取后可在此勾选本场景呼应的伏笔/设定。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
