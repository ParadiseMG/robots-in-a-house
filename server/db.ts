import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import paradiseRaw from "../config/paradise.office.json" with { type: "json" };
import dontcallRaw from "../config/dontcall.office.json" with { type: "json" };
import type { OfficeConfig } from "../lib/office-types.js";

const DB_DIR = join(process.cwd(), "data");
const DB_PATH = join(DB_DIR, "robots.db");

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  mkdirSync(DB_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  seedIfEmpty(_db);
  return _db;
}

function migrate(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      office_slug TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'tray',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_office ON tasks(office_slug, status);

    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      agent_id TEXT NOT NULL,
      desk_id TEXT NOT NULL,
      office_slug TEXT NOT NULL,
      assigned_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_assignments_agent ON assignments(agent_id, completed_at);
    CREATE INDEX IF NOT EXISTS idx_assignments_office ON assignments(office_slug, completed_at);

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL REFERENCES assignments(id),
      agent_id TEXT NOT NULL,
      office_slug TEXT NOT NULL,
      session_id TEXT,
      status TEXT NOT NULL DEFAULT 'starting',
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      last_token_at INTEGER,
      error TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_read_tokens INTEGER,
      cache_creation_tokens INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_runs_assignment ON agent_runs(assignment_id);
    CREATE INDEX IF NOT EXISTS idx_runs_agent ON agent_runs(agent_id, started_at);

    CREATE TABLE IF NOT EXISTS run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES agent_runs(id),
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_run ON run_events(run_id, id);

    CREATE TABLE IF NOT EXISTS session_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      office_slug TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      reset_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_resets_agent ON session_resets(office_slug, agent_id, reset_at);
  `);

  // Idempotent column additions for agent_runs (pre-existing DBs)
  const cols = (
    d.prepare("PRAGMA table_info(agent_runs)").all() as Array<{ name: string }>
  ).map((r) => r.name);
  const add = (name: string, ddl: string) => {
    if (!cols.includes(name)) d.exec(`ALTER TABLE agent_runs ADD COLUMN ${ddl}`);
  };
  add("input_tokens", "input_tokens INTEGER");
  add("output_tokens", "output_tokens INTEGER");
  add("cache_read_tokens", "cache_read_tokens INTEGER");
  add("cache_creation_tokens", "cache_creation_tokens INTEGER");
  add("acknowledged_at", "acknowledged_at INTEGER");
}

export function getResumeSessionId(
  officeSlug: string,
  agentId: string,
): string | null {
  const d = db();
  const lastReset = d
    .prepare(
      "SELECT reset_at FROM session_resets WHERE office_slug = ? AND agent_id = ? ORDER BY reset_at DESC LIMIT 1",
    )
    .get(officeSlug, agentId) as { reset_at: number } | undefined;
  const cutoff = lastReset?.reset_at ?? 0;
  const row = d
    .prepare(
      `SELECT session_id FROM agent_runs
       WHERE office_slug = ? AND agent_id = ? AND session_id IS NOT NULL AND started_at > ?
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get(officeSlug, agentId, cutoff) as { session_id: string } | undefined;
  return row?.session_id ?? null;
}

function seedIfEmpty(d: Database.Database) {
  const n = (d.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n;
  if (n > 0) return;

  const insert = d.prepare(
    "INSERT INTO tasks (id, office_slug, title, body, status, created_at) VALUES (?, ?, ?, ?, 'tray', ?)",
  );
  const now = Date.now();
  const seed = [
    ["paradise", "Summarize last 3 event recaps", "Pull the Notion pages for the last 3 Paradise shows and extract headlines."],
    ["paradise", "Draft Friday show announce copy", "SMS + IG caption, 160 chars each."],
    ["paradise", "Chase 2 unsigned artist contracts", "Who's outstanding? Post list."],
    ["dontcall", "Lead triage — new inbound SMS", "Classify, dedupe, tag by trade."],
    ["dontcall", "Route 3 queued jobs to tradesmen", "Match by zip + availability."],
    ["dontcall", "Nightly callback list", "Pull queue, sort by priority."],
  ];
  const insertMany = d.transaction((rows: typeof seed) => {
    for (const [office, title, body] of rows) {
      insert.run(crypto.randomUUID(), office, title, body, now);
    }
  });
  insertMany(seed);
}

// ---- Helpers for config lookups (not persisted — offices are config-driven) ----

const OFFICES: Record<string, OfficeConfig> = {
  paradise: paradiseRaw as OfficeConfig,
  dontcall: dontcallRaw as OfficeConfig,
};

export function getAgent(officeSlug: string, agentId: string) {
  const office = OFFICES[officeSlug];
  if (!office) return null;
  const agent = office.agents.find((a) => a.id === agentId);
  if (!agent) return null;
  return { ...agent, officeSlug };
}

export function getDeskForAgent(officeSlug: string, agentId: string) {
  const agent = getAgent(officeSlug, agentId);
  if (!agent) return null;
  const office = OFFICES[officeSlug];
  return office.desks.find((desk) => desk.id === agent.deskId) ?? null;
}

// ---- Typed row shapes ----

export type TaskRow = {
  id: string;
  office_slug: string;
  title: string;
  body: string;
  status: "tray" | "assigned" | "done";
  created_at: number;
};

export type AssignmentRow = {
  id: string;
  task_id: string;
  agent_id: string;
  desk_id: string;
  office_slug: string;
  assigned_at: number;
  completed_at: number | null;
};

export type AgentRunRow = {
  id: string;
  assignment_id: string;
  agent_id: string;
  office_slug: string;
  session_id: string | null;
  status: "starting" | "running" | "awaiting_input" | "done" | "error";
  started_at: number;
  ended_at: number | null;
  last_token_at: number | null;
  error: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  acknowledged_at: number | null;
};

export type RunEventRow = {
  id: number;
  run_id: string;
  ts: number;
  kind: "assistant" | "tool_use" | "tool_result" | "status";
  payload: string;
};
