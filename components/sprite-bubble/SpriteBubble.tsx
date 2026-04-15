"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

type Props = {
  x: number;
  y: number;
  mode: "task" | "reply";
  containerRef: RefObject<HTMLDivElement | null>;
  onSubmit: (text: string) => void | Promise<void>;
  onDismiss: () => void;
};

export default function SpriteBubble({
  x,
  y,
  mode,
  containerRef,
  onSubmit,
  onDismiss,
}: Props) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Position bubble relative to container using client coords from Pixi
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setPos({ left: x - rect.left, top: y - rect.top });
  }, [x, y, containerRef]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (bubbleRef.current && !bubbleRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    // Delay click-outside by a frame so the opening click doesn't close it
    const t = window.setTimeout(() => {
      window.addEventListener("mousedown", onClick);
    }, 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
      window.removeEventListener("mousedown", onClick);
    };
  }, [onDismiss]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setSubmitting(false);
    }
  };

  if (!pos) return null;

  const placeholder = mode === "task" ? "give a task…" : "reply…";
  const label = mode === "task" ? "send" : "reply";

  return (
    <div
      ref={bubbleRef}
      className="absolute z-50"
      style={{
        left: pos.left,
        top: pos.top,
        transform: "translate(-50%, -100%)",
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-1 rounded-md border border-white/20 bg-black/90 px-2 py-1.5 font-mono text-xs text-white shadow-lg backdrop-blur-sm"
      >
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          disabled={submitting}
          className="w-48 bg-transparent outline-none placeholder:text-white/40 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={submitting || !text.trim()}
          className="rounded border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-wide hover:bg-white/10 disabled:opacity-40"
        >
          {submitting ? "…" : label}
        </button>
      </form>
      <div
        className="mx-auto h-0 w-0"
        style={{
          borderLeft: "6px solid transparent",
          borderRight: "6px solid transparent",
          borderTop: "6px solid rgba(0, 0, 0, 0.9)",
        }}
      />
    </div>
  );
}
