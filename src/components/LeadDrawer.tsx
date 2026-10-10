"use client";

import { useEffect, useState } from "react";
import { templateEmail } from "@/lib/export";
import type { IcpSettings, Lead, LeadScore } from "@/lib/types";
import { Button, Chip, ScoreRing, TIER_COLOR, TIER_LABEL } from "./ui";

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-panel-2 hover:text-ink"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }, () => {});
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line px-5 py-4">
      <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </div>
  );
}

export function LeadDrawer({
  lead, score, icp, sender, aiEnabled, onClose, onBrief, onRescrape,
}: {
  lead: Lead;
  score: LeadScore;
  icp: IcpSettings;
  sender: { name?: string; firm?: string };
  aiEnabled: boolean | null;
  onClose: () => void;
  onBrief: (domain: string, brief: Lead["ai"]) => void;
  onRescrape: (domain: string) => void;
}) {
  const d = lead.data!;
  const [briefState, setBriefState] = useState<{ loading: boolean; error?: string }>({ loading: false });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function generate() {
    setBriefState({ loading: true });
    try {
      const res = await fetch("/api/brief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: d, icp, sender }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      onBrief(lead.domain, json.brief);
      setBriefState({ loading: false });
    } catch (e) {
      setBriefState({ loading: false, error: (e as Error).message });
    }
  }

  const email = lead.ai?.email ?? templateEmail(lead, sender);
  const mailto = (() => {
    const to = d.emails.find((e) => e.status === "deliverable-domain")?.address ?? "";
    return `mailto:${to}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`;
  })();

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/30" onClick={onClose} />
      <aside
        role="dialog"
        aria-label={`${d.name} details`}
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[520px] flex-col overflow-y-auto border-l border-line bg-panel shadow-2xl"
      >
        <div className="flex items-start gap-4 px-5 pb-4 pt-5">
          <ScoreRing score={score} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{d.name}</h2>
            <a href={`https://${d.domain}`} target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">
              {d.domain} ↗
            </a>
            <div className="mt-1 text-xs text-muted">
              {[d.industry, d.location, d.foundedYear && `Founded ${d.foundedYear}`].filter(Boolean).join(" · ") || "Limited public info"}
            </div>
            <div className="mt-1.5 text-xs font-medium" style={{ color: TIER_COLOR[score.tier] }}>
              {TIER_LABEL[score.tier]} lead
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-xl leading-none text-muted hover:bg-panel-2 hover:text-ink">
            ×
          </button>
        </div>
        {d.description && <p className="px-5 pb-4 text-sm leading-relaxed text-muted">{d.description}</p>}

        <Block title="Why this score">
          <div className="space-y-3">
            {score.components.map((c) => (
              <div key={c.key}>
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{c.label}</span>
                  <span className="font-mono text-xs tabular-nums text-muted">{c.points}/{c.max}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(c.points / c.max) * 100}%` }} />
                </div>
                <ul className="mt-1.5 space-y-0.5 text-xs text-muted">
                  {c.reasons.map((r) => <li key={r}>• {r}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </Block>

        <Block title="Contacts">
          {d.emails.length === 0 && d.phones.length === 0 && d.people.length === 0 && (
            <p className="text-sm text-muted">No public contact details found.</p>
          )}
          <ul className="space-y-1.5 text-sm">
            {d.people.map((p) => (
              <li key={p.name} className="flex items-center justify-between gap-2">
                <span><span className="font-medium">{p.name}</span> <span className="text-muted">· {p.title}</span></span>
              </li>
            ))}
            {d.emails.map((e) => (
              <li key={e.address} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  <span className={e.status === "deliverable-domain" ? "text-tier-a" : "text-danger"}>●</span> {e.address}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {e.isRole ? <Chip>role inbox</Chip> : <Chip tone="accent">direct</Chip>}
                  {e.status !== "deliverable-domain" && <Chip tone="warn">no MX</Chip>}
                  <CopyButton text={e.address} />
                </span>
              </li>
            ))}
            {d.phones.map((p) => (
              <li key={p.e164} className="flex items-center justify-between">
                <a href={`tel:${p.e164}`} className="hover:underline">{p.display}</a>
                <CopyButton text={p.e164} />
              </li>
            ))}
          </ul>
          {Object.keys(d.socials).length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {Object.entries(d.socials).map(([k, v]) => (
                <a key={k} href={v} target="_blank" rel="noreferrer" className="rounded-full border border-line px-2 py-0.5 text-xs capitalize hover:bg-panel-2">
                  {k} ↗
                </a>
              ))}
            </div>
          )}
        </Block>

        <Block title="Signals & tech">
          <div className="flex flex-wrap gap-1.5">
            {d.signals.familyOwned && <Chip tone="accent">Family-owned</Chip>}
            {d.signals.ownerOperated && <Chip tone="accent">Owner-operated</Chip>}
            {d.signals.hiring && <Chip>Hiring</Chip>}
            {d.signals.ecommerce && <Chip>E-commerce</Chip>}
            {d.signals.onlineBooking && <Chip>Online booking</Chip>}
            {d.copyrightYear && <Chip>© {d.copyrightYear}</Chip>}
            {d.tech.map((t) => <Chip key={t}>{t}</Chip>)}
            {!d.tech.length && <Chip>No tracked tech detected</Chip>}
          </div>
        </Block>

        <Block title="Acquisition brief & outreach">
          {lead.ai ? (
            <div className="space-y-3 text-sm">
              <p className="leading-relaxed">{lead.ai.summary}</p>
              <div>
                <div className="text-xs font-semibold text-muted">Thesis · AI fit {lead.ai.fitRating}/10</div>
                <p className="mt-1 leading-relaxed">{lead.ai.acquisitionThesis}</p>
              </div>
              {lead.ai.risks.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-muted">Diligence questions</div>
                  <ul className="mt-1 space-y-0.5 text-muted">{lead.ai.risks.map((r) => <li key={r}>• {r}</li>)}</ul>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={generate} disabled={!aiEnabled || briefState.loading}>
                {briefState.loading ? "Writing brief…" : "Generate AI brief"}
              </Button>
              {aiEnabled === false && <span className="text-xs text-muted">Set ANTHROPIC_API_KEY to enable. A template email is shown below.</span>}
            </div>
          )}
          {briefState.error && <p className="mt-2 text-xs text-danger">{briefState.error}</p>}

          <div className="mt-4 rounded-lg border border-line bg-panel-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 truncate text-sm font-medium">{email.subject}</div>
              <div className="flex shrink-0 gap-1">
                <CopyButton text={`Subject: ${email.subject}\n\n${email.body}`} label="Copy email" />
                <a href={mailto} className="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-panel hover:text-ink">Open in mail</a>
              </div>
            </div>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-muted">{email.body}</pre>
            {!lead.ai && <div className="mt-2 text-[11px] text-muted">Template draft from scraped facts</div>}
          </div>
        </Block>

        <Block title="Sources">
          <ul className="space-y-0.5 text-xs text-muted">
            {d.pagesCrawled.map((u) => (
              <li key={u} className="truncate"><a href={u} target="_blank" rel="noreferrer" className="hover:underline">{u}</a></li>
            ))}
          </ul>
          {d.blockedByRobots.length > 0 && (
            <p className="mt-2 text-xs text-muted">Skipped per robots.txt: {d.blockedByRobots.join(", ")}</p>
          )}
          <div className="mt-3 flex items-center justify-between text-xs text-muted">
            <span>{lead.cached ? "From cache · " : ""}Scraped {new Date(d.scrapedAt).toLocaleString()}</span>
            <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => onRescrape(lead.domain)}>Re-scrape</Button>
          </div>
        </Block>
      </aside>
    </>
  );
}
