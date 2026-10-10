"use client";

import { ArrowDown, ArrowUp, Mail, Phone, RotateCw } from "lucide-react";
import type { KeyboardEvent } from "react";
import { SCORING } from "@/lib/score";
import { ENRICHMENT_VERSION, type Enrichment, type Lead, type LeadScore } from "@/lib/types";
import { Monogram, ScoreRing, TIER_LABEL, Tip, cx } from "./ui";

export type SortKey = "score" | "name" | "age";
export type Row = { lead: Lead; score: LeadScore | null };

// Mobile: company + score. md: + profile, age, contact. lg: + signals.
const GRID = cx(
  "grid items-center gap-x-4",
  "grid-cols-[minmax(0,1fr)_auto]",
  "md:grid-cols-[minmax(0,1.9fr)_minmax(0,1.2fr)_56px_minmax(0,1.6fr)_44px]",
  "lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1.15fr)_56px_minmax(0,1.25fr)_minmax(0,1.6fr)_44px]",
);

type Signal = { label: string; hint: string };

function signalsFor(d: Enrichment, nowYear: number): Signal[] {
  const out: Signal[] = [];
  const age = d.foundedYear ? nowYear - d.foundedYear : null;
  const own = d.evidence.familyOwned ?? d.evidence.ownerOperated;
  const how = own?.method === "inferred" ? "Inferred" : "Stated on site";
  if (d.signals.familyOwned) out.push({ label: "Family-owned", hint: `${how}: “${own?.snippet ?? ""}”` });
  else if (d.signals.ownerOperated) out.push({ label: "Owner-run", hint: `${how}: “${own?.snippet ?? ""}”` });
  if (age !== null && age >= SCORING.fit.longTenureYears && own) out.push({ label: "Long tenure", hint: `${age} years under this ownership type. Not evidence of a sale.` });
  if (d.people[0]) out.push({ label: "Owner named", hint: `${d.people[0].name} · ${d.people[0].title}` });
  return out;
}

function SignalBadges({ signals }: { signals: Signal[] }) {
  if (!signals.length) return <span className="text-[12.5px] text-muted">None found</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {signals.map((s) => (
        <span key={s.label} title={s.hint} className="whitespace-nowrap rounded-md bg-subtle px-1.5 py-0.5 text-[11.5px] leading-4 text-ink-2">
          {s.label}
        </span>
      ))}
    </div>
  );
}

