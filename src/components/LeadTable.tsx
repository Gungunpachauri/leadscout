"use client";

import { ArrowDown, ArrowUp, ChevronRight, Mail, Phone, RotateCw, UserRound } from "lucide-react";
import type { Lead, LeadScore } from "@/lib/types";
import { Monogram, ScoreRing, cx } from "./ui";

export type SortKey = "score" | "name" | "age";
export type Row = { lead: Lead; score: LeadScore | null };

const GRID = "grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,2.4fr)_minmax(0,1.1fr)_68px_minmax(0,1.5fr)_56px_20px] items-center gap-x-5";

function signalLine(l: Lead, nowYear: number) {
  const d = l.data!;
  const age = d.foundedYear ? nowYear - d.foundedYear : null;
  const s: string[] = [];
  if (d.signals.familyOwned) s.push("Family-owned");
  else if (d.signals.ownerOperated) s.push("Owner-run");
  if (age !== null && age >= 20 && (d.signals.familyOwned || d.signals.ownerOperated)) s.push("Long tenure");
  return s;
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
    <button onClick={() => onSort(k)} className={cx("inline-flex items-center gap-1 transition-colors hover:text-ink", sort.key === k && "text-ink", className)}>
      {children}
      {sort.key === k && (sort.dir === -1 ? <ArrowDown size={11} strokeWidth={2.5} /> : <ArrowUp size={11} strokeWidth={2.5} />)}
    </button>
  );

  return (
    <div>
      <div className={cx(GRID, "hidden border-b border-line px-4 pb-2.5 text-[12px] text-muted md:grid")}>
        <SortBtn k="name">Company</SortBtn>
        <span>Industry</span>
        <SortBtn k="age">Age</SortBtn>
        <span>Contact</span>
        <SortBtn k="score" className="justify-self-end">Score</SortBtn>
        <span />
      </div>

      <ul>
        {rows.map(({ lead: l, score }) => {
          const d = l.data;
          const name = d?.name ?? l.inputName ?? l.domain;
          const email = d?.emails.find((e) => e.status === "mx-ok");
          const age = d?.foundedYear ? nowYear - d.foundedYear : null;
          const signals = d ? signalLine(l, nowYear) : [];
          const interactive = Boolean(d);
          return (
            <li
              key={l.domain}
              onClick={() => interactive && onSelect(l.domain)}
              className={cx(
                GRID,
                "anim-fade group relative border-b border-line px-4 py-3.5 last:border-0",
                interactive && "cursor-pointer transition-colors hover:bg-hover/60",
                selected === l.domain && "bg-hover/60",
              )}
            >
              {/* Company */}
              <div className="flex min-w-0 items-center gap-3">
                <Monogram name={name} size={34} />
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-medium leading-5">{name}</div>
                  <div className="truncate text-[12.5px] leading-5 text-muted">
                    {l.domain}
                    {d?.location && <span className="hidden sm:inline"> · {d.location}</span>}
                    {signals.length > 0 && <span className="text-ink-2"> · {signals.join(" · ")}</span>}
                  </div>
                </div>
              </div>

              {/* Industry / Age / Contact: desktop only */}
              {d ? (
                <>
                  <div className="hidden truncate text-[13px] text-ink-2 md:block">
                    {d.industry ?? <span className="text-muted">Unknown</span>}
                    {d.industry && d.evidence.industry?.confidence === "low" && <span className="text-muted" title="Inferred from a few keywords"> ?</span>}
                  </div>
                  <div className="hidden text-[13px] tabular-nums text-ink-2 md:block">
                    {age !== null ? (
                      <span className="font-mono" title={d.evidence.foundedYear?.method === "inferred" ? "Estimated" : `Since ${d.foundedYear}`}>
                        {d.evidence.foundedYear?.method === "inferred" ? "~" : ""}{age}y
                      </span>
                    ) : <span className="text-muted">Unknown</span>}
                  </div>
                  <div className="hidden min-w-0 items-center gap-2.5 text-[13px] md:flex">
                    {email ? (
                      <span className="flex min-w-0 items-center gap-1.5 text-ink-2" title="Domain accepts mail (MX). Mailbox itself not verified.">
                        <Mail size={13} strokeWidth={1.75} className="shrink-0 text-tier-a" />
                        <span className="truncate">{email.address}</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-muted"><Mail size={13} strokeWidth={1.75} /> None</span>
                    )}
                    {d.phones.length > 0 && <Phone size={13} strokeWidth={1.75} className="shrink-0 text-muted" aria-label="Phone found" />}
                    {d.people.length > 0 && <UserRound size={13} strokeWidth={1.75} className="shrink-0 text-muted" aria-label="Decision-maker found" />}
                  </div>
                </>
              ) : (
                <>
                  <div className="hidden md:block"><div className="skeleton h-3 w-20 rounded" /></div>
                  <div className="hidden md:block"><div className="skeleton h-3 w-8 rounded" /></div>
                  <div className="hidden md:block">
                    {l.status === "error" ? (
                      <span className="truncate text-[13px] text-danger" title={l.error}>{l.error ?? "Failed"}</span>
                    ) : (
                      <div className="skeleton h-3 w-32 rounded" />
                    )}
                  </div>
                </>
              )}

              {/* Score */}
              <div className="justify-self-end">
                {score ? (
                  <ScoreRing score={score} size={34} />
                ) : l.status === "error" ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); onRetry(l.domain); }}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-line-strong px-2 text-[12px] text-ink-2 hover:bg-hover"
                    title={l.error}
                  >
                    <RotateCw size={12} /> Retry
                  </button>
                ) : (
                  <div className={cx("h-[34px] w-[34px] rounded-full border-[3px] border-line", l.status === "running" && "animate-spin border-t-ink")} />
                )}
              </div>

              <ChevronRight size={16} className={cx("hidden justify-self-end text-muted transition-all md:block", interactive ? "opacity-0 group-hover:translate-x-0.5 group-hover:opacity-100" : "opacity-0")} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
