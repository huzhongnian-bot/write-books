"use client";

import { useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { DialogClose, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { createBibleEntry, updateBibleEntry } from "./actions";
import {
  characterDataToFields,
  characterFieldsToData,
  dataTemplateForKind,
  type ActionResult,
  type BibleEntryDTO,
  type BibleKind,
  type CharacterFormFields,
} from "./shared";

export type EntryFormProps =
  | { mode: "edit"; projectId: number; entry: BibleEntryDTO; onSuccess: () => void }
  | {
      mode: "create";
      projectId: number;
      workId: number;
      kind: BibleKind;
      onSuccess: () => void;
    };

const EMPTY_CHARACTER_FIELDS: CharacterFormFields = {
  aliases: "",
  personality: "",
  abilities: "",
  speechPatternSamples: "",
  growthArc: "",
};

/**
 * 编辑 / 新建共用的条目表单：
 * - name + confidence 通用
 * - character 走结构化字段（数组字段逗号分隔）
 * - 其余 kind P0 允许 JSON 直改，提交前 JSON.parse 失败则提示
 */
export function EntryForm(props: EntryFormProps) {
  const kind: BibleKind = props.mode === "edit" ? props.entry.kind : props.kind;

  const [name, setName] = useState(props.mode === "edit" ? props.entry.name : "");
  const [confidence, setConfidence] = useState(
    props.mode === "edit" ? String(props.entry.confidence) : "1"
  );
  const [dataJson, setDataJson] = useState(() =>
    props.mode === "edit" && kind !== "character"
      ? JSON.stringify(props.entry.data, null, 2)
      : dataTemplateForKind(kind)
  );
  const [characterFields, setCharacterFields] = useState<CharacterFormFields>(() =>
    props.mode === "edit"
      ? characterDataToFields(props.entry.data)
      : EMPTY_CHARACTER_FIELDS
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function setCharacterField(key: keyof CharacterFormFields, value: string) {
    setCharacterFields((fields) => ({ ...fields, [key]: value }));
  }

  function buildData(): Record<string, unknown> | null {
    if (kind === "character") return characterFieldsToData(characterFields);
    try {
      const parsed: unknown = JSON.parse(dataJson);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        setError("设定数据必须是一个 JSON 对象");
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      setError("JSON 解析失败，请检查设定数据格式");
      return null;
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("名称不能为空");
      return;
    }
    const confidenceValue = Number(confidence);
    if (!Number.isFinite(confidenceValue) || confidenceValue < 0 || confidenceValue > 1) {
      setError("置信度需为 0–1 之间的数字");
      return;
    }
    const data = buildData();
    if (!data) return;

    startTransition(async () => {
      let result: ActionResult;
      if (props.mode === "edit") {
        result = await updateBibleEntry({
          entryId: props.entry.id,
          projectId: props.projectId,
          name: trimmedName,
          confidence: confidenceValue,
          data,
        });
      } else {
        result = await createBibleEntry({
          projectId: props.projectId,
          workId: props.workId,
          kind,
          name: trimmedName,
          confidence: confidenceValue,
          data,
        });
      }
      if (result.ok) {
        props.onSuccess();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="entry-name">名称</Label>
        <Input
          id="entry-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="条目名称"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="entry-confidence">置信度（0–1）</Label>
        <Input
          id="entry-confidence"
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={confidence}
          onChange={(e) => setConfidence(e.target.value)}
        />
      </div>

      {kind === "character" ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="character-aliases">别名（逗号分隔）</Label>
            <Input
              id="character-aliases"
              value={characterFields.aliases}
              onChange={(e) => setCharacterField("aliases", e.target.value)}
              placeholder="石猴，美猴王，齐天大圣"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="character-personality">性格</Label>
            <Textarea
              id="character-personality"
              className="min-h-20"
              value={characterFields.personality}
              onChange={(e) => setCharacterField("personality", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="character-abilities">能力（逗号分隔）</Label>
            <Input
              id="character-abilities"
              value={characterFields.abilities}
              onChange={(e) => setCharacterField("abilities", e.target.value)}
              placeholder="七十二变，筋斗云"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="character-speech">口癖 / 台词样本（逗号分隔）</Label>
            <Input
              id="character-speech"
              value={characterFields.speechPatternSamples}
              onChange={(e) => setCharacterField("speechPatternSamples", e.target.value)}
              placeholder="俺老孙来也！"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="character-growth">成长弧（可选）</Label>
            <Input
              id="character-growth"
              value={characterFields.growthArc}
              onChange={(e) => setCharacterField("growthArc", e.target.value)}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="entry-data-json">设定数据（JSON）</Label>
          <Textarea
            id="entry-data-json"
            className="min-h-40 font-mono text-xs"
            value={dataJson}
            onChange={(e) => setDataJson(e.target.value)}
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            直接编辑 JSON 对象，提交前会校验格式。
          </p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          取消
        </DialogClose>
        <Button type="submit" disabled={isPending}>
          {isPending ? "保存中…" : "保存"}
        </Button>
      </DialogFooter>
    </form>
  );
}
