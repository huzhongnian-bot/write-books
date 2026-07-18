import { db } from "@/lib/db";
import { chapters, projects, sourceWorks } from "@/lib/db/schema";
import { createExtractJobs, drainIngest } from "@/lib/ingest/pipeline";
import { decodeText, splitChapters } from "@/lib/ingest/split";

const MAX_CHAPTERS = 60;
const MAX_CHARS = 500_000;

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return badRequest("请求必须是 multipart 表单");
  }

  const name = formData.get("name");
  const file = formData.get("file");

  if (typeof name !== "string" || name.trim().length === 0) {
    return badRequest("缺少项目名称");
  }
  if (file === null || typeof file === "string") {
    return badRequest("缺少 TXT 文件");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) {
    return badRequest("文件内容为空");
  }

  const { text } = decodeText(buffer);
  if (text.trim().length === 0) {
    return badRequest("文件内容为空");
  }

  const chapterList = splitChapters(text);
  const totalChars = chapterList.reduce((sum, c) => sum + c.content.length, 0);

  if (chapterList.length > MAX_CHAPTERS) {
    return badRequest(
      `章节数 ${chapterList.length} 超过上限 ${MAX_CHAPTERS} 章，请将作品分卷后分别上传`
    );
  }
  if (totalChars > MAX_CHARS) {
    return badRequest(
      `总字数 ${totalChars} 超过上限 50 万字，请将作品分卷后分别上传`
    );
  }

  try {
    const [project] = await db
      .insert(projects)
      .values({ name: name.trim() })
      .returning();

    const [work] = await db
      .insert(sourceWorks)
      .values({
        projectId: project.id,
        title: file.name.replace(/\.txt$/i, "") || name.trim(),
        ingestStatus: "running",
      })
      .returning();

    await db.insert(chapters).values(
      chapterList.map((chapter) => ({
        workId: work.id,
        seq: chapter.seq,
        title: chapter.title,
        content: chapter.content,
        charCount: chapter.content.length,
      }))
    );

    // 建 jobs + 置 ingestStatus=running 同步完成，drain 异步触发不阻塞响应
    await createExtractJobs(work.id);
    drainIngest(work.id).catch((err) => {
      console.error(`drainIngest(workId=${work.id}) failed:`, err);
    });

    return Response.json({ projectId: project.id, workId: work.id });
  } catch (err) {
    console.error("POST /api/works failed:", err);
    return Response.json({ error: "上传失败，请重试" }, { status: 500 });
  }
}
