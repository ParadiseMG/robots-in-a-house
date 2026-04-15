import { createServer } from "node:http";
import { resolve, join } from "node:path";
import { mkdirSync } from "node:fs";
import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { db, getAgent, getResumeSessionId, type AgentRunRow } from "./db.js";

const PORT = 3100;
const ROOT = process.cwd();

function newId() {
  return crypto.randomUUID();
}

function insertEvent(runId: string, kind: string, payload: unknown) {
  db()
    .prepare(
      "INSERT INTO run_events (run_id, ts, kind, payload) VALUES (?, ?, ?, ?)",
    )
    .run(runId, Date.now(), kind, JSON.stringify(payload));
}

function updateRun(runId: string, patch: Partial<AgentRunRow>) {
  const cols = Object.keys(patch);
  if (cols.length === 0) return;
  const sql = `UPDATE agent_runs SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`;
  db().prepare(sql).run(...cols.map((c) => (patch as Record<string, unknown>)[c]), runId);
}

function addRunTokens(
  runId: string,
  delta: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_creation?: number;
  },
) {
  db()
    .prepare(
      `UPDATE agent_runs SET
         input_tokens          = COALESCE(input_tokens, 0)          + ?,
         output_tokens         = COALESCE(output_tokens, 0)         + ?,
         cache_read_tokens     = COALESCE(cache_read_tokens, 0)     + ?,
         cache_creation_tokens = COALESCE(cache_creation_tokens, 0) + ?,
         last_token_at         = ?
       WHERE id = ?`,
    )
    .run(
      delta.input ?? 0,
      delta.output ?? 0,
      delta.cache_read ?? 0,
      delta.cache_creation ?? 0,
      Date.now(),
      runId,
    );
}

// In-process registry of pending request_input waiters, keyed by runId.
// Single-process runner, so in-memory is fine.
const waiters = new Map<string, (reply: string) => void>();

function makeInputServer(runId: string) {
  return createSdkMcpServer({
    name: "robots-input",
    tools: [
      tool(
        "request_input",
        "Ask Connor (the human) a question and wait for his reply. Use this when you need a decision, clarification, or approval before continuing. Returns his reply as a string.",
        { question: z.string().describe("The question to ask Connor") },
        async (args) => {
          insertEvent(runId, "input_request", { question: args.question });
          updateRun(runId, { status: "awaiting_input" });
          const reply = await new Promise<string>((resolve) => {
            waiters.set(runId, resolve);
          });
          insertEvent(runId, "input_reply", { reply });
          updateRun(runId, { status: "running" });
          return {
            content: [{ type: "text", text: reply }],
          };
        },
      ),
    ],
  });
}

