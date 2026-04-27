import { NextResponse } from "next/server";
import { exec } from "node:child_process";

export const dynamic = "force-dynamic";

/**
 * POST /api/restart-runner
 *
 * Kills the agent-runner process and spawns a fresh one.
 * The new process inherits the same cwd and environment.
 */
export async function POST() {
  try {
    // Find and kill the current runner process
    const cwd = process.cwd();
    exec(
      `lsof -ti :${process.env.RUNNER_PORT ?? "3100"} | xargs kill -9 2>/dev/null; sleep 0.5; cd "${cwd}" && tsx server/agent-runner.ts &`,
      { cwd, env: { ...process.env } },
    );

    return NextResponse.json({ ok: true, message: "Runner restart initiated" });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 },
    );
  }
}