function ScoreTip({ score }: { score: LeadScore }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 font-medium">
        <span>{TIER_LABEL[score.tier]} · Tier {score.tier}</span>
        <span className="font-mono">{score.total}/100</span>
      </div>
      <div className="mt-1.5 space-y-0.5 opacity-80">
        {score.components.map((c) => (
          <div key={c.key} className="flex justify-between gap-4">
            <span>{c.label}</span>
            <span className="font-mono">{c.points}/{c.max}</span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 border-t border-bg/20 pt-1.5 opacity-60">Open the row for evidence and next steps.</div>
    </div>
  );
}

export function LeadTable({
  rows, sort, onSort, onSelect, selected, onRetry,
}: {
  rows: Row[];
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (k: SortKey) => void;
  onSelect: (domain: string) => void;
  selected: string | null;
  onRetry: (domain: string) => void;
}) {
  const nowYear = new Date().getFullYear();
  const SortBtn = ({ k, children, className }: { k: SortKey; children: string; className?: string }) => (
    <button
      onClick={() => onSort(k)}
      aria-label={`Sort by ${children}${sort.key === k ? (sort.dir === -1 ? ", descending" : ", ascending") : ""}`}
      className={cx("inline-flex items-center gap-1 rounded transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-ink", sort.key === k && "text-ink", className)}
    >
      {children}
      {sort.key === k && (sort.dir === -1 ? <ArrowDown size={11} strokeWidth={2.5} /> : <ArrowUp size={11} strokeWidth={2.5} />)}
    </button>
  );

  const onRowKey = (e: KeyboardEvent<HTMLLIElement>, domain: string) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(domain); }
  };

  return (
    <div>
      <div className={cx(GRID, "hidden border-b border-line px-4 pb-2.5 text-[12px] text-muted md:grid")}>
        <SortBtn k="name">Company</SortBtn>
        <span>Industry · Location</span>
        <SortBtn k="age">Age</SortBtn>
        <span className="hidden lg:block">Signals</span>
        <span>Contact</span>
        <SortBtn k="score" className="justify-self-end">Score</SortBtn>
      </div>

      <ul aria-label="Leads">
        {rows.map(({ lead: l, score }) => {
          // Treat data from an older schema as not-yet-enriched (it is re-queued on load).
          const d = l.data?.version === ENRICHMENT_VERSION ? l.data : undefined;
          const name = d?.name ?? l.inputName ?? l.domain;
          const email = d?.emails.find((e) => e.status === "mx-ok") ?? d?.emails[0];
          const age = d?.foundedYear ? nowYear - d.foundedYear : null;
          const ageInferred = d?.evidence.foundedYear?.method === "inferred";
          const signals = d ? signalsFor(d, nowYear) : [];
          const interactive = Boolean(d);
          return (
            <li
              key={l.domain}
              tabIndex={interactive ? 0 : -1}
              role={interactive ? "button" : undefined}
              aria-label={interactive && score ? `${name}, score ${score.total}, tier ${score.tier}. Open details.` : undefined}
              onClick={() => interactive && onSelect(l.domain)}
              onKeyDown={(e) => interactive && onRowKey(e, l.domain)}
              className={cx(
                GRID,
                "group relative border-b border-line px-4 py-3 last:rounded-b-2xl last:border-0 outline-none",
                interactive && "cursor-pointer transition-colors hover:bg-hover/60 focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink/30",
                selected === l.domain && "bg-hover/60",
              )}
            >
              {/* Company */}
              <div className="flex min-w-0 items-center gap-3">
                <Monogram name={name} size={34} />
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-medium leading-5" title={name}>{name}</div>
                  {name !== l.domain && <div className="truncate text-[12.5px] leading-5 text-muted" title={l.domain}>{l.domain}</div>}
                  {/* Below lg, signals and contact live under the name so nothing is hidden. */}
                  {d && (
                    <div className="mt-1 space-y-1 lg:hidden">
                      {signals.length > 0 && <SignalBadges signals={signals} />}
                      <div className="flex min-w-0 items-center gap-3 text-[12px] text-muted md:hidden">
                        <span className="flex min-w-0 items-center gap-1">
                          <Mail size={12} className={cx("shrink-0", email?.status === "mx-ok" ? "text-tier-a" : "")} />
                          <span className="truncate">{email?.address ?? "Unknown"}</span>
                        </span>
                        {d.phones[0] && <span className="flex shrink-0 items-center gap-1"><Phone size={12} />{d.phones[0].display}</span>}
                      </div>
                    </div>
                  )}
                  {l.status === "error" && <div className="mt-0.5 text-[12px] text-danger md:hidden">{l.error}</div>}
                </div>
              </div>

              {d ? (
                <>
                  {/* Industry · Location */}
                  <div className="hidden min-w-0 md:block">
                    <div className="truncate text-[13px] text-ink-2" title={d.evidence.industry ? `${d.industry} (${d.evidence.industry.method}, ${d.evidence.industry.confidence} confidence)` : "Industry unknown"}>
                      {d.industry ?? <span className="text-muted">Unknown</span>}
                      {d.industry && d.evidence.industry?.confidence === "low" && <span className="text-muted"> ?</span>}
                    </div>
                    <div className="truncate text-[12.5px] text-muted" title={d.location ?? "Location unknown"}>{d.location ?? "Unknown"}</div>
                  </div>

                  {/* Age */}
                  <div className="hidden text-[13px] tabular-nums text-ink-2 md:block" title={age !== null ? (ageInferred ? `Estimated (≈ since ${d.foundedYear})` : `Since ${d.foundedYear}`) : "Founding year unknown"}>
                    {age !== null ? <span className="font-mono">{ageInferred ? "~" : ""}{age}y</span> : <span className="text-muted">Unknown</span>}
                  </div>

                  {/* Signals (lg+) */}
                  <div className="hidden min-w-0 lg:block"><SignalBadges signals={signals} /></div>

                  {/* Contact */}
                  <div className="hidden min-w-0 text-[13px] md:block">
                    <div className="flex min-w-0 items-center gap-1.5 text-ink-2" title={email ? `${email.address}: ${email.status === "mx-ok" ? "domain accepts mail (MX); mailbox not verified" : "domain has no mail servers"}${email.isRole ? "; role inbox" : ""}` : "No email found"}>
                      <Mail size={13} strokeWidth={1.75} className={cx("shrink-0", email?.status === "mx-ok" ? "text-tier-a" : email ? "text-danger" : "text-muted")} />
                      <span className={cx("truncate", !email && "text-muted")}>{email?.address ?? "Unknown"}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[12.5px] text-muted">
                      <Phone size={12} strokeWidth={1.75} className="shrink-0" />
                      <span className="truncate">{d.phones[0]?.display ?? "Unknown"}{d.phones.length > 1 ? ` +${d.phones.length - 1}` : ""}</span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="hidden md:block"><div className="skeleton h-3 w-24 rounded" /><div className="skeleton mt-2 h-2.5 w-16 rounded" /></div>
                  <div className="hidden md:block"><div className="skeleton h-3 w-8 rounded" /></div>
                  <div className="hidden lg:block"><div className="skeleton h-4 w-20 rounded" /></div>
                  <div className="hidden min-w-0 md:block">
                    {l.status === "error" ? (
                      <span className="line-clamp-2 text-[12.5px] text-danger">{l.error ?? "Failed"}</span>
                    ) : (
                      <><div className="skeleton h-3 w-32 rounded" /><div className="skeleton mt-2 h-2.5 w-20 rounded" /></>
                    )}
                  </div>
                </>
              )}

              {/* Score */}
              <div className="justify-self-end">
                {score ? (
                  <Tip content={<ScoreTip score={score} />} align="right" side="top" parentFocus>
                    <span className="inline-flex items-center gap-2">
                      <ScoreRing score={score} size={34} />
                      <span className="sr-only">{TIER_LABEL[score.tier]}</span>
                    </span>
                  </Tip>
                ) : l.status === "error" ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); onRetry(l.domain); }}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-line-strong px-2 text-[12px] text-ink-2 hover:bg-hover focus-visible:outline-2 focus-visible:outline-ink"
                    aria-label={`Retry ${l.domain}`}
                  >
                    <RotateCw size={12} /> Retry
                  </button>
                ) : (
                  <div
                    role="status"
                    aria-label={l.status === "running" ? `Enriching ${l.domain}` : `${l.domain} queued`}
                    className={cx("h-[34px] w-[34px] rounded-full border-[3px] border-line", l.status === "running" && "animate-spin border-t-ink")}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
