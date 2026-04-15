import { NextResponse } from "next/server";
import { db } from "@/server/db";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: runId } = await params;
  const now = Date.now();
  const result = db()
    .prepare(
      "UPDATE agent_runs SET acknowledged_at = ? WHERE id = ? AND acknowledged_at IS NULL",
    )
    .run(now, runId);
  return NextResponse.json({ ok: true, updated: result.changes });
}
