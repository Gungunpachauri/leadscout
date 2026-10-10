"use client";

import { Download, Mail, Phone, Plus, Search, ShieldCheck, SlidersHorizontal, Sparkles, Target, Trash2, X } from "lucide-react";
import Papa from "papaparse";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BuyBoxSheet } from "@/components/BuyBoxSheet";
import { Composer } from "@/components/Composer";
import { LeadDrawer } from "@/components/LeadDrawer";
import { LeadTable, type Row, type SortKey } from "@/components/LeadTable";
import { Button, Menu, MenuItem, Modal, TierDot, Toggle, cx } from "@/components/ui";
import { exportCsv, exportHubspot } from "@/lib/export";
import { dedupeInputs, guessColumns } from "@/lib/normalize";
import { DEFAULT_ICP, scoreLead } from "@/lib/score";
import type { IcpSettings, Lead, LeadScore } from "@/lib/types";

const CONCURRENCY = 4;
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
      setLeads(saved.leads.map((l) => (l.status === "running" ? { ...l, status: "queued" } : l)));
      setIcp({ ...DEFAULT_ICP, ...saved.icp });
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
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      patch(domain, { status: "done", data: json.data, cached: json.cached, ...(refresh ? { ai: undefined } : {}) });
    } catch (e) {
      patch(domain, { status: "error", error: (e as Error).message });
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
    const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
    const { domainCol, nameCol } = guessColumns(res.meta.fields ?? []);
    if (!domainCol) {
      addRows(text.split(/[\n,;]+/).map((value) => ({ value })));
      return;
    }
    addRows(res.data.map((r) => ({ value: r[domainCol] ?? "", name: nameCol ? r[nameCol] : undefined })));
  }

  const onFile = async (f: File) => importText(await f.text());
  const loadSample = async () => importText(await fetch("/sample-leads.csv").then((r) => r.text()));

  const scores = useMemo(() => {
    const m = new Map<string, LeadScore>();
    for (const l of leads) if (l.data) m.set(l.domain, scoreLead(l.data, icp));
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
    const filtering = Boolean(tier || needEmail || needPhone);
    const filtered = leads
      .map((lead) => ({ lead, score: scores.get(lead.domain) ?? null }))
      .filter(({ lead, score }) => {
        if (q && !`${lead.domain} ${lead.data?.name ?? ""} ${lead.inputName ?? ""} ${lead.data?.industry ?? ""} ${lead.data?.location ?? ""}`.toLowerCase().includes(q)) return false;
        if (!score) return !filtering;
        if (tier && score.tier !== tier) return false;
        if (needEmail && !lead.data!.emails.some((e) => e.status === "deliverable-domain")) return false;
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
  }, [leads, scores, search, tier, needEmail, needPhone, sort]);

  const done = leads.filter((l) => l.status === "done");
  const pending = leads.filter((l) => l.status === "queued" || l.status === "running").length;
  const scoredList = [...scores.values()];
  const avg = scoredList.length ? Math.round(scoredList.reduce((s, x) => s + x.total, 0) / scoredList.length) : null;
  const reachable = done.filter((l) => l.data!.emails.some((e) => e.status === "deliverable-domain") || l.data!.phones.length).length;
  const exportable = rows.filter((r): r is { lead: Lead; score: LeadScore } => r.score !== null);
  const selectedLead = selected ? leads.find((l) => l.domain === selected) : undefined;
  const icpCount = icp.industries.length + icp.keywords.length;
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
            <span className="mr-2 hidden items-center gap-1.5 text-[12px] text-muted sm:flex" title={aiEnabled ? "Claude AI briefs enabled" : "Set ANTHROPIC_API_KEY to enable AI briefs"}>
              <span className={cx("h-1.5 w-1.5 rounded-full", aiEnabled ? "bg-tier-a" : "bg-tier-d")} />
              {aiEnabled === null ? "" : aiEnabled ? "AI on" : "Rules only"}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setBuyBoxOpen(true)}>
              <SlidersHorizontal size={15} strokeWidth={1.75} />
              Buy-box
              {icpCount > 0 && <span className="ml-0.5 rounded bg-ink px-1.5 text-[11px] font-semibold leading-[18px] text-bg">{icpCount}</span>}
            </Button>
            {!empty && (
              <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
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
        {!hydrated ? null : empty ? (
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
                <p className="mt-1 text-[13px] text-muted">
                  {pending > 0 ? `Enriching ${leads.length - pending} of ${leads.length}…` : `${leads.length} companies · ranked by acquisition fit`}
                </p>
              </div>
              <dl className="flex gap-8 sm:gap-12">
                {[
                  ["Priority", tierCounts.A + tierCounts.B],
                  ["Reachable", reachable],
                  ["Avg score", avg ?? "-"],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <dt className="text-[12px] text-muted">{label}</dt>
                    <dd className="mt-0.5 text-[26px] font-semibold tabular-nums tracking-[-0.03em]">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Toolbar */}
            <div className="mt-8 flex flex-wrap items-center gap-2">
              <div className="scrollbar-none flex items-center gap-0.5 overflow-x-auto rounded-lg bg-subtle p-0.5">
                {([null, "A", "B", "C", "D"] as const).map((t) => (
                  <button
                    key={t ?? "all"}
                    onClick={() => setTier(t)}
                    className={cx(
                      "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-all",
                      tier === t ? "bg-surface font-medium text-ink shadow-soft" : "text-muted hover:text-ink",
                    )}
                  >
                    {t ? <><TierDot tier={t} />{t}</> : "All"}
                    <span className="tabular-nums text-muted">{t ? tierCounts[t] : leads.length}</span>
                  </button>
                ))}
              </div>
              <Toggle on={needEmail} onClick={() => setNeedEmail((v) => !v)}><Mail size={13} strokeWidth={1.75} /> Email</Toggle>
              <Toggle on={needPhone} onClick={() => setNeedPhone((v) => !v)}><Phone size={13} strokeWidth={1.75} /> Phone</Toggle>

              <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
                <label className="relative flex-1 sm:flex-none">
                  <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search"
                    className="h-8 w-full rounded-lg border border-line-strong bg-surface pl-8 pr-7 text-[13px] outline-none transition focus:border-ink sm:w-52"
                  />
                  {search && (
                    <button onClick={() => setSearch("")} aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-ink">
                      <X size={13} />
                    </button>
                  )}
                </label>
                <Menu
                  trigger={(_, toggle) => (
                    <Button size="sm" onClick={toggle} disabled={!exportable.length}>
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
            <div className="anim-rise mt-4 overflow-hidden rounded-2xl border border-line bg-surface shadow-soft md:pt-3">
              {rows.length === 0 ? (
                <div className="px-6 py-20 text-center">
                  <p className="text-[14px] font-medium">No matches</p>
                  <p className="mt-1 text-[13px] text-muted">Try a different tier or clear the filters.</p>
                </div>
              ) : (
                <LeadTable rows={rows} sort={sort} onSort={onSort} onSelect={setSelected} selected={selected} onRetry={(d) => enrichOne(d)} />
              )}
            </div>

            <div className="mt-4 flex items-center justify-between text-[12px] text-muted">
              <span>
                Score = reachability 35 + acquisition fit 40 + buy-box 15 + data confidence 10
              </span>
              <button
                className="inline-flex items-center gap-1 transition-colors hover:text-danger"
                onClick={() => { if (confirm("Remove all leads from this browser?")) { setLeads([]); setSelected(null); } }}
              >
                <Trash2 size={12} /> Clear
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
