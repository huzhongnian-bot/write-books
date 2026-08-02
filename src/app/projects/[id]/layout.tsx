import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { ThemeSkin } from "./theme-skin";
import { ThemePicker } from "./theme-picker";

/**
 * 项目工作区（详情/百科/脚本/写作）共享布局：
 * 按 projects.theme 给整区换肤（含弹层——data-theme 挂在 <html> 上），
 * 顶部一条窄栏放主题切换器，各页面不再各自挂入口。
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const projectId = Number(id);
  const project = Number.isInteger(projectId)
    ? await db
        .select({ theme: projects.theme })
        .from(projects)
        .where(eq(projects.id, projectId))
        .then((rows) => rows[0])
    : undefined;
  const theme = project?.theme ?? "default";

  return (
    <>
      <ThemeSkin theme={theme} />
      {Number.isInteger(projectId) && (
        <div className="flex items-center justify-end gap-2 border-b px-4 py-1.5 text-xs text-muted-foreground">
          <span>文学主题</span>
          <ThemePicker projectId={projectId} currentTheme={theme} />
        </div>
      )}
      {children}
    </>
  );
}
