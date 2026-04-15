import { NextResponse } from "next/server";
import { db, type TaskRow } from "@/server/db";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const office = url.searchParams.get("office");
  if (!office) return NextResponse.json({ error: "missing office" }, { status: 400 });

  const rows = db()
    .prepare(
      "SELECT id, office_slug, title, body, status, created_at FROM tasks WHERE office_slug = ? AND status = 'tray' ORDER BY created_at ASC",
    )
    .all(office) as TaskRow[];

  return NextResponse.json({ tasks: rows });
}
