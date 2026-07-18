import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, sourceWorks } from "@/lib/db/schema";
import { Badge } from "@/components/ui/badge";
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

export const dynamic = "force-dynamic";

const STATUS_MAP: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  idle: { label: "未开始", variant: "outline" },
  running: { label: "摄取中", variant: "default" },
  done: { label: "已完成", variant: "secondary" },
  failed: { label: "摄取失败", variant: "destructive" },
};

export default async function ProjectsPage() {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      createdAt: projects.createdAt,
      workId: sourceWorks.id,
      ingestStatus: sourceWorks.ingestStatus,
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
        上传 TXT 原作，自动摄取生成原作百科。
      </p>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="text-base">上传原作</CardTitle>
          <CardDescription>
            支持 UTF-8 / GBK 编码的 TXT 文件，上限 60 章、50 万字。
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
                  <TableHead>状态</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projectRows.map((row) => {
                  const status = STATUS_MAP[row.ingestStatus ?? "idle"];
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </TableCell>
                      <TableCell>
                        {row.createdAt.toLocaleString("zh-CN", {
                          hour12: false,
                        })}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.workId !== null && (
                          <Link
                            href={`/projects/${row.id}`}
                            className={buttonVariants({
                              variant: "outline",
                              size: "sm",
                            })}
                          >
                            查看进度
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
