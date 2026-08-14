"use client";

import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// SillyTavern 导出（docs/specs/sillytavern.md §2）：项目页顶栏入口。
// 世界书为整本百科直接下载；角色卡选 character 条目后下载。
// 均为 GET 文件下载端点，零 AI、即点即得。

export function StExport({
  projectId,
  characters,
}: {
  projectId: number;
  characters: { id: number; name: string }[];
}) {
  const [entryId, setEntryId] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <a
        href={`/api/projects/${projectId}/sillytavern/lorebook`}
        download
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        ST 世界书
      </a>
      {characters.length > 0 && (
        <>
          <Select value={entryId ?? ""} onValueChange={setEntryId}>
            <SelectTrigger size="sm" className="h-8 w-32">
              <SelectValue placeholder="选择角色" />
            </SelectTrigger>
            <SelectContent>
              {characters.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={!entryId}
            onClick={() =>
              (window.location.href = `/api/projects/${projectId}/sillytavern/characters/${entryId}`)
            }
          >
            导出角色卡
          </Button>
        </>
      )}
    </div>
  );
}
