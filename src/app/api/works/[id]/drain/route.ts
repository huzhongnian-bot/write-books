import { drainIngest } from "@/lib/ingest/pipeline";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const workId = Number(id);
  if (!Number.isInteger(workId) || workId <= 0) {
    return Response.json({ error: "无效的 workId" }, { status: 400 });
  }

  // fire-and-forget：进程重启后恢复用，不阻塞响应
  drainIngest(workId).catch((err) => {
    console.error(`drainIngest(workId=${workId}) failed:`, err);
  });

  return Response.json({ ok: true });
}
