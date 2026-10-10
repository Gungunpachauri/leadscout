"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LeadScore } from "@/lib/types";

export const TIER_COLOR: Record<LeadScore["tier"], string> = {
  A: "var(--a)",
  B: "var(--b)",
  C: "var(--c)",
  D: "var(--d)",
};

export const TIER_LABEL: Record<LeadScore["tier"], string> = {
  A: "Priority",
  B: "Strong",
  C: "Nurture",
  D: "Low fit",
};

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type BtnProps = {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  className?: string;
  title?: string;
  type?: "button" | "submit";
};

export function Button({ children, onClick, variant = "outline", size = "md", disabled, className, title, type = "button" }: BtnProps) {
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-all duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:pointer-events-none disabled:opacity-40",
        "active:scale-[0.98]",
        size === "sm" && "h-8 px-2.5 text-[13px]",
        size === "md" && "h-9 px-3.5 text-sm",
        size === "lg" && "h-11 px-5 text-[15px]",
        variant === "primary" && "bg-accent text-accent-ink hover:opacity-90",
        variant === "outline" && "border border-line-strong bg-surface text-ink hover:bg-hover",
        variant === "ghost" && "text-ink-2 hover:bg-hover hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-current/20 px-1 font-sans text-[10px] font-medium leading-4 opacity-60">
      {children}
    </kbd>
  );
}

export function ScoreRing({ score, size = 32, stroke = 3, showLabel = true }: { score: LeadScore; size?: number; stroke?: number; showLabel?: boolean }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} title={`${TIER_LABEL[score.tier]} · ${score.total}/100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={TIER_COLOR[score.tier]} strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={c * (1 - score.total / 100)} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(0.2,0.8,0.2,1)" }}
        />
      </svg>
      {showLabel && (
        <span className="absolute font-mono font-semibold tabular-nums" style={{ fontSize: size * 0.34 }}>
          {score.total}
        </span>
      )}
    </div>
  );
}

export function Monogram({ name, size = 32 }: { name: string; size?: number }) {
  const letter = (name.match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase();
  // Stable, muted hue per company so the list has rhythm without noise.
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-lg font-semibold"
      style={{
        width: size, height: size, fontSize: size * 0.42,
        background: `color-mix(in oklch, oklch(0.7 0.08 ${h}) 16%, var(--surface))`,
        color: `color-mix(in oklch, oklch(0.5 0.1 ${h}) 85%, var(--ink))`,
      }}
    >
      {letter}
    </div>
  );
}

export function TierDot({ tier }: { tier: LeadScore["tier"] }) {
  return <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: TIER_COLOR[tier] }} />;
}

export function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] transition-colors",
        on ? "border-ink bg-ink text-bg" : "border-line-strong text-ink-2 hover:bg-hover",
      )}
    >
      {children}
    </button>
  );
}

/** Minimal click-outside popover menu. */
export function Menu({ trigger, children, align = "right" }: { trigger: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger(open, () => setOpen((o) => !o))}
      {open && (
        <div className={cx("anim-rise absolute top-full z-30 mt-1.5 min-w-52 rounded-xl border border-line bg-surface p-1 shadow-float", align === "right" ? "right-0" : "left-0")}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onClick, hint, disabled }: { children: ReactNode; onClick: () => void; hint?: string; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-hover disabled:opacity-40"
    >
      <span className="flex flex-1 items-center gap-2.5">{children}</span>
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </button>
  );
}

export function Sheet({ open, onClose, children, width = 520, label }: { open: boolean; onClose: () => void; children: ReactNode; width?: number; label: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40">
      <div className="anim-fade absolute inset-0 bg-black/20 backdrop-blur-[2px] dark:bg-black/50" onClick={onClose} />
      <aside
        role="dialog"
        aria-label={label}
        className="anim-slide absolute inset-y-0 right-0 flex w-full flex-col border-l border-line bg-surface shadow-float"
        style={{ maxWidth: width }}
      >
        {children}
      </aside>
    </div>
  );
}

export function Modal({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center px-4 pt-[12vh]">
      <div className="anim-fade absolute inset-0 bg-black/20 backdrop-blur-[2px] dark:bg-black/50" onClick={onClose} />
      <div role="dialog" aria-label={label} className="anim-rise relative w-full max-w-xl">
        {children}
      </div>
    </div>
  );
}
