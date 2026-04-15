"use client";

import { useState } from "react";

type Props = {
  runId: string;
  question: string | null;
  onSubmitted?: () => void;
};

export default function AwaitingInputForm({ runId, question, onSubmitted }: Props) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setPending(true);
    try {
      await fetch(`/api/runs/${encodeURIComponent(runId)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: trimmed }),
      });
      setText("");
      onSubmitted?.();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="rounded border border-yellow-400/40 bg-yellow-400/10 p-2">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-yellow-200">
        <span className="rounded bg-yellow-400 px-1 font-bold text-black">!</span>
        awaiting input
      </div>
      {question && (
        <div className="mt-1.5 text-sm text-yellow-100">{question}</div>
      )}
      <form onSubmit={onSubmit} className="mt-2 flex gap-1">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="your reply…"
          disabled={pending}
          autoFocus
          className="flex-1 rounded border border-white/20 bg-black/60 px-2 py-1 font-mono text-xs outline-none focus:border-yellow-300/60 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || !text.trim()}
          className="rounded border border-yellow-400/40 bg-yellow-400/20 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-yellow-100 hover:bg-yellow-400/30 disabled:opacity-40"
        >
          {pending ? "…" : "send"}
        </button>
      </form>
    </div>
  );
}
