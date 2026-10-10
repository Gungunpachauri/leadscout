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
          <button onClick={onClose} aria-label="Close" className="-mr-2 rounded-lg p-1.5 text-muted hover:bg-hover hover:text-ink">
            <X size={18} />
          </button>
        </div>
        {d.description && <p className="mt-4 text-[13.5px] leading-relaxed text-muted">{d.description}</p>}

        <nav className="mt-5 flex gap-5 border-b border-line text-[13px]">
          {(["overview", "outreach", "sources"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cx("-mb-px border-b-2 pb-2.5 capitalize transition-colors", tab === t ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink")}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-6">
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
                </div>
              </div>
              <p className="mt-3 text-[12px] text-muted">Heuristic acquisition fit. Not a prediction that the company is for sale.</p>
            </section>

            {/* Next steps */}
            {actions.length > 0 && (
              <section>
                <Label>Next steps</Label>
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
                    <li key={e.address} className="group flex items-center gap-3 px-3.5 py-2.5 text-[13px]">
                      <Mail size={15} strokeWidth={1.75} className={e.status === "mx-ok" ? "text-tier-a" : "text-danger"} />
                      <span className="min-w-0 flex-1 truncate">{e.address}</span>
                      <span className="text-[11.5px] text-muted" title={e.status === "mx-ok" ? "Domain accepts mail. Mailbox not verified." : "Domain has no mail servers"}>
                        {e.status !== "mx-ok" ? "No MX" : e.isRole ? "Role inbox" : "Direct"}
                      </span>
                      <button onClick={() => copy(e.address, e.address)} aria-label="Copy email" className="rounded p-1 text-muted opacity-0 hover:bg-hover hover:text-ink focus:opacity-100 group-hover:opacity-100">
                        {copied === e.address ? <Check size={13} /> : <Copy size={13} />}
                      </button>
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
              {d.emails.some((e) => e.status === "mx-ok") && (
                <p className="mt-2 text-[12px] text-muted">Green = the email&apos;s domain accepts mail (MX). Individual mailboxes are not verified.</p>
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
            <section>
              <Label>Pages crawled</Label>
              <ul className="space-y-1.5 text-[13px]">
                {d.pagesCrawled.map((u) => (
                  <li key={u}>
                    <a href={u} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-ink-2 hover:text-ink">
                      <span className="truncate">{u.replace(/^https?:\/\//, "")}</span> <ArrowUpRight size={12} className="shrink-0" />
                    </a>
                  </li>
                ))}
              </ul>
              {d.blockedByRobots.length > 0 && (
                <p className="mt-3 text-[12.5px] text-muted">Skipped per robots.txt: {d.blockedByRobots.join(", ")}</p>
              )}
            </section>
            <section>
              <Label>How facts are labelled</Label>
              <ul className="space-y-1.5 text-[12.5px] text-ink-2">
                <li><span className="font-medium">Structured data</span>: published by the site in schema.org markup.</li>
                <li><span className="font-medium">Stated on site</span>: explicit wording, quoted as evidence.</li>
                <li><span className="font-medium">Inferred</span>: heuristic, e.g. keyword counts or &quot;over 30 years&quot;.</li>
              </ul>
            </section>
            <section>
              <Label>Freshness</Label>
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-ink-2">
                  {lead.cached ? "Cached · " : ""}{new Date(d.scrapedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                </span>
                <Button size="sm" onClick={() => onRescrape(lead.domain)}><RotateCw size={13} /> Re-crawl</Button>
              </div>
            </section>
          </div>
        )}
      </div>
    </Sheet>
  );
}
