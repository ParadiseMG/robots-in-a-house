"use client";

export type Task = {
  id: string;
  title: string;
  body: string;
};

type Props = {
  tasks: Task[];
  loading?: boolean;
};

export default function TaskTray({ tasks, loading }: Props) {
  return (
    <aside className="flex h-full w-72 flex-col border-l border-white/10 bg-zinc-950">
      <div className="border-b border-white/10 px-4 py-2 font-mono text-xs uppercase tracking-wider text-white/60">
        tray · {loading ? "…" : tasks.length}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {tasks.length === 0 && !loading && (
          <div className="px-1 py-4 text-center text-xs text-white/40">no tasks</div>
        )}
        {tasks.map((t) => (
          <div
            key={t.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-robot-task", t.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            className="cursor-grab select-none rounded border border-white/15 bg-black/60 px-3 py-2 text-sm text-white/90 hover:border-white/30 active:cursor-grabbing"
          >
            <div className="font-medium">{t.title}</div>
            {t.body && <div className="mt-0.5 text-xs text-white/50">{t.body}</div>}
          </div>
        ))}
      </div>
    </aside>
  );
}
