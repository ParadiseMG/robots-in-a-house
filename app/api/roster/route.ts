import { NextResponse } from "next/server";
import { db } from "@/server/db";
import paradiseRaw from "@/config/paradise.office.json";
import dontcallRaw from "@/config/dontcall.office.json";
import type { OfficeConfig } from "@/lib/office-types";

const offices: Record<string, OfficeConfig> = {
  paradise: paradiseRaw as OfficeConfig,
  dontcall: dontcallRaw as OfficeConfig,
};

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const officeSlug = url.searchParams.get("office");
  if (!officeSlug) {
    return NextResponse.json({ error: "missing office" }, { status: 400 });
  }
  const office = offices[officeSlug];
  if (!office) return NextResponse.json({ error: "office not found" }, { status: 404 });

  const d = db();
  const entries = office.agents.map((agent) => {
    const current = d
      .prepare(
        `SELECT a.id as assignment_id, a.assigned_at, t.id as task_id, t.title, t.body
         FROM assignments a
         JOIN tasks t ON t.id = a.task_id
         WHERE a.agent_id = ? AND a.office_slug = ? AND a.completed_at IS NULL
         ORDER BY a.assigned_at DESC
         LIMIT 1`,
      )
      .get(agent.id, officeSlug) as
      | { assignment_id: string; assigned_at: number; task_id: string; title: string; body: string }
      | undefined;

    const latestRun = current
      ? (d
          .prepare(
            `SELECT id, status, acknowledged_at FROM agent_runs
             WHERE assignment_id = ?
             ORDER BY started_at DESC LIMIT 1`,
          )
          .get(current.assignment_id) as
          | { id: string; status: string; acknowledged_at: number | null }
          | undefined)
      : undefined;

    let inputQuestion: string | null = null;
    if (latestRun && latestRun.status === "awaiting_input") {
      const row = d
        .prepare(
          `SELECT payload FROM run_events
           WHERE run_id = ? AND kind = 'input_request'
           ORDER BY id DESC LIMIT 1`,
        )
        .get(latestRun.id) as { payload: string } | undefined;
      if (row) {
        try {
          const parsed = JSON.parse(row.payload) as { question?: string };
          inputQuestion = parsed.question ?? null;
        } catch {
          // ignore
        }
      }
    }

    return {
      agent: {
        id: agent.id,
        deskId: agent.deskId,
        name: agent.name,
        role: agent.role,
        isReal: agent.isReal,
        model: agent.model ?? null,
      },
      current: current
        ? {
            assignmentId: current.assignment_id,
            assignedAt: current.assigned_at,
            task: { id: current.task_id, title: current.title, body: current.body },
            runId: latestRun?.id ?? null,
            runStatus: latestRun?.status ?? null,
            acknowledgedAt: latestRun?.acknowledged_at ?? null,
            inputQuestion,
          }
        : null,
    };
  });

  return NextResponse.json({ officeSlug, entries });
}
