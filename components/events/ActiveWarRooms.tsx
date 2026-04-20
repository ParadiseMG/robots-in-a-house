"use client";

import { useState } from "react";
import { useVisibleInterval } from "@/hooks/useVisibleInterval";

type AgentStatus = { agentId: string; status: string };

type WarRoomSummary = {
  meetingId: string;
  officeSlug: string;
  convenedBy: string;
  prompt: string;
  convenedAt: number;
  status: "running" | "done";
  attendeeCount: number;
  agentStatuses: AgentStatus[];
};

type Props = {
  agentNames: ReadonlyMap<string, string>;
  officeNames: ReadonlyMap<string, string>;
  officeAccents: ReadonlyMap<string, string>;
  onOpen: (officeSlug: string, meetingId: string) => void;
};

const POLL_MS = 3000;

function statusDot(status: string): string {
  if (status === "running" || status === "starting") return "#7dd3fc";
  if (status === "awaiting_input") return "#fde047";
  if (status === "done") return "#34d399";
  if (status === "error") return "#f87171";
  return "#71717a";
}

export default function ActiveWarRooms({ agentNames, officeNames, officeAccents, onOpen }: Props) {
  const [meetings, setMeetings] = useState<WarRoomSummary[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useVisibleInterval(() => {
    fetch("/api/war-room?status=recent")
      .then((r) => r.ok ? r.json() as Promise<{ meetings: WarRoomSummary[] }> : null)
      .then((j) => { if (j) setMeetings(j.meetings); })
      .catch(() => {});
  }, POLL_MS);

  if (meetings.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="group flex items-center gap-1 px-2 font-mono text-[9px] uppercase tracking-widest text-white/30 hover:text-white/50 transition-colors"
      >
        <span
          className="inline-block transition-transform duration-200"
          style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
        >
          &#9662;
        </span>
        war rooms
        {collapsed && (
          <span className="ml-1 tabular-nums text-white/20">({meetings.length})</span>
        )}
      </button>
      {!collapsed && meetings.map((m) => {
        const accent = officeAccents.get(m.officeSlug) ?? "#10b981";
        const officeName = officeNames.get(m.officeSlug) ?? m.officeSlug;
        const isActive = m.status === "running";

        return (
          <button
            key={m.meetingId}
            type="button"
            onClick={() => onOpen(m.officeSlug, m.meetingId)}
            className="group flex flex-col gap-1 rounded border border-white/8 bg-white/[0.02] px-2.5 py-2 text-left transition hover:bg-white/[0.06]"
          >
            <div className="flex items-center gap-1.5">
              {isActive && (
                <span
                  className="inline-block h-1.5 w-1.5 animate-pulse rounded-full"
                  style={{ backgroundColor: accent }}
                />
              )}
              <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: accent }}>
                {officeName}
              </span>
              <span className="ml-auto font-mono text-[9px] text-white/25">
                {new Date(m.convenedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <div className="text-[11px] leading-tight text-white/60 group-hover:text-white/80">
              {m.prompt}
            </div>
            <div className="flex items-center gap-1.5">
              {m.agentStatuses.map((a) => (
                <span key={a.agentId} className="flex items-center gap-0.5">
                  <span
                    className="inline-block h-1 w-1 rounded-full"
                    style={{ backgroundColor: statusDot(a.status) }}
                  />
                  <span className="font-mono text-[9px] text-white/35">
                    {agentNames.get(a.agentId) ?? a.agentId}
                  </span>
                </span>
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}
