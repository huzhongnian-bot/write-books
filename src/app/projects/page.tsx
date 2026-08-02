import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, sourceWorks } from "@/lib/db/schema";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UploadForm } from "./upload-form";
import { DeleteProjectButton } from "./delete-project-button";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      createdAt: projects.createdAt,
      workId: sourceWorks.id,
    })
    .from(projects)
    .leftJoin(sourceWorks, eq(sourceWorks.projectId, projects.id))
    .orderBy(desc(projects.createdAt));

  // 一个项目可能有多部原作，P0 只展示第一部
  const projectRows = rows.filter(
    (row, index) => rows.findIndex((r) => r.id === row.id) === index
  );

  return (
    <main className="container mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight">项目</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        上传 TXT 原作，自动切分章节并建立全文检索，为二创生成提供原作上下文。
      </p>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="text-base">上传原作</CardTitle>
          <CardDescription>
            支持 UTF-8 / UTF-16 / GBK 编码的 TXT 文件，上限 2000 章、1000 万字。上传即完成，无需等待。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UploadForm />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">项目列表</CardTitle>
        </CardHeader>
        <CardContent>
          {projectRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              还没有项目，先上传一部原作吧。
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projectRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>
                      {row.createdAt.toLocaleString("zh-CN", {
                        hour12: false,
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {row.workId !== null && (
                          <>
                            <Link
                              href={`/projects/${row.id}`}
                              className={buttonVariants({
                                variant: "outline",
                                size: "sm",
                              })}
                            >
                              章节
                            </Link>
                            <Link
                              href={`/projects/${row.id}/bible`}
                              className={buttonVariants({
                                variant: "outline",
                                size: "sm",
                              })}
                            >
                              百科
                            </Link>
                            <Link
                              href={`/projects/${row.id}/script`}
                              className={buttonVariants({
                                variant: "outline",
                                size: "sm",
                              })}
                            >
                              脚本
                            </Link>
                          </>
                        )}
                        <DeleteProjectButton
                          projectId={row.id}
                          projectName={row.name}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
