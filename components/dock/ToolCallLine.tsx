"use client";

import { useEffect, useState } from "react";

type Props = {
  name: string;
  /** If undefined, the call is still in-flight (animated). If string, it resolved. */
  result?: string;
};

export default function ToolCallLine({ name, result }: Props) {
  const [dots, setDots] = useState("…");

  useEffect(() => {
    if (result !== undefined) return; // resolved — no animation needed
    let i = 0;
    const frames = ["…", "..", "."];
    const id = setInterval(() => {
      i = (i + 1) % frames.length;
      setDots(frames[i]);
    }, 400);
    return () => clearInterval(id);
  }, [result]);

  if (result !== undefined) {
    return (
      <div className="flex items-center gap-1.5 rounded bg-white/5 px-2 py-0.5 font-mono text-[10px] text-white/40">
        <span className="text-emerald-400/60">↳</span>
        <span className="truncate">{name}</span>
        <span className="ml-auto shrink-0 text-white/25">done</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 rounded border border-amber-400/20 bg-amber-400/5 px-2 py-0.5 font-mono text-[10px] text-amber-300/70">
      <span className="text-amber-400/60">↳</span>
      <span className="truncate">{name}{dots}</span>
    </div>
  );
}
