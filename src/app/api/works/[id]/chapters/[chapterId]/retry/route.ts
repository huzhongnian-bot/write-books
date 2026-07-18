import { retryFailedChapter } from "@/lib/ingest/pipeline";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; chapterId: string }> }
) {
  const { id, chapterId } = await params;
  const workId = Number(id);
  const chapterIdNum = Number(chapterId);
  if (
    !Number.isInteger(workId) ||
    workId <= 0 ||
    !Number.isInteger(chapterIdNum) ||
    chapterIdNum <= 0
  ) {
    return Response.json({ error: "无效的参数" }, { status: 400 });
  }

  // retryFailedChapter 内部会重置 failed job 并触发 drain，fire-and-forget
  retryFailedChapter(workId, chapterIdNum).catch((err) => {
    console.error(
      `retryFailedChapter(workId=${workId}, chapterId=${chapterIdNum}) failed:`,
      err
    );
  });

  return Response.json({ ok: true });
}
