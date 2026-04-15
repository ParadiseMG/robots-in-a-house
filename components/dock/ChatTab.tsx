"use client";

import { useEffect, useRef, useState } from "react";
import MessageList, { type ChatMessage } from "@/components/dock/MessageList";
import ToolCallLine from "@/components/dock/ToolCallLine";
import AwaitingInputForm from "@/components/dock/AwaitingInputForm";

type StreamEvent =
  | { kind: "assistant"; payload: { text: string } }
  | { kind: "tool_use"; payload: { name: string; input: unknown; id: string } }
  | { kind: "status"; payload: { status: string; error?: string; result?: string } }
  | { kind: "close" };

type InspectionCurrent = {
  runId: string | null;
  runStatus: string | null;
  inputQuestion: string | null;
  acknowledgedAt: number | null;
};

type Inspection = {
  agent: {
    id: string;
    name: string;
    role: string;
    isReal: boolean;
    model: string | null;
  };
  current: InspectionCurrent | null;
};

type Props = {
  officeSlug: string;
  agentId: string;
  deskId: string;
  agentName: string;
  /** Called when run status changes (for badge updates) */
  onStatusChange?: (status: string | null) => void;
};

export default function ChatTab({
  officeSlug,
  agentId,
  deskId,
  agentName,
  onStatusChange,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [liveText, setLiveText] = useState("");
  const [liveTools, setLiveTools] = useState<Array<{ name: string; id: string }>>([]);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [chatText, setChatText] = useState("");
  const [chatPending, setChatPending] = useState(false);
  const [refetchNonce, setRefetchNonce] = useState(0);
  const latestAgentId = useRef(agentId);
  latestAgentId.current = agentId;

  // Fetch inspection data (agent + current run)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/inspector?office=${encodeURIComponent(officeSlug)}&deskId=${encodeURIComponent(deskId)}`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as Inspection;
        if (alive) setInspection(json);
      } catch {
        // ignore
      }
    })();
    return () => { alive = false; };
  }, [officeSlug, deskId, refetchNonce]);

  // Fetch transcript
  useEffect(() => {
    let alive = true;
    setMessages(null);
    (async () => {
      try {
        const qs = new URLSearchParams({ office: officeSlug, agentId });
        const res = await fetch(`/api/session/transcript?${qs}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { messages: ChatMessage[] };
        if (alive) setMessages(json.messages);
      } catch {
        // ignore
      }
    })();
    return () => { alive = false; };
  }, [officeSlug, agentId, refetchNonce]);

  // Auto-ack done runs
  useEffect(() => {
    const c = inspection?.current;
    if (!c) return;
    if (c.runStatus === "done" && c.runId && c.acknowledgedAt == null) {
      void fetch(`/api/runs/${encodeURIComponent(c.runId)}/ack`, { method: "POST" }).catch(() => {});
    }
  }, [inspection]);

  // SSE stream for active runs
  const runId = inspection?.current?.runId ?? null;
  const runStatus = inspection?.current?.runStatus ?? null;
  const isLive = runStatus === "starting" || runStatus === "running";

  useEffect(() => {
    onStatusChange?.(runStatus);
  }, [runStatus, onStatusChange]);

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
          setLiveText((prev) => prev ? prev + "\n\n" + msg.payload.text : msg.payload.text);
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
    return () => { es.close(); };
  }, [runId, isLive]);

  const onChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = chatText.trim();
    const agent = inspection?.agent;
    if (!trimmed || !agent || chatPending) return;
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

  const isReal = inspection?.agent?.isReal ?? false;
  const awaitingInput = runStatus === "awaiting_input";
  const busy = chatPending || isLive || awaitingInput;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Message area */}
      <MessageList
        messages={messages}
        liveText={liveText}
        liveTools={liveTools}
        liveStatus={liveStatus}
        isLive={isLive}
      />

      {/* Awaiting-input inline form */}
      {awaitingInput && inspection?.current?.runId && (
        <div className="border-t border-white/10 p-2">
          <AwaitingInputForm
            runId={inspection.current.runId}
            question={inspection.current.inputQuestion}
            onSubmitted={() => setRefetchNonce((n) => n + 1)}
          />
        </div>
      )}

      {/* Chat input footer — only for real agents */}
      {isReal && (
        <form
          onSubmit={onChat}
          className="flex items-center gap-1 border-t border-white/10 bg-black/40 p-2"
        >
          <input
            type="text"
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            placeholder={
              awaitingInput
                ? "reply above…"
                : busy
                ? "agent is working…"
                : `talk to ${agentName}…`
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
      )}
    </div>
  );
}
