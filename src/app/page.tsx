"use client";

import { Check, Download, Info, ListFilter, Mail, Phone, Plus, RotateCcw, RotateCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, Target, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BuyBoxSheet } from "@/components/BuyBoxSheet";
import { Composer } from "@/components/Composer";
import { LeadDrawer } from "@/components/LeadDrawer";
import { LeadTable, type Row, type SortKey } from "@/components/LeadTable";
import { Button, Menu, MenuItem, Modal, TIER_LABEL, TierDot, Tip, Toggle, cx } from "@/components/ui";
import { exportCsv, exportHubspot } from "@/lib/export";
import { dedupeInputs, parseImport } from "@/lib/normalize";
import { DEFAULT_ICP, SCORING, scoreLead } from "@/lib/score";
import { ENRICHMENT_VERSION, type IcpSettings, type Lead, type LeadScore } from "@/lib/types";

const CONCURRENCY = 4;
const TIER_RANGE: Record<LeadScore["tier"], string> = {
  A: `score ${SCORING.tiers.A}–100`,
  B: `score ${SCORING.tiers.B}–${SCORING.tiers.A - 1}`,
  C: `score ${SCORING.tiers.C}–${SCORING.tiers.B - 1}`,
  D: `score below ${SCORING.tiers.C}`,
};
const STORAGE_KEY = "leadscout:v1";
type Sender = { name?: string; firm?: string };
type Persisted = { leads: Lead[]; icp: IcpSettings; sender: Sender };

function load(): Persisted | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}

/** Turn API errors into something a user can act on. */
function friendlyError(raw: string | undefined, status: number): string {
  if (raw === "Site unreachable") return "Couldn't reach the site (offline, blocking bots, or too slow).";
  if (raw === "Homepage disallowed by robots.txt") return "The site's robots.txt asks crawlers not to visit, so it was skipped.";
  if (raw === "Homepage is not HTML") return "The homepage isn't a web page (e.g. a file download).";
  if (raw === "Not a valid domain") return "Not a valid domain.";
  if (status === 429) return "Too many requests. Wait a moment and retry.";
  if (status >= 500) return "Server error while enriching. Retry shortly.";
  return raw ?? `Request failed (${status}).`;
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
        <rect width="24" height="24" rx="6" fill="currentColor" />
        <circle cx="10.5" cy="10.5" r="4.5" fill="none" stroke="var(--bg)" strokeWidth="2" />
        <path d="M14 14l4 4" stroke="var(--bg)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight">LeadScout</span>
    </div>
  );
}

