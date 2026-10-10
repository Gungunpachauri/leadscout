"use client";

import { AlertTriangle, ArrowUpRight, Check, Copy, Info, Loader2, Mail, Phone, RotateCw, Sparkles, UserRound, X } from "lucide-react";
import { useState } from "react";
import { templateEmail } from "@/lib/export";
import { nextActions } from "@/lib/score";
import type { Evidence, IcpSettings, Lead, LeadScore } from "@/lib/types";
import { Button, Monogram, ScoreRing, Sheet, TIER_COLOR, TIER_LABEL, cx } from "./ui";

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  return {
    copied,
    copy: (key: string, text: string) =>
      navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 1200); }, () => {}),
  };
}

function Label({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 text-[12px] font-medium text-muted">{children}</h3>;
}

const METHOD_LABEL: Record<Evidence["method"], string> = {
  structured: "Structured data",
  stated: "Stated on site",
  inferred: "Inferred",
};

function EvidenceTag({ e }: { e: Evidence }) {
  const color = e.confidence === "high" ? "var(--a)" : e.confidence === "medium" ? "var(--b)" : "var(--c)";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-muted" title={`${e.confidence} confidence`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {METHOD_LABEL[e.method]}
    </span>
  );
}

function Fact({ label, value, evidence }: { label: string; value: string | null; evidence?: Evidence }) {
  const path = evidence ? evidence.source.replace(/^https?:\/\/[^/]+/, "") || "/" : "";
  return (
    <div className="grid grid-cols-[96px_1fr] gap-3 py-2.5">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <span className={cx("text-[13px]", value ? "text-ink" : "text-muted")}>{value ?? "Unknown"}</span>
          {evidence && <EvidenceTag e={evidence} />}
        </div>
        {evidence && (
          <p className="mt-1 line-clamp-2 text-[12px] leading-[18px] text-muted">
            <span className="italic">{evidence.snippet}</span>{" "}
            <a href={evidence.source} target="_blank" rel="noreferrer" className="whitespace-nowrap not-italic underline decoration-line-strong underline-offset-2 hover:text-ink">
              {path.length > 28 ? path.slice(0, 28) + "…" : path}
            </a>
          </p>
        )}
      </dd>
    </div>
  );
}

