"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROJECT_THEME_OPTIONS } from "@/lib/themes";
import { setProjectTheme } from "../actions";

/**
 * 换肤下拉：选择后立即改写 <html data-theme>（不等服务端），
 * 再调 Server Action 持久化；失败回滚本地选择并 toast。
 */
export function ThemePicker({
  projectId,
  currentTheme,
}: {
  projectId: number;
  currentTheme: string;
}) {
  const [theme, setTheme] = useState(currentTheme);
  const [, startTransition] = useTransition();

  function apply(next: string | null) {
    if (!next) return;
    const prev = theme;
    setTheme(next);
    if (next === "default") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = next;
    }
    startTransition(async () => {
      const result = await setProjectTheme({ projectId, theme: next });
      if (!result.ok) {
        setTheme(prev);
        if (prev === "default") {
          delete document.documentElement.dataset.theme;
        } else {
          document.documentElement.dataset.theme = prev;
        }
        toast.error(result.error);
      }
    });
  }

  return (
    <Select value={theme} onValueChange={apply}>
      <SelectTrigger size="sm" className="h-7 w-32 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PROJECT_THEME_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
