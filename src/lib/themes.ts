import type { z } from "zod";
import type { projectThemeEnum } from "@/lib/db/schema";

export type ProjectTheme = z.infer<typeof projectThemeEnum>;

/** 主题下拉选项（value 与 schema.ts 的 projectThemeEnum 一一对应） */
export const PROJECT_THEME_OPTIONS: { value: ProjectTheme; label: string }[] = [
  { value: "default", label: "默认" },
  { value: "campus", label: "校园文学" },
  { value: "western", label: "西方幻想" },
  { value: "eastern", label: "东方武侠" },
  { value: "urban", label: "都市文学" },
  { value: "scifi", label: "星际科幻" },
];