type Tab = "overview" | "outreach" | "sources";
const TABS: Tab[] = ["overview", "outreach", "sources"];

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
  const [tab, setTab] = useState<Tab>("overview");
  const [brief, setBrief] = useState<{ loading: boolean; error?: string }>({ loading: false });
  const { copied, copy } = useCopy();
  const actions = nextActions(d, score);
  const ev = d.evidence;

  async function generate() {
    setBrief({ loading: true });
    try {
      const res = await fetch("/api/brief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: d, icp, sender }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      onBrief(lead.domain, json.brief);
      setBrief({ loading: false });
    } catch (e) {
      setBrief({ loading: false, error: (e as Error).message });
    }
  }

  const email = lead.ai?.email ?? templateEmail(lead, sender);
  const to = d.emails.find((e) => e.status === "mx-ok")?.address ?? "";
  const mailto = `mailto:${to}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`;
  const age = d.foundedYear ? new Date().getFullYear() - d.foundedYear : null;
  const signals = [
    d.signals.hiring && "Hiring",
    d.signals.ecommerce && "E-commerce",
    d.signals.onlineBooking && "Online booking",
  ].filter(Boolean) as string[];

  // Provenance: only claims the scraper actually recorded evidence for.
  const claims: { label: string; value: string; evidence: Evidence }[] = [];
  if (ev.name) claims.push({ label: "Company name", value: d.name, evidence: ev.name });
  if (ev.foundedYear && d.foundedYear) claims.push({ label: "Founded", value: `${ev.foundedYear.method === "inferred" ? "≈" : ""}${d.foundedYear}`, evidence: ev.foundedYear });
  if (ev.familyOwned) claims.push({ label: "Ownership", value: "Family-owned", evidence: ev.familyOwned });
  if (ev.ownerOperated) claims.push({ label: "Ownership", value: "Owner-operated", evidence: ev.ownerOperated });
  for (const p of d.people) claims.push({ label: "Decision-maker", value: `${p.name} · ${p.title}`, evidence: p.evidence });
  if (ev.industry && d.industry) claims.push({ label: "Industry", value: d.industry, evidence: ev.industry });
  if (ev.location && d.location) claims.push({ label: "Location", value: d.location, evidence: ev.location });
  if (ev.description) claims.push({ label: "Description", value: "From the site's meta description", evidence: ev.description });

  const unknown = [
    !d.foundedYear && "founding year",
    !(ev.familyOwned ?? ev.ownerOperated) && "ownership",
    !d.people.length && "decision-maker",
    !d.industry && "industry",
    !d.location && "location",
    !d.emails.length && "email",
    !d.phones.length && "phone",
  ].filter(Boolean) as string[];

  const norm = (u: string) => u.replace(/\/$/, "");
  const pageUrls = [...new Set([...d.pagesCrawled, ...claims.map((c) => c.evidence.source)].map(norm))];
  const byPage = pageUrls.map((url) => ({
    url,
    items: claims.filter((c) => norm(c.evidence.source) === url),
    contacts: [
      ...d.emails.filter((e) => norm(e.source) === url).map((e) => e.address),
      ...d.phones.filter((p) => norm(p.source) === url).map((p) => p.display),
    ],
  }));
  const evidenceCount = claims.length;
  const retrievedAt = new Date(d.scrapedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <Sheet open onClose={onClose} label={`${d.name} details`} width={580}>
      {/* Header */}
      <div className="px-7 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <Monogram name={d.name} size={44} />
            <div className="min-w-0">
              <h2 className="truncate text-[17px] font-semibold tracking-tight">{d.name}</h2>
              <a href={`https://${d.domain}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[13px] text-muted hover:text-ink">
                {d.domain} <ArrowUpRight size={13} />
              </a>
            </div>
          </div>
          <button data-autofocus onClick={onClose} aria-label="Close details" className="-mr-2 rounded-lg p-1.5 text-muted hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-ink">
            <X size={18} />
          </button>
        </div>
        {d.description && <p className="mt-4 text-[13.5px] leading-relaxed text-muted">{d.description}</p>}

        <div
          role="tablist"
          aria-label="Lead details"
          className="mt-5 flex gap-5 border-b border-line text-[13px]"
          onKeyDown={(e) => {
            const i = TABS.indexOf(tab);
            const next = e.key === "ArrowRight" ? TABS[(i + 1) % TABS.length] : e.key === "ArrowLeft" ? TABS[(i + TABS.length - 1) % TABS.length] : null;
            if (next) {
              e.preventDefault();
              setTab(next);
              document.getElementById(`tab-${next}`)?.focus();
            }
          }}
        >
          {TABS.map((t) => (
            <button
              key={t}
              id={`tab-${t}`}
              role="tab"
              aria-selected={tab === t}
              aria-controls={`panel-${t}`}
              tabIndex={tab === t ? 0 : -1}
              onClick={() => setTab(t)}
              className={cx("-mb-px rounded-t border-b-2 pb-2.5 capitalize transition-colors focus-visible:outline-2 focus-visible:outline-ink", tab === t ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink")}
            >
              {t}{t === "sources" && <span className="ml-1 font-normal text-muted">{evidenceCount}</span>}
            </button>
          ))}
        </div>
      </div>

      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="flex-1 overflow-y-auto px-7 py-6">
        {tab === "overview" && (
          <div className="anim-fade space-y-8">
            {d.thinContent && (
              <div className="flex gap-2.5 rounded-xl border border-line bg-subtle/60 p-3.5 text-[12.5px] leading-5 text-ink-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-tier-c" />
                This site serves little text without JavaScript, so many facts may be missing rather than absent.
              </div>
            )}

            {/* Score */}
            <section>
              <div className="flex items-center gap-5">
                <ScoreRing score={score} size={72} stroke={5} />
                <div>
                  <div className="text-[15px] font-semibold" style={{ color: TIER_COLOR[score.tier] }}>{TIER_LABEL[score.tier]}</div>
                  <div className="text-[13px] text-muted">Tier {score.tier} · {score.total} of 100</div>
                  <div className="mt-0.5 font-mono text-[12px] tabular-nums text-muted" aria-label="Score components">
                    {score.components.map((c) => c.points).join(" + ")} = {score.total}
                  </div>
                </div>
              </div>
              <p className="mt-3 text-[12px] text-muted">
                Heuristic acquisition fit under your current buy-box. Not a prediction that the company is for sale or that the owner plans to retire.
              </p>
            </section>

            {/* Next best actions */}
            {actions.length > 0 && (
              <section>
                <Label>Next best actions</Label>
                <ol className="space-y-2.5">
                  {actions.map((a, i) => (
                    <li key={a.title} className="flex gap-3 text-[13px]">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-subtle font-mono text-[11px] text-muted">{i + 1}</span>
                      <div>
                        <div className="font-medium">{a.title}</div>
                        <div className="text-muted">{a.why}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {/* Evidence-backed facts */}
            <section>
              <Label>Key facts</Label>
              <dl className="divide-y divide-line border-y border-line">
                <Fact
                  label="Founded"
                  value={d.foundedYear ? `${ev.foundedYear?.method === "inferred" ? "~" : ""}${d.foundedYear}${age !== null ? ` · ${age} yrs` : ""}` : null}
                  evidence={ev.foundedYear}
                />
                <Fact
                  label="Ownership"
                  value={d.signals.familyOwned ? "Family-owned" : d.signals.ownerOperated ? "Owner-operated" : null}
                  evidence={ev.familyOwned ?? ev.ownerOperated}
                />
                <Fact label="Decision-maker" value={d.people[0] ? `${d.people[0].name} · ${d.people[0].title}` : null} evidence={d.people[0]?.evidence} />
                <Fact label="Industry" value={d.industry} evidence={ev.industry} />
                <Fact label="Location" value={d.location} evidence={ev.location} />
              </dl>
            </section>

            {/* Score breakdown */}
            <section>
              <Label>Score breakdown</Label>
              <div className="space-y-5">
                {score.components.map((c) => (
                  <div key={c.key}>
                    <div className="flex items-baseline justify-between text-[13px]">
                      <span className="font-medium">{c.label}</span>
                      <span className="font-mono tabular-nums text-muted">{c.points}<span className="opacity-50">/{c.max}</span></span>
                    </div>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-subtle">
                      <div className="h-full rounded-full bg-ink transition-all duration-500" style={{ width: `${(c.points / c.max) * 100}%` }} />
                    </div>
                    <ul className="mt-2 space-y-0.5 text-[12.5px] leading-5 text-ink-2">
                      {c.reasons.map((r) => <li key={r}>{r}</li>)}
                    </ul>
                    {c.caveats.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 text-[12px] leading-5 text-muted">
                        {c.caveats.map((r) => (
                          <li key={r} className="flex gap-1.5"><Info size={12} className="mt-[4px] shrink-0" />{r}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Contacts */}
            <section>
              <Label>Contacts</Label>
              {d.emails.length + d.phones.length + d.people.length === 0 ? (
                <p className="text-[13px] text-muted">No public contact details found.</p>
              ) : (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {d.people.map((p) => (
                    <li key={p.name} className="flex items-center gap-3 px-3.5 py-2.5 text-[13px]">
                      <UserRound size={15} strokeWidth={1.75} className="text-muted" />
                      <span className="font-medium">{p.name}</span>
                      <span className="flex-1 text-muted">{p.title}</span>
                      <EvidenceTag e={p.evidence} />
                    </li>
                  ))}
                  {d.emails.map((e) => (
                    <li key={e.address} className="group px-3.5 py-2.5 text-[13px]">
                      <div className="flex items-center gap-3">
                        <Mail size={15} strokeWidth={1.75} className={cx("shrink-0", e.status === "mx-ok" ? "text-tier-a" : "text-danger")} />
                        <span className="min-w-0 flex-1 break-all">{e.address}</span>
                        <span className="shrink-0 text-[11.5px] text-muted">{e.isRole ? "Role inbox" : "Named inbox"}</span>
                        <button onClick={() => copy(e.address, e.address)} aria-label={`Copy ${e.address}`} className="shrink-0 rounded p-1 text-muted opacity-60 hover:bg-hover hover:text-ink focus:opacity-100 group-hover:opacity-100">
                          {copied === e.address ? <Check size={13} /> : <Copy size={13} />}
                        </button>
                      </div>
                      {/* Three distinct checks; only the first two are actually performed. */}
                      <div className="ml-[27px] mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-muted">
                        <span className="inline-flex items-center gap-1"><Check size={11} className="text-tier-a" /> Syntax valid</span>
                        <span className="inline-flex items-center gap-1" title={e.status === "mx-ok" ? "The domain publishes mail servers (MX)." : "The domain publishes no mail servers."}>
                          {e.status === "mx-ok" ? <Check size={11} className="text-tier-a" /> : <X size={11} className="text-danger" />}
                          Domain MX {e.status === "mx-ok" ? "ready" : "missing"}
                        </span>
                        <span className="inline-flex items-center gap-1" title="No SMTP check is made, so the specific mailbox may not exist.">
                          <span aria-hidden className="w-[11px] text-center">–</span> Mailbox not verified
                        </span>
                        {!e.onDomain && <span>Off-domain address</span>}
                      </div>
                    </li>
                  ))}
                  {d.phones.map((p) => (
                    <li key={p.e164} className="group flex items-center gap-3 px-3.5 py-2.5 text-[13px]">
                      <Phone size={15} strokeWidth={1.75} className="text-muted" />
                      <a href={`tel:${p.e164}`} className="flex-1 hover:underline">{p.display}</a>
                      <button onClick={() => copy(p.e164, p.e164)} aria-label="Copy phone" className="rounded p-1 text-muted opacity-0 hover:bg-hover hover:text-ink focus:opacity-100 group-hover:opacity-100">
                        {copied === p.e164 ? <Check size={13} /> : <Copy size={13} />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {Object.keys(d.socials).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                  {Object.entries(d.socials).map(([k, v]) => (
                    <a key={k} href={v} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 capitalize text-muted hover:text-ink">
                      {k === "x" ? "X" : k} <ArrowUpRight size={12} />
                    </a>
                  ))}
                </div>
              )}
            </section>

            <section>
              <Label>Website signals</Label>
              <p className="text-[13px] leading-6 text-ink-2">
                {[...signals, ...d.tech, d.copyrightYear ? `Footer © ${d.copyrightYear}` : null].filter(Boolean).join("  ·  ") || "None detected."}
              </p>
            </section>
          </div>
        )}

        {tab === "outreach" && (
          <div className="anim-fade space-y-8">
            {lead.ai ? (
              <section className="space-y-6 text-[13.5px] leading-relaxed">
                <div className="flex items-center gap-2 text-[12px] text-muted">
                  <Sparkles size={13} /> AI brief · fit {lead.ai.fitRating}/10 · {lead.ai.model}
                </div>
                <p className="text-ink">{lead.ai.summary}</p>
                <div>
                  <Label>Acquisition thesis</Label>
                  <p className="text-ink-2">{lead.ai.acquisitionThesis}</p>
                </div>
                {[
                  ["Improvement opportunities", lead.ai.improvementOpportunities],
                  ["Diligence questions", lead.ai.diligenceQuestions],
                  ["Uncertainties & risks", lead.ai.uncertainties],
                ].map(([title, items]) =>
                  (items as string[] | undefined)?.length ? (
                    <div key={title as string}>
                      <Label>{title as string}</Label>
                      <ul className="list-disc space-y-1 pl-4 text-ink-2 marker:text-muted">{(items as string[]).map((r) => <li key={r}>{r}</li>)}</ul>
                    </div>
                  ) : null,
                )}
                <p className="text-[12px] text-muted">AI-generated from the facts above. Verify before acting.</p>
              </section>
            ) : (
              <section className="rounded-xl border border-dashed border-line-strong p-5 text-center">
                <Sparkles size={18} className="mx-auto text-muted" />
                <p className="mt-2 text-[13.5px] font-medium">Acquisition brief</p>
                <p className="mx-auto mt-1 max-w-xs text-[13px] text-muted">
                  Summary, thesis, improvement ideas, diligence questions and an owner email, grounded in this lead&apos;s evidence.
                </p>
                <Button variant="primary" size="sm" className="mt-4" onClick={generate} disabled={!aiEnabled || brief.loading}>
                  {brief.loading ? <><Loader2 size={14} className="animate-spin" /> Writing…</> : "Generate brief"}
                </Button>
                {aiEnabled === false && <p className="mt-2 text-[12px] text-muted">Add ANTHROPIC_API_KEY to enable.</p>}
                {brief.error && <p className="mt-2 text-[12px] text-danger">{brief.error}</p>}
              </section>
            )}

            <section>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[12px] font-medium text-muted">{lead.ai ? "Draft email" : "Template email"}</h3>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => copy("email", `Subject: ${email.subject}\n\n${email.body}`)}>
                    {copied === "email" ? <Check size={14} /> : <Copy size={14} />} Copy
                  </Button>
                  <a href={mailto} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-ink-2 hover:bg-hover hover:text-ink">
                    <Mail size={14} /> Open
                  </a>
                </div>
              </div>
              <div className="rounded-xl border border-line bg-subtle/50 p-5">
                <div className="border-b border-line pb-3 text-[13.5px] font-medium">{email.subject}</div>
                <pre className="mt-3 whitespace-pre-wrap font-sans text-[13.5px] leading-relaxed text-ink-2">{email.body}</pre>
              </div>
            </section>
          </div>
        )}

        {tab === "sources" && (
          <div className="anim-fade space-y-8">
            {/* Retrieval */}
            <section className="flex flex-wrap items-start justify-between gap-3">
              <div className="text-[13px]">
                <div className="font-medium">Retrieved {retrievedAt}</div>
                <div className="mt-0.5 text-[12px] text-muted">
                  {lead.cached ? "Served from the 7-day cache. " : ""}All {d.pagesCrawled.length} page{d.pagesCrawled.length === 1 ? " was" : "s were"} fetched in this single crawl.
                </div>
              </div>
              <Button size="sm" onClick={() => onRescrape(lead.domain)} disabled={lead.status === "running"}>
                {lead.status === "running" ? <><Loader2 size={13} className="animate-spin" /> Re-crawling…</> : <><RotateCw size={13} /> Re-crawl</>}
              </Button>
              {lead.status === "error" && <p className="w-full text-[12px] text-danger">Re-crawl failed: {lead.error}. Showing the previous data.</p>}
            </section>

            {/* Summary */}
            <section>
              <Label>Evidence summary</Label>
              <div className="grid grid-cols-3 gap-2 text-center">
                {(["structured", "stated", "inferred"] as const).map((m) => (
                  <div key={m} className="rounded-lg border border-line px-2 py-2.5">
                    <div className="text-[18px] font-semibold tabular-nums">{claims.filter((c) => c.evidence.method === m).length}</div>
                    <div className="text-[11.5px] text-muted">{METHOD_LABEL[m]}</div>
                  </div>
                ))}
              </div>
              {unknown.length > 0 && (
                <p className="mt-3 text-[12.5px] text-muted">
                  <span className="font-medium text-ink-2">Not found on crawled pages:</span> {unknown.join(", ")}.
                </p>
              )}
            </section>

            {/* Claims grouped by the page they came from */}
            <section>
              <Label>Claims by source page</Label>
              <div className="space-y-4">
                {byPage.map(({ url, items, contacts }) => (
                  <div key={url} className="rounded-xl border border-line">
                    <a href={url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2.5 text-[12.5px] font-medium text-ink-2 hover:text-ink">
                      <span className="break-all">{url.replace(/^https?:\/\//, "")}</span>
                      <ArrowUpRight size={13} className="shrink-0" />
                    </a>
                    {items.length === 0 && contacts.length === 0 ? (
                      <p className="px-3.5 py-2.5 text-[12.5px] text-muted">Crawled; no key facts extracted from this page.</p>
                    ) : (
                      <ul className="divide-y divide-line">
                        {items.map((c) => (
                          <li key={c.label + c.value} className="px-3.5 py-2.5">
                            <div className="flex items-baseline justify-between gap-3 text-[13px]">
                              <span><span className="text-muted">{c.label}:</span> {c.value}</span>
                              <EvidenceTag e={c.evidence} />
                            </div>
                            <p className="mt-1 text-[12px] italic leading-[18px] text-muted">{c.evidence.snippet}</p>
                            <p className="mt-0.5 text-[11px] text-muted">{c.evidence.confidence} confidence</p>
                          </li>
                        ))}
                        {contacts.length > 0 && (
                          <li className="px-3.5 py-2.5 text-[12.5px]">
                            <span className="text-muted">Contacts found here:</span> {contacts.join(", ")}
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Whole-site observations: no single page is recorded for these. */}
            <section>
              <Label>Website observations</Label>
              <p className="text-[13px] leading-6 text-ink-2">
                {[...signals, ...d.tech, d.copyrightYear ? `Footer © ${d.copyrightYear}` : null].filter(Boolean).join("  ·  ") || "None detected."}
              </p>
              <p className="mt-1 text-[12px] text-muted">Detected across all crawled pages; the individual page is not recorded for these.</p>
              {d.blockedByRobots.length > 0 && (
                <p className="mt-2 text-[12px] text-muted">Skipped per robots.txt: {d.blockedByRobots.join(", ")}</p>
              )}
            </section>

            <section>
              <Label>How evidence is labelled</Label>
              <ul className="space-y-1.5 text-[12.5px] text-ink-2">
                <li><span className="font-medium">Structured data</span>: published by the site itself in schema.org markup.</li>
                <li><span className="font-medium">Stated on site</span>: explicit wording, quoted above.</li>
                <li><span className="font-medium">Inferred</span>: a heuristic such as keyword counts, a person&apos;s title, or &quot;over 30 years&quot;. Treat it as a lead to verify.</li>
                <li><span className="font-medium">Confidence</span>: high = explicit or structured; medium = clear but indirect; low = weak signal.</li>
              </ul>
            </section>
          </div>
        )}
      </div>
    </Sheet>
  );
}
