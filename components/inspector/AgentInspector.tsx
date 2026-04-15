"use client";

import { useEffect, useRef, useState } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  ts: number;
  text: string;
  runId?: string;
};

type Inspection = {
  agent: { id: string; name: string; role: string; isReal: boolean; model: string | null };
  desk: { id: string; facing: string };
  room: { id: string; name: string } | null;
  current: {
    assignmentId: string;
    assignedAt: number;
    task: { id: string; title: string; body: string };
    runId: string | null;
    runStatus: string | null;
    acknowledgedAt: number | null;
    inputQuestion: string | null;
  } | null;
  history: Array<{
    assignmentId: string;
    title: string;
    assignedAt: number;
    completedAt: number | null;
  }>;
  context: {
    tokens: number;
    limit: number;
    pct: number;
    measuredAt: number;
  } | null;
};

type StreamEvent =
  | { kind: "assistant"; payload: { text: string } }
  | { kind: "tool_use"; payload: { name: string; input: unknown; id: string } }
  | { kind: "status"; payload: { status: string; error?: string; result?: string } }
  | { kind: "close" };

type Props = {
  officeSlug: string;
  deskId: string;
  onClose: () => void;
};

const fmt = (ts: number) => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export default function AgentInspector({ officeSlug, deskId, onClose }: Props) {
  const [data, setData] = useState<Inspection | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [liveText, setLiveText] = useState<string>("");
  const [liveTools, setLiveTools] = useState<Array<{ name: string; id: string }>>(
    [],
  );
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [refetchNonce, setRefetchNonce] = useState(0);
  const [breakPending, setBreakPending] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyPending, setReplyPending] = useState(false);
  const [chatText, setChatText] = useState("");
  const [chatPending, setChatPending] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setErr(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/inspector?office=${encodeURIComponent(officeSlug)}&deskId=${encodeURIComponent(deskId)}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as Inspection;
        if (alive) setData(json);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : "fetch error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [officeSlug, deskId, refetchNonce]);

  // Fetch session transcript (past messages for this agent)
  useEffect(() => {
    const agentId = data?.agent.id;
    if (!agentId || !chatOpen) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/session/transcript?office=${encodeURIComponent(officeSlug)}&agentId=${encodeURIComponent(agentId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const json = (await res.json()) as { messages: ChatMessage[] };
        if (alive) setMessages(json.messages);
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, [data?.agent.id, officeSlug, chatOpen, refetchNonce]);

  // Auto-scroll chat to bottom when messages or live text change
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, liveText, chatOpen]);

  // Auto-ack done runs when inspector opens
  useEffect(() => {
    const c = data?.current;
    if (!c) return;
    if (c.runStatus === "done" && c.runId && c.acknowledgedAt == null) {
      void fetch(`/api/runs/${encodeURIComponent(c.runId)}/ack`, {
        method: "POST",
      }).catch(() => {});
    }
  }, [data]);

  const onReply = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = replyText.trim();
    const rid = data?.current?.runId;
    if (!trimmed || !rid || replyPending) return;
    setReplyPending(true);
    try {
      await fetch(`/api/runs/${encodeURIComponent(rid)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: trimmed }),
      });
      setReplyText("");
      setRefetchNonce((n) => n + 1);
    } finally {
      setReplyPending(false);
    }
  };

  const onChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = chatText.trim();
    const agentId = data?.agent.id;
    if (!trimmed || !agentId || chatPending) return;
    setChatPending(true);
    try {
      await fetch("/api/quick-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ officeSlug, agentId, prompt: trimmed }),
      });
      setChatText("");
      setRefetchNonce((n) => n + 1);
    } finally {
      setChatPending(false);
    }
  };

  const onBreak = async () => {
    if (breakPending) return;
    setBreakPending(true);
    try {
      const res = await fetch("/api/break", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ officeSlug, agentId: data?.agent.id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRefetchNonce((n) => n + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "break failed");
    } finally {
      setBreakPending(false);
    }
  };

  const runId = data?.current?.runId ?? null;
  const runStatus = data?.current?.runStatus ?? null;
  const isLive = runStatus === "starting" || runStatus === "running";
  useEffect(() => {
    if (!runId || !isLive) {
      setLiveText("");
      setLiveTools([]);
      setLiveStatus(null);
      return;
    }
    setLiveText("");
    setLiveTools([]);
    setLiveStatus(null);
    let sawLive = false;
    const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/stream`);
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as StreamEvent;
        if (msg.kind === "assistant") {
          setLiveText((prev) => (prev ? prev + "\n\n" + msg.payload.text : msg.payload.text));
        } else if (msg.kind === "tool_use") {
          setLiveTools((prev) => [...prev, { name: msg.payload.name, id: msg.payload.id }]);
        } else if (msg.kind === "status") {
          setLiveStatus(msg.payload.status);
          if (msg.payload.status === "starting" || msg.payload.status === "running") {
            sawLive = true;
          }
          if (msg.payload.status === "done" || msg.payload.status === "error") {
            es.close();
            if (sawLive) setRefetchNonce((n) => n + 1);
          }
        } else if (msg.kind === "close") {
          es.close();
        }
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      // Let the browser handle reconnect unless we've marked it done
    };
    return () => {
      es.close();
    };
  }, [runId, isLive]);

  return (
    <aside className="flex h-full w-72 flex-col border-l border-white/10 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 font-mono text-xs uppercase tracking-wider text-white/60">
        <span>inspector</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-1.5 py-0.5 text-white/60 hover:bg-white/10 hover:text-white"
          aria-label="Close inspector"
        >
          ✕
        </button>
      </div>
      {!data && !err && (
        <div className="flex-1 p-4 text-xs text-white/40">loading…</div>
      )}
      {err && <div className="flex-1 p-4 text-xs text-red-400">error: {err}</div>}
      {data && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wider text-white/40">agent</div>
            <div className="mt-1 font-medium text-white">{data.agent.name}</div>
            <div className="text-xs text-white/60">{data.agent.role}</div>
            <div className="mt-1 flex gap-2 text-[10px] font-mono uppercase tracking-wider">
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">
                {data.room?.name ?? "—"}
              </span>
              <span
                className={
                  data.agent.isReal
                    ? "rounded bg-emerald-400/20 px-1.5 py-0.5 text-emerald-300"
                    : "rounded bg-white/10 px-1.5 py-0.5 text-white/60"
                }
              >
                {data.agent.isReal ? "real" : "sim"}
              </span>
              {data.agent.isReal && (() => {
                const m = data.agent.model?.toLowerCase() ?? "";
                const label = m.includes("opus")
                  ? "opus"
                  : m.includes("haiku")
                    ? "haiku"
                    : m.includes("sonnet")
                      ? "sonnet"
                      : data.agent.model
                        ? data.agent.model
                        : "sonnet";
                const isOpus = label === "opus";
                return (
                  <span
                    className={
                      isOpus
                        ? "rounded bg-purple-400/20 px-1.5 py-0.5 text-purple-300"
                        : "rounded bg-sky-400/15 px-1.5 py-0.5 text-sky-300"
                    }
                    title={data.agent.model ?? "SDK default (sonnet)"}
                  >
                    {label}
                  </span>
                );
              })()}
            </div>
            {data.agent.isReal && data.context && (() => {
              const { tokens, limit, pct } = data.context;
              const k = (n: number) =>
                n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
              const tone =
                pct >= 0.9
                  ? { bar: "bg-red-400", text: "text-red-300", hint: "break time now" }
                  : pct >= 0.75
                    ? { bar: "bg-amber-400", text: "text-amber-300", hint: "consider break time" }
                    : pct >= 0.5
                      ? { bar: "bg-emerald-400", text: "text-emerald-300", hint: "plenty of room" }
                      : { bar: "bg-emerald-400", text: "text-emerald-300", hint: "fresh" };
              return (
                <div className="mt-2">
                  <div className="flex items-center justify-between font-mono text-[10px]">
                    <span className="text-white/40 uppercase tracking-wider">context</span>
                    <span className={tone.text}>
                      {k(tokens)} / {k(limit)} · {Math.round(pct * 100)}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-white/10">
                    <div
                      className={`h-full ${tone.bar} transition-all`}
                      style={{ width: `${Math.max(2, pct * 100)}%` }}
                    />
                  </div>
                  <div className={`mt-0.5 font-mono text-[10px] ${tone.text}`}>
                    {tone.hint}
                  </div>
                </div>
              );
            })()}
            {data.agent.isReal && (() => {
              const effective = liveStatus ?? data.current?.runStatus ?? null;
              const busy =
                breakPending || effective === "running" || effective === "starting";
              return (
                <button
                  type="button"
                  onClick={onBreak}
                  disabled={busy}
                  className="mt-2 w-full rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-amber-200 hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Write to memory and start a fresh session"
                >
                  {breakPending ? "…" : "☕ break time"}
                </button>
              );
            })()}
          </div>

          <div>
            <button
              type="button"
              onClick={() => setChatOpen((v) => !v)}
              className="flex w-full items-center justify-between text-xs uppercase tracking-wider text-white/40 hover:text-white/70"
            >
              <span>current</span>
              <span className="font-mono text-[10px]">{chatOpen ? "▾" : "▸"}</span>
            </button>
            {data.current ? (
              <div className="mt-1 rounded border border-white/15 bg-black/50 p-2">
                <div className="font-medium text-white">{data.current.task.title}</div>
                <div className="mt-1 flex items-center gap-2 font-mono text-[10px]">
                  <span className="text-white/40">
                    assigned {fmt(data.current.assignedAt)}
                  </span>
                  {data.current.runStatus && (
                    <span
                      className={
                        (liveStatus ?? data.current.runStatus) === "running"
                          ? "rounded bg-amber-400/20 px-1.5 py-0.5 text-amber-300"
                          : (liveStatus ?? data.current.runStatus) === "done"
                            ? "rounded bg-emerald-400/20 px-1.5 py-0.5 text-emerald-300"
                            : (liveStatus ?? data.current.runStatus) === "error"
                              ? "rounded bg-red-500/20 px-1.5 py-0.5 text-red-300"
                              : "rounded bg-white/10 px-1.5 py-0.5 text-white/60"
                      }
                    >
                      {liveStatus ?? data.current.runStatus}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-1 text-xs text-white/40">idle</div>
            )}
          </div>

          {chatOpen && (
            <div>
              <div className="text-xs uppercase tracking-wider text-white/40">chat</div>
              <div
                ref={scrollRef}
                className="mt-1 max-h-96 space-y-2 overflow-y-auto rounded border border-white/10 bg-black/40 p-2"
              >
                {messages === null ? (
                  <div className="text-center text-xs text-white/30">loading…</div>
                ) : messages.length === 0 && !isLive ? (
                  <div className="text-center text-xs text-white/30">
                    no messages yet — say hi below
                  </div>
                ) : (
                  <>
                    {messages?.map((m, i) => (
                      <div
                        key={i}
                        className={
                          m.role === "user"
                            ? "ml-4 rounded-lg rounded-tr-sm bg-sky-400/15 p-2 text-xs text-sky-100"
                            : "mr-4 rounded-lg rounded-tl-sm bg-white/10 p-2 text-xs text-white/90"
                        }
                      >
                        <div className="whitespace-pre-wrap font-mono leading-relaxed">
                          {m.text}
                        </div>
                        <div className="mt-0.5 text-right font-mono text-[9px] text-white/30">
                          {fmt(m.ts)}
                        </div>
                      </div>
                    ))}
                    {isLive && liveText && (
                      <div className="mr-4 rounded-lg rounded-tl-sm border border-amber-400/30 bg-amber-400/5 p-2 text-xs text-white/90">
                        <div className="whitespace-pre-wrap font-mono leading-relaxed">
                          {liveText}
                        </div>
                        <div className="mt-0.5 flex items-center justify-between font-mono text-[9px] text-amber-300/60">
                          <span>typing…</span>
                          {liveTools.length > 0 && (
                            <span>
                              {liveTools.length} tool call
                              {liveTools.length === 1 ? "" : "s"}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    {isLive && !liveText && (
                      <div className="mr-4 rounded-lg rounded-tl-sm bg-white/5 p-2 text-xs text-white/40">
                        <span className="font-mono">
                          {liveStatus === "starting" || !liveStatus
                            ? "starting…"
                            : "thinking…"}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {data.current?.runStatus === "awaiting_input" && data.current.runId && (
            <div className="rounded border border-yellow-400/40 bg-yellow-400/10 p-2">
              <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-yellow-200">
                <span className="rounded bg-yellow-400 px-1 font-bold text-black">!</span>
                awaiting input
              </div>
              {data.current.inputQuestion && (
                <div className="mt-1.5 text-sm text-yellow-100">
                  {data.current.inputQuestion}
                </div>
              )}
              <form onSubmit={onReply} className="mt-2 flex gap-1">
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="your reply…"
                  disabled={replyPending}
                  autoFocus
                  className="flex-1 rounded border border-white/20 bg-black/60 px-2 py-1 font-mono text-xs outline-none focus:border-yellow-300/60 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={replyPending || !replyText.trim()}
                  className="rounded border border-yellow-400/40 bg-yellow-400/20 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-yellow-100 hover:bg-yellow-400/30 disabled:opacity-40"
                >
                  {replyPending ? "…" : "send"}
                </button>
              </form>
            </div>
          )}

          <div>
            <div className="text-xs uppercase tracking-wider text-white/40">history</div>
            {data.history.length === 0 ? (
              <div className="mt-1 text-xs text-white/40">no past runs</div>
            ) : (
              <ul className="mt-1 space-y-1">
                {data.history.map((h) => (
                  <li
                    key={h.assignmentId}
                    className="flex items-start justify-between gap-2 text-xs"
                  >
                    <span className="truncate text-white/80">{h.title}</span>
                    <span className="shrink-0 font-mono text-[10px] text-white/40">
                      {fmt(h.assignedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {data?.agent.isReal && (() => {
        const effective = liveStatus ?? data.current?.runStatus ?? null;
        const busy =
          chatPending ||
          effective === "running" ||
          effective === "starting" ||
          effective === "awaiting_input";
        return (
          <form
            onSubmit={onChat}
            className="flex items-center gap-1 border-t border-white/10 bg-black/40 p-2"
          >
            <input
              type="text"
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              placeholder={
                effective === "awaiting_input"
                  ? "reply above…"
                  : busy
                    ? "agent is working…"
                    : `talk to ${data.agent.name}…`
              }
              disabled={busy}
              className="flex-1 rounded border border-white/20 bg-black/60 px-2 py-1 font-mono text-xs outline-none focus:border-white/40 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || !chatText.trim()}
              className="rounded border border-white/20 bg-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-white hover:bg-white/20 disabled:opacity-40"
            >
              {chatPending ? "…" : "send"}
            </button>
          </form>
        );
      })()}
    </aside>
  );
}