async function runAgent(params: {
  runId: string;
  agentId: string;
  officeSlug: string;
  prompt: string;
  resume?: string | null;
}) {
  const { runId, agentId, officeSlug, prompt } = params;
  const agent = getAgent(officeSlug, agentId);
  if (!agent || !agent.isReal) {
    updateRun(runId, {
      status: "error",
      error: "agent not real or not found",
      ended_at: Date.now(),
    });
    insertEvent(runId, "status", { status: "error", reason: "agent not real" });
    return;
  }

  const cwdRel = agent.cwd ?? `agent-workspaces/${officeSlug}/${agentId}`;
  const cwd = resolve(ROOT, cwdRel);
  mkdirSync(cwd, { recursive: true });

  const resume =
    params.resume !== undefined
      ? params.resume
      : getResumeSessionId(officeSlug, agentId);

  updateRun(runId, { status: "running" });
  insertEvent(runId, "status", { status: "running", cwd, resume });

  const inputServer = makeInputServer(runId);
  const extraAllowed = ["mcp__robots-input__request_input"];

  try {
    const q = query({
      prompt,
      options: {
        cwd,
        allowedTools: [...(agent.allowedTools ?? []), ...extraAllowed],
        permissionMode: "default",
        settingSources: ["project"],
        mcpServers: { "robots-input": inputServer },
        ...(agent.model ? { model: agent.model } : {}),
        ...(resume ? { resume } : {}),
      },
    });

    for await (const msg of q) {
      const now = Date.now();
      if (msg.type === "assistant") {
        const blocks = msg.message.content ?? [];
        for (const b of blocks) {
          if (b.type === "text" && b.text) {
            insertEvent(runId, "assistant", { text: b.text });
          } else if (b.type === "tool_use") {
            insertEvent(runId, "tool_use", {
              name: b.name,
              input: b.input,
              id: b.id,
            });
          }
        }
        const u = msg.message.usage;
        addRunTokens(runId, {
          input: u?.input_tokens ?? 0,
          output: u?.output_tokens ?? 0,
          cache_read: u?.cache_read_input_tokens ?? 0,
          cache_creation: u?.cache_creation_input_tokens ?? 0,
        });
        updateRun(runId, { session_id: msg.session_id });
      } else if (msg.type === "result") {
        const u = msg.usage ?? {};
        const inputTokens = (u.input_tokens ?? 0) as number;
        const outputTokens = (u.output_tokens ?? 0) as number;
        const cacheRead = (u.cache_read_input_tokens ?? 0) as number;
        const cacheCreate = (u.cache_creation_input_tokens ?? 0) as number;
        const contextTokens = inputTokens + cacheRead + cacheCreate;
        insertEvent(runId, "status", {
          status: "done",
          result: msg.subtype === "success" ? msg.result : undefined,
          subtype: msg.subtype,
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_read_tokens: cacheRead,
            cache_creation_tokens: cacheCreate,
            context_tokens: contextTokens,
          },
        });
        updateRun(runId, {
          status: "done",
          ended_at: now,
          session_id: msg.session_id,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_tokens: cacheRead,
          cache_creation_tokens: cacheCreate,
        });
      } else if (msg.type === "system") {
        // skip noise
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    insertEvent(runId, "status", { status: "error", error: message });
    updateRun(runId, {
      status: "error",
      ended_at: Date.now(),
      error: message,
    });
    console.error(`[runner] run ${runId} failed:`, err);
  } finally {
    // If the run ended while still blocked on a waiter, unblock with an empty string
    // so the MCP tool promise resolves (SDK shutdown path).
    const w = waiters.get(runId);
    if (w) {
      waiters.delete(runId);
      w("");
    }
  }
}

async function readJson(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/runs") {
      const body = (await readJson(req)) as {
        assignmentId: string;
        agentId: string;
        officeSlug: string;
        prompt: string;
        resume?: string | null;
      };
      if (!body.assignmentId || !body.agentId || !body.officeSlug || !body.prompt) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "missing fields" }));
        return;
      }
      const runId = newId();
      db()
        .prepare(
          `INSERT INTO agent_runs (id, assignment_id, agent_id, office_slug, status, started_at)
           VALUES (?, ?, ?, ?, 'starting', ?)`,
        )
        .run(runId, body.assignmentId, body.agentId, body.officeSlug, Date.now());
      insertEvent(runId, "status", { status: "starting" });

      // Fire-and-forget
      void runAgent({
        runId,
        agentId: body.agentId,
        officeSlug: body.officeSlug,
        prompt: body.prompt,
        resume: body.resume,
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ runId }));
      return;
    }

    // POST /runs/:id/reply — resolves a pending request_input waiter
    const replyMatch =
      req.method === "POST" && req.url
        ? req.url.match(/^\/runs\/([^/]+)\/reply$/)
        : null;
    if (replyMatch) {
      const runId = decodeURIComponent(replyMatch[1]);
      const body = (await readJson(req)) as { reply?: string };
      const reply = typeof body.reply === "string" ? body.reply : "";
      const waiter = waiters.get(runId);
      if (!waiter) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "no pending input request" }));
        return;
      }
      waiters.delete(runId);
      waiter(reply);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  } catch (err) {
    console.error("[runner] handler error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

// Touch DB to force migrations at boot
db();
const LOG_DIR = join(ROOT, "data");
mkdirSync(LOG_DIR, { recursive: true });

server.listen(PORT, () => {
  console.log(`[runner] listening on :${PORT}`);
});
