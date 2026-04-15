"use client";

import { useEffect, useMemo, useState } from "react";
import { useDockTabs } from "@/hooks/useDockTabs";
import type { OfficeConfig } from "@/lib/office-types";

type Attendee = {
  agentId: string;
  assignmentId: string;
  runId: string | null;
  runStatus: string;
  tailSnippet: string | null;
};

type MeetingState = {
  meetingId: string;
  convenedAt: number;
  attendees: Attendee[];
  status: "running" | "done";
};

type RosterEntry = {
  agent: { id: string; deskId: string };
  current: { runStatus: string | null; acknowledgedAt: number | null } | null;
};

type Props = {
  tabId: string;
  officeSlug: string;
  office: OfficeConfig;
  roster: RosterEntry[] | null;
};

const POLL_MS = 1500;

export default function WarRoomTab({ tabId, officeSlug, office, roster }: Props) {
  const { dispatch } = useDockTabs();
  const head = useMemo(() => office.agents.find((a) => a.isHead) ?? null, [office]);
  const realAgents = useMemo(() => office.agents.filter((a) => a.isReal), [office]);

  const [picked, setPicked] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (head) s.add(head.id);
    return s;
  });
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meeting, setMeeting] = useState<MeetingState | null>(null);

  const togglePick = (agentId: string) => {
    if (head && agentId === head.id) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  };

  const convene = async () => {
    if (!prompt.trim() || picked.size === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/war-room/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          officeSlug,
          agentIds: Array.from(picked),
          prompt: prompt.trim(),
          convenedBy: head?.id,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `convene failed (${res.status})`);
      }
      const j = (await res.json()) as {
        meetingId: string;
        convenedAt: number;
        attendees: Array<{ agentId: string; assignmentId: string; runId: string | null }>;
      };
      const newMeeting: MeetingState = {
        meetingId: j.meetingId,
        convenedAt: j.convenedAt,
        attendees: j.attendees.map((a) => ({
          agentId: a.agentId,
          assignmentId: a.assignmentId,
          runId: a.runId,
          runStatus: "queued",
          tailSnippet: null,
        })),
        status: "running",
      };
      setMeeting(newMeeting);
      dispatch({ type: "SET_MEETING_ID", id: tabId, meetingId: j.meetingId });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  // Poll meeting status
  useEffect(() => {
    if (!meeting) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/war-room/${encodeURIComponent(meeting.meetingId)}`);
        if (!res.ok) return;
        const j = (await res.json()) as MeetingState;
        if (cancelled) return;
        setMeeting((prev) => prev ? { ...prev, ...j } : prev);
      } catch {
        // ignore
      }
    };
    void tick();
    const id = setInterval(() => {
      if (meeting.status === "done") return;
      void tick();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [meeting?.meetingId, meeting?.status]);

  const agentNameById = useMemo(() => {
    const m = new Map<string, { name: string; role: string; deskId: string }>();
    for (const a of office.agents) m.set(a.id, { name: a.name, role: a.role, deskId: a.deskId });
    return m;
  }, [office]);

  const accentColor = office.theme.accent;

  if (!meeting) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {/* Attendee picker */}
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-white/40">
            attendees
          </div>
          <div className="flex flex-wrap gap-1.5">
            {realAgents.map((a) => {
              const isHead = head?.id === a.id;
              const on = picked.has(a.id);
              const rosterEntry = roster?.find((r) => r.agent.id === a.id);
              const busy = rosterEntry?.current?.runStatus === "running";
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => togglePick(a.id)}
                  disabled={isHead}
                  className={`rounded-sm border px-2 py-1 text-[11px] transition ${
                    on
                      ? "border-current text-zinc-100"
                      : "border-white/15 text-zinc-500 hover:text-zinc-300"
                  } ${isHead ? "cursor-default" : ""}`}
                  style={on ? { borderColor: accentColor, color: accentColor } : undefined}
                  title={isHead ? "head — always present" : a.role}
                >
                  {a.name}
                  {isHead && <span className="ml-1 opacity-60">(head)</span>}
                  {busy && !isHead && <span className="ml-1 opacity-60">·busy</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Prompt */}
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-white/40">
            prompt
          </div>
          <textarea
            className="h-24 w-full resize-none border border-white/10 bg-black/60 p-2 font-mono text-xs text-zinc-100 outline-none focus:border-white/30"
            placeholder="What's blocking us this week?"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            autoFocus
          />
        </div>

        {error && <div className="text-xs text-red-400">{error}</div>}

        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-white/40">
            {picked.size} agent{picked.size === 1 ? "" : "s"} · runs in parallel
          </span>
          <button
            type="button"
            onClick={convene}
            disabled={submitting || !prompt.trim() || picked.size === 0}
            className="border px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-40"
            style={{ borderColor: accentColor, color: accentColor }}
          >
            {submitting ? "convening…" : "convene"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-white/40">
        <span>
          meeting · {meeting.attendees.length} agents ·{" "}
          {new Date(meeting.convenedAt).toLocaleTimeString()}
        </span>
        <span style={{ color: meeting.status === "done" ? accentColor : "#fde047" }}>
          {meeting.status === "done" ? "all done" : "in progress"}
        </span>
      </div>

      <div className="grid flex-1 grid-cols-2 gap-px overflow-auto bg-white/5">
        {meeting.attendees.map((att) => {
          const meta = agentNameById.get(att.agentId);
          const statusColor =
            att.runStatus === "done"
              ? accentColor
              : att.runStatus === "error"
              ? "#f87171"
              : att.runStatus === "awaiting_input"
              ? "#fde047"
              : att.runStatus === "running"
              ? "#7dd3fc"
              : "#a1a1aa";
          return (
            <div key={att.agentId} className="flex flex-col gap-1.5 bg-zinc-950 p-2">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-sm text-zinc-100">{meta?.name ?? att.agentId}</div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                    {meta?.role ?? ""}
                  </div>
                </div>
                <span
                  className="border px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider"
                  style={{ color: statusColor, borderColor: statusColor + "66" }}
                >
                  {att.runStatus}
                </span>
              </div>
              <div className="min-h-[60px] flex-1 whitespace-pre-wrap text-[11px] leading-snug text-zinc-300">
                {att.tailSnippet ?? <span className="text-zinc-600">…waiting</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
