"use client";

export type RosterEntry = {
  agent: {
    id: string;
    deskId: string;
    name: string;
    role: string;
    isReal: boolean;
    model: string | null;
  };
  current: {
    assignmentId: string;
    assignedAt: number;
    task: { id: string; title: string; body: string };
    runId: string | null;
    runStatus: string | null;
    acknowledgedAt: number | null;
    inputQuestion: string | null;
  } | null;
};

type Props = {
  officeSlug: string;
  entries: RosterEntry[] | null;
  onSelect: (deskId: string) => void;
};

const modelLabel = (m: string | null) => {
  const s = (m ?? "").toLowerCase();
  if (s.includes("opus")) return "opus";
  if (s.includes("haiku")) return "haiku";
  if (s.includes("sonnet")) return "sonnet";
  return m ?? "sonnet";
};

export default function RosterTray({ entries, onSelect }: Props) {
  return (
    <aside className="flex h-full w-72 flex-col border-l border-white/10 bg-zinc-950">
      <div className="border-b border-white/10 px-4 py-2 font-mono text-xs uppercase tracking-wider text-white/60">
        roster · {entries?.length ?? "…"}
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {entries === null && (
          <div className="px-2 py-4 text-center text-xs text-white/40">loading…</div>
        )}
        {entries?.length === 0 && (
          <div className="px-2 py-4 text-center text-xs text-white/40">no agents</div>
        )}
        {entries
          ?.slice()
          .sort((a, b) => {
            const ad = a.agent.role.toLowerCase() === "director" ? 0 : 1;
            const bd = b.agent.role.toLowerCase() === "director" ? 0 : 1;
            return ad - bd;
          })
          .map(({ agent, current }) => {
          const status = current?.runStatus ?? null;
          const awaitingInput = status === "awaiting_input";
          const doneUnacked =
            status === "done" && current && current.acknowledgedAt == null;
          const statusTone =
            status === "running" || status === "starting"
              ? "bg-amber-400/20 text-amber-300"
              : awaitingInput
                ? "bg-yellow-400/25 text-yellow-200"
                : status === "done"
                  ? "bg-emerald-400/20 text-emerald-300"
                  : status === "error"
                    ? "bg-red-500/20 text-red-300"
                    : "bg-white/10 text-white/50";
          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => onSelect(agent.deskId)}
              className="w-full rounded border border-white/10 bg-black/40 p-2 text-left transition-colors hover:border-white/30 hover:bg-black/60"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  {awaitingInput && (
                    <span
                      title="awaiting input"
                      className="shrink-0 rounded bg-yellow-400 px-1 text-[10px] font-bold leading-4 text-black"
                    >
                      !
                    </span>
                  )}
                  {doneUnacked && (
                    <span
                      title="done — unacknowledged"
                      className="shrink-0 rounded bg-emerald-500 px-1 text-[10px] font-bold leading-4 text-black"
                    >
                      ✓
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white">
                      {agent.name}
                    </div>
                    <div className="truncate text-[11px] text-white/50">
                      {agent.role}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1 font-mono text-[9px] uppercase tracking-wider">
                  {agent.isReal ? (
                    <>
                      <span className="rounded bg-emerald-400/20 px-1 py-0.5 text-emerald-300">
                        real
                      </span>
                      <span
                        className={
                          modelLabel(agent.model) === "opus"
                            ? "rounded bg-purple-400/20 px-1 py-0.5 text-purple-300"
                            : "rounded bg-sky-400/15 px-1 py-0.5 text-sky-300"
                        }
                      >
                        {modelLabel(agent.model)}
                      </span>
                    </>
                  ) : (
                    <span className="rounded bg-white/10 px-1 py-0.5 text-white/50">
                      sim
                    </span>
                  )}
                </div>
              </div>
              {current ? (
                <div className="mt-1.5 flex items-start gap-1.5">
                  <span
                    className={`mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full ${
                      status === "running" || status === "starting"
                        ? "bg-amber-400 animate-pulse"
                        : awaitingInput
                          ? "bg-yellow-400 animate-pulse"
                          : status === "done"
                            ? "bg-emerald-400"
                            : status === "error"
                              ? "bg-red-400"
                              : "bg-white/30"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] text-white/80">
                      {current.task.title}
                    </div>
                    {awaitingInput && current.inputQuestion && (
                      <div className="mt-0.5 truncate text-[10px] italic text-yellow-200/80">
                        “{current.inputQuestion}”
                      </div>
                    )}
                    {status && (
                      <span
                        className={`mt-0.5 inline-block rounded px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider ${statusTone}`}
                      >
                        {status}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-white/30">
                  idle
                </div>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
