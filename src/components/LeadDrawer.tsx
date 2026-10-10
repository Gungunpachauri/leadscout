"use client";

import { ArrowUpRight, Check, Copy, Loader2, Mail, Phone, RotateCw, Sparkles, UserRound, X } from "lucide-react";
import { useState } from "react";
import { templateEmail } from "@/lib/export";
import type { IcpSettings, Lead, LeadScore } from "@/lib/types";
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
  const to = d.emails.find((e) => e.status === "deliverable-domain")?.address ?? "";
  const mailto = `mailto:${to}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`;
  const meta = [d.industry, d.location, d.foundedYear && `Est. ${d.foundedYear}`].filter(Boolean);
  const signals = [
    d.signals.familyOwned && "Family-owned",
    d.signals.ownerOperated && "Owner-operated",
    d.signals.hiring && "Hiring",
    d.signals.ecommerce && "E-commerce",
    d.signals.onlineBooking && "Online booking",
  ].filter(Boolean) as string[];

  return (
    <Sheet open onClose={onClose} label={`${d.name} details`} width={560}>
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
        {meta.length > 0 && <p className="mt-4 text-[13px] text-ink-2">{meta.join("  ·  ")}</p>}
        {d.description && <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{d.description}</p>}

        <nav className="mt-6 flex gap-5 border-b border-line text-[13px]">
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
            {/* Score */}
            <section className="flex items-center gap-5">
              <ScoreRing score={score} size={72} stroke={5} />
              <div>
                <div className="text-[15px] font-semibold" style={{ color: TIER_COLOR[score.tier] }}>
                  {TIER_LABEL[score.tier]}
                </div>
                <div className="text-[13px] text-muted">Tier {score.tier} · {score.total} of 100</div>
              </div>
            </section>

            <section className="space-y-5">
              {score.components.map((c) => (
                <div key={c.key}>
                  <div className="flex items-baseline justify-between text-[13px]">
                    <span className="font-medium">{c.label}</span>
                    <span className="font-mono tabular-nums text-muted">{c.points}<span className="opacity-50">/{c.max}</span></span>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-subtle">
                    <div className="h-full rounded-full bg-ink transition-all duration-500" style={{ width: `${(c.points / c.max) * 100}%` }} />
                  </div>
                  <ul className="mt-2 space-y-0.5 text-[12.5px] leading-5 text-muted">
                    {c.reasons.map((r) => <li key={r}>{r}</li>)}
                  </ul>
                </div>
              ))}
            </section>

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
                      <span className="text-muted">{p.title}</span>
                    </li>
                  ))}
                  {d.emails.map((e) => (
                    <li key={e.address} className="group flex items-center gap-3 px-3.5 py-2.5 text-[13px]">
                      <Mail size={15} strokeWidth={1.75} className={e.status === "deliverable-domain" ? "text-tier-a" : "text-danger"} />
                      <span className="min-w-0 flex-1 truncate">{e.address}</span>
                      <span className="text-[11.5px] text-muted">{e.status !== "deliverable-domain" ? "No MX" : e.isRole ? "Role inbox" : "Direct"}</span>
                      <button onClick={() => copy(e.address, e.address)} aria-label="Copy email" className="rounded p-1 text-muted opacity-0 hover:bg-hover hover:text-ink group-hover:opacity-100">
                        {copied === e.address ? <Check size={13} /> : <Copy size={13} />}
                      </button>
                    </li>
                  ))}
                  {d.phones.map((p) => (
                    <li key={p.e164} className="group flex items-center gap-3 px-3.5 py-2.5 text-[13px]">
                      <Phone size={15} strokeWidth={1.75} className="text-muted" />
                      <a href={`tel:${p.e164}`} className="flex-1 hover:underline">{p.display}</a>
                      <button onClick={() => copy(p.e164, p.e164)} aria-label="Copy phone" className="rounded p-1 text-muted opacity-0 hover:bg-hover hover:text-ink group-hover:opacity-100">
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
              <Label>Signals</Label>
              <p className="text-[13px] leading-6 text-ink-2">
                {[...signals, ...d.tech, d.copyrightYear ? `Site © ${d.copyrightYear}` : null].filter(Boolean).join("  ·  ") || "No notable signals detected."}
              </p>
            </section>
          </div>
        )}

        {tab === "outreach" && (
          <div className="anim-fade space-y-8">
            {lead.ai ? (
              <section className="space-y-5 text-[13.5px] leading-relaxed">
                <div className="flex items-center gap-2 text-[12px] text-muted">
                  <Sparkles size={13} /> AI brief · fit {lead.ai.fitRating}/10
                </div>
                <p className="text-ink">{lead.ai.summary}</p>
                <div>
                  <Label>Acquisition thesis</Label>
                  <p className="text-ink-2">{lead.ai.acquisitionThesis}</p>
                </div>
                {lead.ai.risks.length > 0 && (
                  <div>
                    <Label>Diligence questions</Label>
                    <ul className="list-disc space-y-1 pl-4 text-ink-2 marker:text-muted">{lead.ai.risks.map((r) => <li key={r}>{r}</li>)}</ul>
                  </div>
                )}
              </section>
            ) : (
              <section className="rounded-xl border border-dashed border-line-strong p-5 text-center">
                <Sparkles size={18} className="mx-auto text-muted" />
                <p className="mt-2 text-[13.5px] font-medium">Acquisition brief</p>
                <p className="mx-auto mt-1 max-w-xs text-[13px] text-muted">
                  Summary, thesis, diligence questions and a personalised owner email, written by Claude from this lead&apos;s data.
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
