import { db } from "@/lib/db";
import {
  chapters,
  projects,
  projectThemeEnum,
  sourceWorks,
} from "@/lib/db/schema";
import { decodeText, splitChapters } from "@/lib/ingest/split";
import { indexWorkChunks } from "@/lib/retrieval/chunks";

// 纯 RAG 后 prompt 规模与原作体量解耦，上限只防病态大文件撑爆内存
// （全文 + 切块驻留内存、单请求同步建索引）：2000 章 / 1000 万字 ≈ 20–30MB
// 文件、约 2 万块 FTS 插入，本地实测秒级完成（docs/specs/ingest.md §2.1）
const MAX_CHAPTERS = 2000;
const MAX_CHARS = 10_000_000;

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
  const themeRaw = formData.get("theme");

  if (typeof name !== "string" || name.trim().length === 0) {
    return badRequest("缺少项目名称");
  }
  if (file === null || typeof file === "string") {
    return badRequest("缺少 TXT 文件");
  }
  // 文学主题为可选项，缺省 default；给了非法值则拒绝
  const themeParsed = projectThemeEnum.safeParse(themeRaw ?? "default");
  if (!themeParsed.success) {
    return badRequest("无效的文学主题");
  }
  const theme = themeParsed.data;

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
      `总字数 ${totalChars} 超过上限 1000 万字，请将作品分卷后分别上传`
    );
  }

  try {
    // 纯 RAG 摄取（docs/specs/ingest.md）：project + work + chapters +
    // chapter_chunks(FTS 索引) 四步写入在同一事务，上传即完成、无后台任务。
    // better-sqlite3 事务回调必须同步（.run()/.all() 终结）。
    const { projectId, workId } = db.transaction((tx) => {
      const [project] = tx
        .insert(projects)
        .values({ name: name.trim(), theme })
        .returning()
        .all();

      const [work] = tx
        .insert(sourceWorks)
        .values({
          projectId: project.id,
          title: file.name.replace(/\.txt$/i, "") || name.trim(),
        })
        .returning()
        .all();

      tx.insert(chapters)
        .values(
          chapterList.map((chapter) => ({
            workId: work.id,
            seq: chapter.seq,
            title: chapter.title,
            content: chapter.content,
            charCount: chapter.content.length,
          }))
        )
        .run();

      // 生成时无模型 RAG 的数据源（src/lib/retrieval/chunks.ts），
      // 与 chapters 同事务同生共死
      indexWorkChunks(tx, work.id, chapterList);

      return { projectId: project.id, workId: work.id };
    });

    return Response.json({ projectId, workId });
  } catch (err) {
    console.error("POST /api/works failed:", err);
    // 本地单用户应用：把真实原因透传给用户（如建表缺失/磁盘错误），
    // 而不是一句无法定位的「请重试」
    const message = err instanceof Error ? err.message : "未知错误";
    return Response.json({ error: `上传失败：${message}` }, { status: 500 });
  }
}
