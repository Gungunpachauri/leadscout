"use client";

import type { Lead, LeadScore } from "@/lib/types";
import { Chip, ScoreBar } from "./ui";

export type SortKey = "score" | "name" | "age";
export type Row = { lead: Lead; score: LeadScore | null };

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
  const header = (k: SortKey, label: string, className = "") => (
    <th className={`px-3 py-2 font-medium ${className}`}>
      <button onClick={() => onSort(k)} className="inline-flex items-center gap-1 hover:text-ink">
        {label}
        <span className="text-[10px]">{sort.key === k ? (sort.dir === -1 ? "▼" : "▲") : ""}</span>
      </button>
    </th>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-line text-xs text-muted">
          <tr>
            {header("name", "Company", "pl-4")}
            {header("score", "Score")}
            <th className="px-3 py-2 font-medium">Industry</th>
            {header("age", "Age")}
            <th className="px-3 py-2 font-medium">Best contact</th>
            <th className="px-3 py-2 pr-4 font-medium">Signals</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ lead: l, score }) => {
            const d = l.data;
            const email = d?.emails.find((e) => e.status === "deliverable-domain") ?? d?.emails[0];
            const age = d?.foundedYear ? nowYear - d.foundedYear : null;
            return (
              <tr
                key={l.domain}
                onClick={() => d && onSelect(l.domain)}
                className={`border-b border-line last:border-0 ${d ? "cursor-pointer hover:bg-panel-2" : ""} ${selected === l.domain ? "bg-panel-2" : ""}`}
              >
                <td className="max-w-[240px] px-3 py-2.5 pl-4">
                  <div className="truncate font-medium">{d?.name ?? l.inputName ?? l.domain}</div>
                  <div className="truncate text-xs text-muted">
                    {l.domain}
                    {d?.location ? ` · ${d.location}` : ""}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  {score ? (
                    <ScoreBar score={score} />
                  ) : l.status === "error" ? (
                    <span className="flex items-center gap-2 text-xs text-danger" title={l.error}>
                      Failed
                      <button
                        className="rounded border border-line px-1.5 py-0.5 text-muted hover:text-ink"
                        onClick={(e) => { e.stopPropagation(); onRetry(l.domain); }}
                      >
                        Retry
                      </button>
                    </span>
                  ) : (
                    <span className="flex items-center gap-2 text-xs text-muted">
                      <span className={`h-2 w-2 rounded-full ${l.status === "running" ? "animate-pulse bg-accent" : "bg-line"}`} />
                      {l.status === "running" ? "Enriching…" : "Queued"}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-muted">{d?.industry ?? (d ? "-" : "")}</td>
                <td className="px-3 py-2.5 tabular-nums text-muted">{age !== null ? `${age} yrs` : d ? "-" : ""}</td>
                <td className="max-w-[220px] px-3 py-2.5">
                  {d && (
                    <div className="truncate text-xs">
                      {email ? (
                        <span title={email.status === "deliverable-domain" ? "Domain accepts mail (MX verified)" : "Domain has no MX records"}>
                          <span className={email.status === "deliverable-domain" ? "text-tier-a" : "text-danger"}>●</span> {email.address}
                        </span>
                      ) : (
                        <span className="text-muted">No email</span>
                      )}
                      {d.phones[0] && <div className="text-muted">{d.phones[0].display}</div>}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5 pr-4">
                  {d && (
                    <div className="flex flex-wrap gap-1">
                      {d.signals.familyOwned && <Chip tone="accent">Family</Chip>}
                      {!d.signals.familyOwned && d.signals.ownerOperated && <Chip tone="accent">Owner-run</Chip>}
                      {age !== null && age >= 20 && (d.signals.familyOwned || d.signals.ownerOperated) && <Chip tone="warn">Succession</Chip>}
                      {d.people[0] && <Chip title={d.people[0].name}>DM found</Chip>}
                      {l.ai && <Chip tone="accent">AI {l.ai.fitRating}/10</Chip>}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
