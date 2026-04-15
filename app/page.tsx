"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import paradiseRaw from "@/config/paradise.office.json";
import dontcallRaw from "@/config/dontcall.office.json";
import type { OfficeConfig, IndicatorKind } from "@/lib/office-types";
import Office from "@/components/pixi/Office";
import type { Task } from "@/components/tray/TaskTray";
import RosterTray, { type RosterEntry } from "@/components/roster/RosterTray";
import AgentInspector from "@/components/inspector/AgentInspector";
import PromptBar from "@/components/prompt-bar/PromptBar";
import CommandPalette from "@/components/palette/CommandPalette";
import UsageTracker from "@/components/usage/UsageTracker";
import SpriteBubble from "@/components/sprite-bubble/SpriteBubble";

const officesStatic: Record<string, OfficeConfig> = {
  paradise: paradiseRaw as OfficeConfig,
  dontcall: dontcallRaw as OfficeConfig,
};
const order = ["paradise", "dontcall"] as const;
type OfficeSlug = (typeof order)[number];

const ROSTER_POLL_MS = 5_000;

export default function Home() {
  const [slug, setSlug] = useState<OfficeSlug>("paradise");
  // office: the static config for the current slug.
  // Desk positions are mutated in-place by the PixiJS drag handler (via onAgentMove →
  // in-canvas mutation of officesStatic[slug].desks entries) so they persist for the
  // session without remounting the canvas. The API writes to disk for next-reload persistence.
  const office: OfficeConfig = officesStatic[slug];
  const other: OfficeSlug = slug === "paradise" ? "dontcall" : "paradise";

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [selectedDeskId, setSelectedDeskId] = useState<string | null>(null);
  const [inspectorBump, setInspectorBump] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [showGrid, setShowGrid] = useState(false);

  const [rosterEntries, setRosterEntries] = useState<RosterEntry[] | null>(null);
  const [bubble, setBubble] = useState<{
    deskId: string;
    x: number;
    y: number;
    mode: "task" | "reply";
    runId?: string | null;
  } | null>(null);

  // Restore slug + desk selection from localStorage on mount
  useEffect(() => {
    const storedSlug = localStorage.getItem("ri-office") as OfficeSlug | null;
    if (storedSlug === "paradise" || storedSlug === "dontcall") {
      setSlug(storedSlug);
      const storedDesk = localStorage.getItem(`ri-desk-${storedSlug}`);
      if (storedDesk) setSelectedDeskId(storedDesk);
    }
    setHydrated(true);
  }, []);

  const selectOffice = useCallback((next: OfficeSlug) => {
    localStorage.setItem("ri-office", next);
    const storedDesk = localStorage.getItem(`ri-desk-${next}`);
    setSelectedDeskId(storedDesk ?? null);
    setSlug(next);
    setBubble(null);
  }, []);

  const selectDesk = useCallback(
    (deskId: string | null) => {
      setSelectedDeskId(deskId);
      if (deskId) localStorage.setItem(`ri-desk-${slug}`, deskId);
      else localStorage.removeItem(`ri-desk-${slug}`);
    },
    [slug],
  );

  // Toggle grid overlay with G key (case-insensitive, ignore when typing in input/textarea)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "g") return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      setShowGrid((prev) => !prev);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Fetch tasks whenever office changes
  useEffect(() => {
    let alive = true;
    setLoadingTasks(true);
    (async () => {
      const tRes = await fetch(`/api/tasks?office=${slug}`).then((r) => r.json());
      if (!alive) return;
      setTasks(
        (tRes.tasks ?? []).map((t: { id: string; title: string; body: string }) => ({
          id: t.id,
          title: t.title,
          body: t.body,
        })),
      );
      setLoadingTasks(false);
    })();
    return () => {
      alive = false;
    };
  }, [slug]);

  // Poll roster — single shared source for RosterTray + Office indicators
  const refetchRoster = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/roster?office=${encodeURIComponent(slug)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const json = (await res.json()) as { entries: RosterEntry[] };
      setRosterEntries(json.entries);
    } catch {
      // ignore
    }
  }, [slug]);

  useEffect(() => {
    setRosterEntries(null);
    let cancelled = false;
    void (async () => {
      await refetchRoster();
      if (cancelled) return;
    })();
    const id = setInterval(refetchRoster, ROSTER_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [slug, refetchRoster, inspectorBump]);

  // Derived state from roster entries
  const busyDeskIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of rosterEntries ?? []) {
      const st = e.current?.runStatus;
      if (st === "running" || st === "starting" || st === "awaiting_input") {
        s.add(e.agent.deskId);
      }
    }
    return s;
  }, [rosterEntries]);

  const agentStatus = useMemo(() => {
    const m = new Map<string, IndicatorKind>();
    for (const e of rosterEntries ?? []) {
      const c = e.current;
      if (!c) continue;
      if (c.runStatus === "awaiting_input") {
        m.set(e.agent.deskId, "awaiting_input");
      } else if (c.runStatus === "done" && !c.acknowledgedAt) {
        m.set(e.agent.deskId, "done_unacked");
      }
    }
    return m;
  }, [rosterEntries]);

  const agentByDesk = useMemo(() => {
    const m = new Map<string, { id: string; isReal: boolean }>();
    for (const a of office.agents) m.set(a.deskId, { id: a.id, isReal: a.isReal });
    return m;
  }, [office]);

  const runByDesk = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const e of rosterEntries ?? []) {
      m.set(e.agent.deskId, e.current?.runId ?? null);
    }
    return m;
  }, [rosterEntries]);

  const handleAgentClick = useCallback(
    (deskId: string, clientX: number, clientY: number) => {
      const kind = agentStatus.get(deskId);
      if (kind === "awaiting_input") {
        selectDesk(deskId);
        setBubble({
          deskId,
          x: clientX,
          y: clientY,
          mode: "reply",
          runId: runByDesk.get(deskId) ?? null,
        });
        return;
      }
      if (kind === "done_unacked") {
        // Opening the inspector triggers auto-ack inside the inspector component.
        selectDesk(deskId);
        setBubble(null);
        return;
      }
      // No indicator — open task bubble and pull agent into inspector
      const agent = agentByDesk.get(deskId);
      if (!agent) return;
      selectDesk(deskId);
      setBubble({ deskId, x: clientX, y: clientY, mode: "task" });
    },
    [agentStatus, agentByDesk, runByDesk, selectDesk],
  );

  const handleDeskDrop = useCallback(
    async (deskId: string, e: React.DragEvent<HTMLDivElement>) => {
      const taskId = e.dataTransfer.getData("application/x-robot-task");
      if (!taskId) return;
      const agent = agentByDesk.get(deskId);
      if (!agent) return;

      const droppedTask = tasks.find((t) => t.id === taskId);

      setTasks((prev) => prev.filter((t) => t.id !== taskId));

      const res = await fetch("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, agentId: agent.id, officeSlug: slug }),
      });
      if (!res.ok) {
        // Failed — refresh tasks; roster will self-refresh via poll
        const tRes = await fetch(`/api/tasks?office=${slug}`).then((r) => r.json());
        setTasks(tRes.tasks ?? []);
        return;
      }

      const { assignment } = (await res.json()) as {
        assignment: { id: string };
      };

      if (agent.isReal && droppedTask) {
        const prompt = droppedTask.body
          ? `${droppedTask.title}\n\n${droppedTask.body}`
          : droppedTask.title;
        await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assignmentId: assignment.id,
            agentId: agent.id,
            officeSlug: slug,
            prompt,
          }),
        }).catch(() => {});
      }

      void refetchRoster();
      if (selectedDeskId === deskId) {
        setInspectorBump((n) => n + 1);
      }
    },
    [agentByDesk, slug, selectedDeskId, tasks, refetchRoster],
  );

  const submitBubble = useCallback(
    async (text: string) => {
      if (!bubble) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      if (bubble.mode === "reply" && bubble.runId) {
        await fetch(`/api/runs/${encodeURIComponent(bubble.runId)}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reply: trimmed }),
        }).catch(() => {});
        setBubble(null);
        void refetchRoster();
        if (selectedDeskId === bubble.deskId) setInspectorBump((n) => n + 1);
      } else if (bubble.mode === "task") {
        const agent = agentByDesk.get(bubble.deskId);
        if (!agent) return;
        await fetch("/api/quick-run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            officeSlug: slug,
            agentId: agent.id,
            prompt: trimmed,
          }),
        }).catch(() => {});
        setBubble(null);
        if (agent.isReal) selectDesk(bubble.deskId);
        void refetchRoster();
        if (selectedDeskId === bubble.deskId) setInspectorBump((n) => n + 1);
      }
    },
    [bubble, slug, agentByDesk, selectedDeskId, selectDesk, refetchRoster],
  );

  // Agent drag-to-reposition handler.
  // The PixiJS canvas has already moved the sprite optimistically in-canvas.
  // We just POST to persist the change. On failure, log; sprite stays where dropped
  // (cosmetically fine for a design tool — next page reload reads the file from disk).
  const handleAgentMove = useCallback(
    async (deskId: string, gridX: number, gridY: number) => {
      try {
        const res = await fetch("/api/desks/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ officeSlug: slug, deskId, gridX, gridY }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          console.error("desk move failed:", err.error ?? res.status);
        }
      } catch (e) {
        console.error("desk move network error:", e);
      }
    },
    [slug],
  );

  const officeContainerRef = useRef<HTMLDivElement | null>(null);

  return (
    <div className="flex h-screen w-screen flex-col bg-black text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-sm">
        <div className="font-mono tracking-tight">robots-in-a-house</div>
        <div className="flex items-center gap-3">
          <div className="font-mono text-xs opacity-60">office: {office.name}</div>
          <button
            type="button"
            onClick={() => selectOffice(other)}
            className="rounded border border-white/20 px-2 py-0.5 font-mono text-xs hover:bg-white/10"
          >
            switch → {officesStatic[other].name}
          </button>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden">
          <main className="relative flex-1 overflow-hidden" ref={officeContainerRef}>
            <Office
              key={slug}
              office={office}
              busyDeskIds={busyDeskIds}
              agentStatus={agentStatus}
              selectedDeskId={selectedDeskId}
              onDeskSelect={selectDesk}
              onAgentClick={handleAgentClick}
              onDeskDrop={handleDeskDrop}
              onAgentMove={handleAgentMove}
              showGrid={showGrid}
            />
            {bubble && (
              <SpriteBubble
                key={`${bubble.deskId}:${bubble.mode}`}
                x={bubble.x}
                y={bubble.y}
                mode={bubble.mode}
                containerRef={officeContainerRef}
                onSubmit={submitBubble}
                onDismiss={() => setBubble(null)}
              />
            )}
          </main>
          <UsageTracker />
          <PromptBar
            agents={office.agents}
            officeSlug={slug}
            onSent={({ deskId, isReal }) => {
              if (isReal) selectDesk(deskId);
              void refetchRoster();
              if (selectedDeskId === deskId) setInspectorBump((n) => n + 1);
            }}
          />
        </div>
        {selectedDeskId ? (
          <AgentInspector
            key={`${slug}:${selectedDeskId}:${inspectorBump}`}
            officeSlug={slug}
            deskId={selectedDeskId}
            onClose={() => selectDesk(null)}
          />
        ) : (
          <RosterTray
            officeSlug={slug}
            entries={rosterEntries}
            onSelect={(deskId) => selectDesk(deskId)}
          />
        )}
      </div>
      <CommandPalette
        slug={slug}
        otherSlug={other}
        otherName={officesStatic[other].name}
        agents={office.agents}
        onSwitchOffice={() => selectOffice(other)}
        onFocusAgent={(deskId) => selectDesk(deskId)}
      />
    </div>
  );
}
