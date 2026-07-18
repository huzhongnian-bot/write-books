import { getIngestStatus } from "@/lib/ingest/pipeline";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const workId = Number(id);
  if (!Number.isInteger(workId) || workId <= 0) {
    return Response.json({ error: "无效的 workId" }, { status: 400 });
  }

  const status = await getIngestStatus(workId);
  return Response.json(status);
}
