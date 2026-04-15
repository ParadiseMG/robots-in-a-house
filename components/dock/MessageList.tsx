"use client";

import { useEffect, useRef } from "react";
import ToolCallLine from "@/components/dock/ToolCallLine";

export type ChatMessage = {
  role: "user" | "assistant";
  ts: number;
  text: string;
  runId?: string;
};

type LiveTool = { name: string; id: string };

type Props = {
  messages: ChatMessage[] | null;
  liveText: string;
  liveTools: LiveTool[];
  liveStatus: string | null;
  isLive: boolean;
};

const fmt = (ts: number) => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export default function MessageList({
  messages,
  liveText,
  liveTools,
  liveStatus,
  isLive,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom when messages or live text change
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, liveText]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto space-y-2 p-2"
    >
      {messages === null ? (
        <div className="text-center text-xs text-white/30 pt-8">loading…</div>
      ) : messages.length === 0 && !isLive ? (
        <div className="text-center text-xs text-white/30 pt-8">
          no messages yet
        </div>
      ) : (
        <>
          {messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === "user"
                  ? "ml-8 rounded-lg rounded-tr-sm bg-sky-400/15 p-2 text-xs text-sky-100"
                  : "mr-8 rounded-lg rounded-tl-sm bg-white/10 p-2 text-xs text-white/90"
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

          {/* Live tool calls */}
          {isLive && liveTools.length > 0 && (
            <div className="space-y-0.5 px-1">
              {liveTools.map((t) => (
                <ToolCallLine key={t.id} name={t.name} />
              ))}
            </div>
          )}

          {/* Live assistant text */}
          {isLive && liveText && (
            <div className="mr-8 rounded-lg rounded-tl-sm border border-amber-400/30 bg-amber-400/5 p-2 text-xs text-white/90">
              <div className="whitespace-pre-wrap font-mono leading-relaxed">
                {liveText}
              </div>
              <div className="mt-0.5 font-mono text-[9px] text-amber-300/60">
                typing…
              </div>
            </div>
          )}

          {/* Starting / thinking state */}
          {isLive && !liveText && (
            <div className="mr-8 rounded-lg rounded-tl-sm bg-white/5 p-2 text-xs text-white/40">
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
  );
}