export default function Dashboard() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [icp, setIcp] = useState<IcpSettings>(DEFAULT_ICP);
  const [sender, setSender] = useState<Sender>({});
  const [hydrated, setHydrated] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [buyBoxOpen, setBuyBoxOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState<LeadScore["tier"] | null>(null);
  const [needEmail, setNeedEmail] = useState(false);
  const [needPhone, setNeedPhone] = useState(false);
  const [industry, setIndustry] = useState<string | null>(null);
  const [minScore, setMinScore] = useState(0);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "score", dir: -1 });
  const activeWorkers = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  // Restore the last session; leads that were mid-flight go back to the queue.
  useEffect(() => {
    const saved = load();
    if (saved) {
      setLeads(saved.leads.map((l): Lead => {
        if (l.status === "running") return { ...l, status: "queued" };
        // Data saved by an older version lacks evidence; re-enrich it.
        if (l.data && l.data.version !== ENRICHMENT_VERSION) return { domain: l.domain, inputName: l.inputName, status: "queued" };
        return l;
      }));
      setIcp({ ...DEFAULT_ICP, ...saved.icp, prefer: { ...DEFAULT_ICP.prefer, ...saved.icp?.prefer } });
      setSender(saved.sender ?? {});
    }
    setHydrated(true);
    fetch("/api/brief").then((r) => r.json()).then((j) => setAiEnabled(Boolean(j.enabled))).catch(() => setAiEnabled(false));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ leads, icp, sender }));
    } catch { /* storage full or blocked; the session still works */ }
  }, [leads, icp, sender, hydrated]);

  const patch = useCallback((domain: string, p: Partial<Lead>) => {
    setLeads((ls) => ls.map((l) => (l.domain === domain ? { ...l, ...p } : l)));
  }, []);

  // A small worker pool pulling queued leads, one domain per API call.
  const leadsRef = useRef(leads);
  leadsRef.current = leads;
  const claimed = useRef(new Set<string>());

  const enrichOne = useCallback(async (domain: string, refresh = false) => {
    patch(domain, { status: "running", error: undefined });
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain, refresh }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(friendlyError(json.error, res.status));
      patch(domain, { status: "done", data: json.data, cached: json.cached, ...(refresh ? { ai: undefined } : {}) });
    } catch (e) {
      const msg = e instanceof TypeError ? "Network error. Check your connection and retry." : (e as Error).message;
      patch(domain, { status: "error", error: msg });
    }
  }, [patch]);

  const pump = useCallback(() => {
    while (activeWorkers.current < CONCURRENCY) {
      const next = leadsRef.current.find((l) => l.status === "queued" && !claimed.current.has(l.domain));
      if (!next) return;
      claimed.current.add(next.domain);
      activeWorkers.current++;
      enrichOne(next.domain).finally(() => {
        activeWorkers.current--;
        claimed.current.delete(next.domain);
        pump();
      });
    }
  }, [enrichOne]);

  useEffect(() => {
    if (hydrated && leads.some((l) => l.status === "queued")) pump();
  }, [leads, hydrated, pump]);

  function addRows(items: { value: string; name?: string }[]) {
    const parsed = dedupeInputs(items);
    const existing = new Set(leads.map((l) => l.domain));
    const fresh = parsed.rows.filter((r) => !existing.has(r.domain));
    const dupes = parsed.duplicates + (parsed.rows.length - fresh.length);
    setLeads((ls) => [...ls, ...fresh.map((r): Lead => ({ domain: r.domain, inputName: r.name, status: "queued" }))]);
    const parts = [`${fresh.length} lead${fresh.length === 1 ? "" : "s"} added`];
    if (dupes) parts.push(`${dupes} duplicate${dupes === 1 ? "" : "s"} merged`);
    if (parsed.invalid.length) parts.push(`${parsed.invalid.length} invalid skipped`);
    notify(parts.join(" · "));
    setAddOpen(false);
  }

  function importText(text: string) {
    const items = parseImport(text);
    if (!items.length) {
      notify("Nothing to import. Paste domains or upload a CSV with a website column.");
      return;
    }
    addRows(items);
  }

  const onFile = async (f: File) => {
    if (!/\.(csv|txt|tsv)$/i.test(f.name) && !/^text\//.test(f.type)) {
      notify(`Unsupported file "${f.name}". Export it as .csv and try again.`);
      return;
    }
    if (f.size > 5_000_000) {
      notify("File is larger than 5 MB. Split it into smaller CSVs.");
      return;
    }
    const text = await f.text();
    if (!text.trim()) {
      notify(`"${f.name}" is empty.`);
      return;
    }
    importText(text);
  };
  const loadSample = async () => importText(await fetch("/sample-leads.csv").then((r) => r.text()));

  const scores = useMemo(() => {
    const m = new Map<string, LeadScore>();
    // Only score data in the current schema; anything older is re-queued on load.
    for (const l of leads) if (l.data?.version === ENRICHMENT_VERSION) m.set(l.domain, scoreLead(l.data, icp));
    return m;
  }, [leads, icp]);

  const tierCounts = useMemo(() => {
    const c = { A: 0, B: 0, C: 0, D: 0 };
    for (const s of scores.values()) c[s.tier]++;
    return c;
  }, [scores]);

  const rows: Row[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    const nowYear = new Date().getFullYear();
    const filtering = Boolean(tier || needEmail || needPhone || industry || minScore);
    const filtered = leads
      .map((lead) => ({ lead, score: scores.get(lead.domain) ?? null }))
      .filter(({ lead, score }) => {
        if (q && !`${lead.domain} ${lead.data?.name ?? ""} ${lead.inputName ?? ""} ${lead.data?.industry ?? ""} ${lead.data?.location ?? ""}`.toLowerCase().includes(q)) return false;
        if (!score) return !filtering;
        if (tier && score.tier !== tier) return false;
        if (score.total < minScore) return false;
        if (industry && (lead.data!.industry ?? "Unknown") !== industry) return false;
        if (needEmail && !lead.data!.emails.some((e) => e.status === "mx-ok")) return false;
        if (needPhone && !lead.data!.phones.length) return false;
        return true;
      });
    const val = (r: Row) =>
      sort.key === "score" ? (r.score?.total ?? -1)
        : sort.key === "age" ? (r.lead.data?.foundedYear ? nowYear - r.lead.data.foundedYear : -1)
          : (r.lead.data?.name ?? r.lead.domain).toLowerCase();
    return filtered.sort((a, b) => {
      const va = val(a), vb = val(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  }, [leads, scores, search, tier, needEmail, needPhone, industry, minScore, sort]);

  // Industries actually present in the list, for the filter menu.
  const industries = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of leads) if (l.data) m.set(l.data.industry ?? "Unknown", (m.get(l.data.industry ?? "Unknown") ?? 0) + 1);
    return [...m].sort((a, b) => (a[0] === "Unknown" ? 1 : b[0] === "Unknown" ? -1 : b[1] - a[1]));
  }, [leads]);
  const activeFilters = (industry ? 1 : 0) + (minScore ? 1 : 0);
  const anyFilter = Boolean(tier || needEmail || needPhone || industry || minScore || search.trim());
  const resetView = () => { setTier(null); setNeedEmail(false); setNeedPhone(false); setIndustry(null); setMinScore(0); setSearch(""); };

  // Metrics are computed over *scored* leads only (in-progress and failed rows are excluded),
  // using the same scores, and therefore the same buy-box, as the table.
  const pending = leads.filter((l) => l.status === "queued" || l.status === "running").length;
  const failed = leads.filter((l) => l.status === "error");
  const scoredLeads = leads.filter((l) => scores.has(l.domain));
  const scoredList = scoredLeads.map((l) => scores.get(l.domain)!);
  const avg = scoredList.length ? Math.round(scoredList.reduce((s, x) => s + x.total, 0) / scoredList.length) : null;
  const reachable = scoredLeads.filter((l) => l.data!.emails.some((e) => e.status === "mx-ok") || l.data!.phones.length).length;
  const exportable = rows.filter((r): r is { lead: Lead; score: LeadScore } => r.score !== null);
  const selectedLead = selected ? leads.find((l) => l.domain === selected) : undefined;
  const icpCount = icp.industries.length + icp.keywords.length + Object.values(icp.prefer ?? {}).filter(Boolean).length;
  const T = SCORING.tiers;
  const metrics = [
    {
      label: "Priority",
      value: scoredList.length ? tierCounts.A : "–",
      sub: `of ${scoredList.length} scored`,
      tip: `Leads in tier A: score ${T.A}–100 under your current buy-box. Same number as the "A" tab.`,
    },
    {
      label: "Reachable",
      value: scoredList.length ? reachable : "–",
      sub: `of ${scoredList.length} scored`,
      tip: "Scored leads with at least one email on a mail-ready (MX) domain, or a phone number. Mailboxes are not individually verified.",
    },
    {
      label: "Avg score",
      value: avg ?? "–",
      sub: "out of 100",
      tip: "Mean score of scored leads under your current buy-box. In-progress and failed leads are excluded.",
    },
  ];
  const progress = leads.length ? (leads.length - pending) / leads.length : 1;
  const onSort = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "name" ? 1 : -1 }));
  const empty = hydrated && leads.length === 0;

  return (
    <div className="min-h-screen">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-line/70 bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <div className="flex items-center gap-1.5">
            {aiEnabled !== null && (
              <Tip
                side="bottom"
                align="right"
                wide
                content={
                  aiEnabled
                    ? "Scores are always rule-based and deterministic. AI is enabled only for the optional per-lead brief you request."
                    : "Scores are rule-based and deterministic; no AI is used to rank leads. Optional AI briefs are off because ANTHROPIC_API_KEY isn't set. Template emails still work."
                }
              >
                <button type="button" className="mr-1 hidden items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink sm:flex">
                  <span className={cx("h-1.5 w-1.5 rounded-full", aiEnabled ? "bg-tier-a" : "bg-tier-d")} />
                  {aiEnabled ? "AI briefs on" : "Rules-based · AI off"}
                  <Info size={12} />
                </button>
              </Tip>
            )}
            <Button variant="ghost" size="sm" onClick={() => setBuyBoxOpen(true)} title="Investment criteria used to score leads">
              <SlidersHorizontal size={15} strokeWidth={1.75} />
              Buy-box
              {icpCount > 0 && <span className="ml-0.5 rounded bg-ink px-1.5 text-[11px] font-semibold leading-[18px] text-bg">{icpCount}</span>}
            </Button>
            {!empty && (
              <Button variant="primary" size="sm" onClick={() => setAddOpen(true)} label="Add leads">
                <Plus size={15} strokeWidth={2} /> <span className="hidden sm:inline">Add leads</span>
              </Button>
            )}
          </div>
        </div>
        {pending > 0 && (
          <div className="absolute inset-x-0 -bottom-px h-[2px] overflow-hidden">
            <div className="h-full bg-ink transition-all duration-500 ease-out" style={{ width: `${Math.max(4, progress * 100)}%` }} />
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        {!hydrated ? (
          <div className="pt-10" aria-busy="true" aria-label="Loading">
            <div className="skeleton h-7 w-28 rounded" />
            <div className="skeleton mt-3 h-3 w-48 rounded" />
            <div className="skeleton mt-10 h-72 w-full rounded-2xl" />
          </div>
        ) : empty ? (
          /* Empty state */
          <div className="mx-auto max-w-2xl pb-24 pt-20 sm:pt-28">
            <div className="anim-rise text-center">
              <p className="text-[13px] font-medium text-muted">Lead qualification for searchers & PE buyers</p>
              <h1 className="mt-4 text-[40px] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-[56px]">
                Find the businesses
                <br />
                <span className="text-muted">worth buying.</span>
              </h1>
              <p className="mx-auto mt-5 max-w-md text-[15px] leading-relaxed text-ink-2">
                Drop in a SaaSquatch export. LeadScout crawls each site, verifies contacts and ranks every lead by acquisition fit.
              </p>
            </div>
            <div className="anim-rise mt-10">
              <Composer onSubmitText={importText} onFile={onFile} onSample={loadSample} />
            </div>
            <div className="anim-rise mt-10 grid grid-cols-1 gap-6 text-[13px] sm:grid-cols-3">
              {[
                [ShieldCheck, "Polite crawling", "Public sites only, robots.txt honoured"],
                [Mail, "Verified contacts", "MX-checked emails, owners, phones"],
                [Target, "Explainable scores", "Every point backed by evidence"],
              ].map(([Icon, title, sub]) => {
                const I = Icon as typeof ShieldCheck;
                return (
                  <div key={title as string} className="flex gap-3">
                    <I size={17} strokeWidth={1.75} className="mt-0.5 shrink-0 text-muted" />
                    <div>
                      <div className="font-medium">{title as string}</div>
                      <div className="mt-0.5 text-muted">{sub as string}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* Workspace */
          <div className="pb-20 pt-10">
            <div className="anim-rise flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
              <div>
                <h1 className="text-[28px] font-semibold tracking-[-0.03em]">Leads</h1>
                <p className="mt-1 text-[13px] text-muted" aria-live="polite">
                  {pending > 0
                    ? `Enriching ${leads.length - pending} of ${leads.length}…`
                    : `${leads.length} imported · ${scoredList.length} scored${failed.length ? ` · ${failed.length} failed` : ""}`}
                </p>
              </div>
              <dl className="flex gap-8 sm:gap-12">
                {metrics.map((m) => (
                  <div key={m.label}>
                    <dt>
                      <Tip content={m.tip} wide align="right" side="bottom">
                        <button type="button" className="inline-flex items-center gap-1 rounded text-[12px] text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink">
                          {m.label} <Info size={11} />
                        </button>
                      </Tip>
                    </dt>
                    <dd className="mt-0.5 text-[26px] font-semibold leading-8 tabular-nums tracking-[-0.03em]">{m.value}</dd>
                    <dd className="text-[11.5px] text-muted">{m.sub}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Toolbar */}
            <div className="mt-8 flex flex-wrap items-center gap-2">
              <div role="group" aria-label="Filter by tier" className="scrollbar-none flex items-center gap-0.5 overflow-x-auto rounded-lg bg-subtle p-0.5">
                {([null, "A", "B", "C", "D"] as const).map((t) => (
                  <button
                    key={t ?? "all"}
                    onClick={() => setTier(t)}
                    aria-pressed={tier === t}
                    title={t ? `Tier ${t} · ${TIER_LABEL[t]}: ${TIER_RANGE[t]}` : "All imported leads, including in-progress and failed"}
                    className={cx(
                      "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-all focus-visible:outline-2 focus-visible:outline-ink",
                      tier === t ? "bg-surface font-medium text-ink shadow-soft" : "text-muted hover:text-ink",
                    )}
                  >
                    {t ? <><TierDot tier={t} />{t}</> : "All"}
                    <span className="tabular-nums text-muted">{t ? tierCounts[t] : leads.length}</span>
                  </button>
                ))}
              </div>
              <Toggle on={needEmail} onClick={() => setNeedEmail((v) => !v)} title="Only leads with an email on a mail-ready (MX) domain"><Mail size={13} strokeWidth={1.75} /> Email</Toggle>
              <Toggle on={needPhone} onClick={() => setNeedPhone((v) => !v)} title="Only leads with a phone number"><Phone size={13} strokeWidth={1.75} /> Phone</Toggle>
              <Menu
                align="left"
                trigger={(open, toggle) => (
                  <Toggle on={activeFilters > 0} onClick={toggle} expanded={open}>
                    <ListFilter size={13} strokeWidth={1.75} /> Filters{activeFilters > 0 && ` · ${activeFilters}`}
                  </Toggle>
                )}
              >
                {() => (
                  <div className="w-64 p-2">
                    <div className="flex items-baseline justify-between px-0.5">
                      <span className="text-[12px] font-medium text-muted">Minimum score</span>
                      <span className="font-mono text-[12px] tabular-nums">{minScore}</span>
                    </div>
                    <input type="range" min={0} max={90} step={5} value={minScore} onChange={(e) => setMinScore(+e.target.value)} className="mt-1.5 w-full" aria-label="Minimum score" />
                    <div className="mt-3 px-0.5 text-[12px] font-medium text-muted">Industry</div>
                    <div className="mt-1 max-h-56 overflow-y-auto">
                      {[[null, leads.filter((l) => l.data).length] as const, ...industries].map(([ind, n]) => (
                        <button
                          key={ind ?? "all"}
                          onClick={() => setIndustry(ind)}
                          aria-pressed={industry === ind}
                          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-hover focus-visible:outline-2 focus-visible:outline-ink"
                        >
                          <span className="flex items-center gap-2">
                            <Check size={13} className={industry === ind ? "opacity-100" : "opacity-0"} />
                            {ind ?? "All industries"}
                          </span>
                          <span className="tabular-nums text-muted">{n}</span>
                        </button>
                      ))}
                    </div>
                    {activeFilters > 0 && (
                      <button onClick={() => { setIndustry(null); setMinScore(0); }} className="mt-2 w-full rounded-md py-1.5 text-[12px] text-muted hover:bg-hover hover:text-ink">
                        Clear filters
                      </button>
                    )}
                  </div>
                )}
              </Menu>

              {anyFilter && (
                <Button variant="ghost" size="sm" onClick={resetView} title="Clear tier, filters and search">
                  <RotateCcw size={13} /> Reset view
                </Button>
              )}
              {failed.length > 0 && pending === 0 && (
                <Button variant="ghost" size="sm" onClick={() => failed.forEach((l) => patch(l.domain, { status: "queued", error: undefined }))} title="Queue every failed lead again">
                  <RotateCw size={13} /> Retry {failed.length} failed
                </Button>
              )}

              <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
                <label className="relative flex-1 sm:flex-none">
                  <span className="sr-only">Search leads</span>
                  <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && setSearch("")}
                    placeholder="Search name, domain, industry, city"
                    className="h-8 w-full rounded-lg border border-line-strong bg-surface pl-8 pr-7 text-[13px] outline-none transition placeholder:text-muted/80 focus:border-ink sm:w-60 [&::-webkit-search-cancel-button]:hidden"
                  />
                  {search && (
                    <button onClick={() => setSearch("")} aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-ink">
                      <X size={13} />
                    </button>
                  )}
                </label>
                <Menu
                  trigger={(open, toggle) => (
                    <Button size="sm" onClick={toggle} disabled={!exportable.length} expanded={open} title={exportable.length ? "Export the leads in the current view" : "No scored leads in the current view"}>
                      <Download size={14} strokeWidth={1.75} /> Export
                    </Button>
                  )}
                >
                  {(close) => (
                    <>
                      <div className="px-2.5 pb-1 pt-1.5 text-[11px] text-muted">{exportable.length} leads in current view</div>
                      <MenuItem onClick={() => { exportCsv(exportable); close(); }} hint=".csv">Spreadsheet</MenuItem>
                      <MenuItem onClick={() => { exportHubspot(exportable); close(); }} hint=".csv">HubSpot import</MenuItem>
                    </>
                  )}
                </Menu>
              </div>
            </div>

            {/* List */}
            {/* No overflow-hidden here: score tooltips must be able to escape the card. */}
            <div className="anim-rise mt-4 rounded-2xl border border-line bg-surface shadow-soft md:pt-3">
              {rows.length === 0 ? (
                <div className="px-6 py-20 text-center">
                  <p className="text-[14px] font-medium">No leads match this view</p>
                  <p className="mt-1 text-[13px] text-muted">
                    {[tier && `tier ${tier}`, industry, minScore && `score ≥ ${minScore}`, needEmail && "has email", needPhone && "has phone", search.trim() && `“${search.trim()}”`].filter(Boolean).join(" · ")}
                  </p>
                  <Button size="sm" className="mt-4" onClick={resetView}><RotateCcw size={13} /> Clear filters</Button>
                </div>
              ) : (
                <LeadTable rows={rows} sort={sort} onSort={onSort} onSelect={setSelected} selected={selected} onRetry={(d) => enrichOne(d)} />
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-2 text-[12px] leading-5 text-muted">
              <p>
                Score = reachability {SCORING.reach.max} + acquisition fit {SCORING.fit.max} + buy-box {SCORING.icp.max} + data confidence {SCORING.confidence.max}.
                {" "}Tiers: A {T.A}+ · B {T.B}–{T.A - 1} · C {T.C}–{T.B - 1} · D &lt;{T.C}. Heuristic fit, not a prediction of a sale.
              </p>
              <button
                className="inline-flex shrink-0 items-center gap-1 rounded transition-colors hover:text-danger focus-visible:outline-2 focus-visible:outline-ink"
                onClick={() => {
                  if (confirm(`Remove all ${leads.length} leads from this browser? Your buy-box settings are kept.`)) {
                    setLeads([]);
                    setSelected(null);
                    resetView();
                    notify("List cleared");
                  }
                }}
              >
                <Trash2 size={12} /> Clear list
              </button>
            </div>
          </div>
        )}
      </main>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} label="Add leads">
        <Composer onSubmitText={importText} onFile={onFile} onSample={loadSample} autoFocus compact />
      </Modal>

      <BuyBoxSheet open={buyBoxOpen} onClose={() => setBuyBoxOpen(false)} icp={icp} setIcp={setIcp} sender={sender} setSender={setSender} />

      {selectedLead?.data && scores.get(selectedLead.domain) && (
        <LeadDrawer
          key={selectedLead.domain}
          lead={selectedLead}
          score={scores.get(selectedLead.domain)!}
          icp={icp}
          sender={sender}
          aiEnabled={aiEnabled}
          onClose={() => setSelected(null)}
          onBrief={(domain, ai) => patch(domain, { ai })}
          onRescrape={(domain) => enrichOne(domain, true)}
        />
      )}

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4" role="status">
          <div className="anim-rise flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[13px] text-bg shadow-float">
            <Sparkles size={14} /> {toast}
          </div>
        </div>
      )}
    </div>
  );
}
