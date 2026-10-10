import type { ReactNode } from "react";
import type { LeadScore } from "@/lib/types";

export const TIER_COLOR: Record<LeadScore["tier"], string> = {
  A: "var(--tier-a)",
  B: "var(--tier-b)",
  C: "var(--tier-c)",
  D: "var(--tier-d)",
};

export const TIER_LABEL: Record<LeadScore["tier"], string> = {
  A: "Priority",
  B: "Strong",
  C: "Nurture",
  D: "Low fit",
};

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-panel ${className}`}>{children}</section>;
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

export function TierPill({ tier }: { tier: LeadScore["tier"] }) {
  return (
    <span
      className="inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[11px] font-bold text-white"
      style={{ background: TIER_COLOR[tier] }}
      title={TIER_LABEL[tier]}
    >
      {tier}
    </span>
  );
}

export function ScoreBar({ score }: { score: LeadScore }) {
  return (
    <div className="flex items-center gap-2">
      <TierPill tier={score.tier} />
      <span className="w-7 text-right font-mono text-sm font-semibold tabular-nums">{score.total}</span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-panel-2">
        <div className="h-full rounded-full" style={{ width: `${score.total}%`, background: TIER_COLOR[score.tier] }} />
      </div>
    </div>
  );
}

export function ScoreRing({ score, size = 76 }: { score: LeadScore; size?: number }) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--panel-2)" strokeWidth={8} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={TIER_COLOR[score.tier]} strokeWidth={8}
          strokeDasharray={c} strokeDashoffset={c * (1 - score.total / 100)} strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold tabular-nums leading-none">{score.total}</span>
        <span className="mt-0.5 text-[10px] font-medium uppercase text-muted">Tier {score.tier}</span>
      </div>
    </div>
  );
}

export function Chip({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "accent" | "warn"; title?: string }) {
  const cls =
    tone === "accent"
      ? "bg-accent-soft text-accent"
      : tone === "warn"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
        : "bg-panel-2 text-muted";
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {children}
    </span>
  );
}

export function Button({
  children, onClick, variant = "secondary", disabled, className = "", title, type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  className?: string;
  title?: string;
  type?: "button" | "submit";
}) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  const styles = {
    primary: "bg-accent text-white hover:brightness-110 dark:text-black",
    secondary: "border border-line bg-panel hover:bg-panel-2",
    ghost: "hover:bg-panel-2 text-muted hover:text-ink",
  }[variant];
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled} className={`${base} ${styles} ${className}`}>
      {children}
    </button>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <Card className="px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </Card>
  );
}
