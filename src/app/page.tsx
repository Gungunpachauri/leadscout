"use client";

import Papa from "papaparse";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LeadDrawer } from "@/components/LeadDrawer";
import { LeadTable, type Row, type SortKey } from "@/components/LeadTable";
import { Button, Card, Chip, SectionTitle, Stat } from "@/components/ui";
import { exportCsv, exportHubspot } from "@/lib/export";
import { dedupeInputs, guessColumns } from "@/lib/normalize";
import { DEFAULT_ICP, INDUSTRIES, scoreLead } from "@/lib/score";
import type { IcpSettings, Lead, LeadScore } from "@/lib/types";

const CONCURRENCY = 4;
const STORAGE_KEY = "leadscout:v1";

type Persisted = { leads: Lead[]; icp: IcpSettings; sender: { name?: string; firm?: string } };

function load(): Persisted | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}

export default function Dashboard() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [icp, setIcp] = useState<IcpSettings>(DEFAULT_ICP);
  const [sender, setSender] = useState<{ name?: string; firm?: string }>({});
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tiers, setTiers] = useState<Set<LeadScore["tier"]>>(new Set());
  const [minScore, setMinScore] = useState(0);
  const [needEmail, setNeedEmail] = useState(false);
  const [needPhone, setNeedPhone] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "score", dir: -1 });
  const [keywordDraft, setKeywordDraft] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const activeWorkers = useRef(0);

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

  function addRows(items: { value: string; name?: string }[], source: string) {
    const parsed = dedupeInputs(items);
    const existing = new Set(leads.map((l) => l.domain));
    const fresh = parsed.rows.filter((r) => !existing.has(r.domain));
    const alreadyHave = parsed.rows.length - fresh.length;
    setLeads((ls) => [...ls, ...fresh.map((r): Lead => ({ domain: r.domain, inputName: r.name, status: "queued" }))]);
    const parts = [`${fresh.length} new lead${fresh.length === 1 ? "" : "s"} queued from ${source}`];
    if (parsed.duplicates + alreadyHave) parts.push(`${parsed.duplicates + alreadyHave} duplicate${parsed.duplicates + alreadyHave === 1 ? "" : "s"} merged`);
    if (parsed.invalid.length) parts.push(`${parsed.invalid.length} invalid skipped (${parsed.invalid.slice(0, 3).join(", ")}${parsed.invalid.length > 3 ? "…" : ""})`);
    setNotice(parts.join(" · "));
  }

  function importCsvText(text: string, source: string) {
    const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
    const headers = res.meta.fields ?? [];
    const { domainCol, nameCol } = guessColumns(headers);
    if (!domainCol) {
      // No header we recognise: treat it as a plain list.
      addRows(text.split(/[\n,;]+/).map((value) => ({ value })), source);
      return;
    }
    addRows(res.data.map((r) => ({ value: r[domainCol] ?? "", name: nameCol ? r[nameCol] : undefined })), source);
  }

  async function onFile(f: File) {
    importCsvText(await f.text(), f.name);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function loadSample() {
    const text = await fetch("/sample-leads.csv").then((r) => r.text());
    importCsvText(text, "sample dataset");
  }

  const scores = useMemo(() => {
    const m = new Map<string, LeadScore>();
    for (const l of leads) if (l.data) m.set(l.domain, scoreLead(l.data, icp));
    return m;
  }, [leads, icp]);

  const rows: Row[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    const nowYear = new Date().getFullYear();
    const filtered = leads
      .map((lead) => ({ lead, score: scores.get(lead.domain) ?? null }))
      .filter(({ lead, score }) => {
        if (q && !`${lead.domain} ${lead.data?.name ?? ""} ${lead.inputName ?? ""} ${lead.data?.industry ?? ""} ${lead.data?.location ?? ""}`.toLowerCase().includes(q)) return false;
        const filtering = tiers.size || minScore > 0 || needEmail || needPhone;
        if (!score) return !filtering; // keep in-flight rows visible unless filters are on
        if (tiers.size && !tiers.has(score.tier)) return false;
        if (score.total < minScore) return false;
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
  }, [leads, scores, search, tiers, minScore, needEmail, needPhone, sort]);

  const done = leads.filter((l) => l.status === "done");
  const pending = leads.filter((l) => l.status === "queued" || l.status === "running").length;
  const failed = leads.filter((l) => l.status === "error").length;
  const scoredList = [...scores.values()];
  const avg = scoredList.length ? Math.round(scoredList.reduce((s, x) => s + x.total, 0) / scoredList.length) : 0;
  const priority = scoredList.filter((s) => s.tier === "A" || s.tier === "B").length;
  const reachable = done.filter((l) => l.data!.emails.some((e) => e.status === "deliverable-domain") || l.data!.phones.length).length;
  const exportable = rows.filter((r): r is { lead: Lead; score: LeadScore } => r.score !== null);
  const selectedLead = selected ? leads.find((l) => l.domain === selected) : undefined;

  const toggleTier = (t: LeadScore["tier"]) =>
    setTiers((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  const onSort = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "name" ? 1 : -1 }));

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-lg font-bold text-white dark:text-black">L</div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">LeadScout</h1>
            <p className="text-xs text-muted">Enrich, verify and rank SaaSquatch leads by acquisition fit</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className={`h-2 w-2 rounded-full ${aiEnabled ? "bg-tier-a" : "bg-tier-d"}`} />
          {aiEnabled === null ? "Checking AI…" : aiEnabled ? "AI briefs on" : "AI briefs off (rules-only)"}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        {/* Sidebar */}
        <div className="space-y-5">
          <Card className="p-4">
            <SectionTitle hint="CSV or list">1 · Import leads</SectionTitle>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={"acmeplumbing.com\nhttps://www.example-hvac.com/about\nowner@smithmachining.com"}
              rows={5}
              className="w-full resize-y rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-xs outline-none placeholder:text-muted/70 focus:border-accent"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={!input.trim()}
                onClick={() => { importCsvText(input, "pasted list"); setInput(""); }}
              >
                Add & enrich
              </Button>
              <Button onClick={() => fileRef.current?.click()}>Upload CSV</Button>
              <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              <Button variant="ghost" onClick={loadSample}>Load sample</Button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              Works with SaaSquatch exports: we detect the website/domain column, normalise URLs and emails to domains, and merge duplicates.
            </p>
            {notice && <p className="mt-2 rounded-md bg-accent-soft px-2.5 py-1.5 text-xs text-accent">{notice}</p>}
          </Card>

          <Card className="p-4">
            <SectionTitle hint="re-ranks instantly">2 · Your buy-box</SectionTitle>
            <div className="text-xs font-medium text-muted">Target industries</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {INDUSTRIES.map((ind) => {
                const on = icp.industries.includes(ind);
                return (
                  <button
                    key={ind}
                    onClick={() => setIcp((s) => ({ ...s, industries: on ? s.industries.filter((x) => x !== ind) : [...s.industries, ind] }))}
                    className={`rounded-full border px-2 py-0.5 text-[11px] transition ${on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink"}`}
                  >
                    {ind}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 text-xs font-medium text-muted">Keywords</div>
            <form
              className="mt-1.5 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const k = keywordDraft.trim();
                if (k && !icp.keywords.includes(k)) setIcp((s) => ({ ...s, keywords: [...s.keywords, k] }));
                setKeywordDraft("");
              }}
            >
              <input
                value={keywordDraft}
                onChange={(e) => setKeywordDraft(e.target.value)}
                placeholder="e.g. commercial, B2B"
                className="min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-xs outline-none focus:border-accent"
              />
              <Button type="submit" className="!py-1.5 text-xs">Add</Button>
            </form>
            {icp.keywords.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {icp.keywords.map((k) => (
                  <button key={k} onClick={() => setIcp((s) => ({ ...s, keywords: s.keywords.filter((x) => x !== k) }))} title="Remove">
                    <Chip tone="accent">{k} ×</Chip>
                  </button>
                ))}
              </div>
            )}
            <div className="mt-4 flex items-center justify-between text-xs font-medium text-muted">
              <span>Minimum years in business</span>
              <span className="font-mono text-ink">{icp.minYears}+</span>
            </div>
            <input type="range" min={0} max={40} step={1} value={icp.minYears} onChange={(e) => setIcp((s) => ({ ...s, minYears: +e.target.value }))} className="mt-1 w-full" />
          </Card>

          <Card className="p-4">
            <SectionTitle>3 · Outreach signature</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              <input value={sender.name ?? ""} onChange={(e) => setSender((s) => ({ ...s, name: e.target.value }))} placeholder="Your name"
                className="min-w-0 rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-xs outline-none focus:border-accent" />
              <input value={sender.firm ?? ""} onChange={(e) => setSender((s) => ({ ...s, firm: e.target.value }))} placeholder="Firm"
                className="min-w-0 rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-xs outline-none focus:border-accent" />
            </div>
          </Card>
        </div>

        {/* Main */}
        <div className="min-w-0 space-y-5">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Stat label="Leads enriched" value={done.length} sub={pending ? `${pending} in progress` : failed ? `${failed} failed` : `${leads.length} total`} />
            <Stat label="Priority (tier A/B)" value={priority} sub={done.length ? `${Math.round((priority / done.length) * 100)}% of enriched` : "-"} />
            <Stat label="Reachable" value={reachable} sub="verified email or phone" />
            <Stat label="Average score" value={avg || "-"} sub="out of 100" />
          </div>

          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search company, industry, city…"
                className="min-w-[180px] flex-1 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-sm outline-none focus:border-accent"
              />
              <div className="flex gap-1">
                {(["A", "B", "C", "D"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => toggleTier(t)}
                    className={`h-8 w-8 rounded-lg border text-xs font-semibold transition ${tiers.has(t) ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink"}`}
                    title={`Tier ${t}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs text-muted">
                Min
                <input type="range" min={0} max={90} step={5} value={minScore} onChange={(e) => setMinScore(+e.target.value)} className="w-20" />
                <span className="w-5 font-mono text-ink">{minScore}</span>
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
                <input type="checkbox" checked={needEmail} onChange={(e) => setNeedEmail(e.target.checked)} className="accent-[var(--accent)]" /> Email
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
                <input type="checkbox" checked={needPhone} onChange={(e) => setNeedPhone(e.target.checked)} className="accent-[var(--accent)]" /> Phone
              </label>
              <div className="ml-auto flex gap-2">
                <Button disabled={!exportable.length} onClick={() => exportCsv(exportable)} title="Export the filtered view">
                  Export CSV
                </Button>
                <Button disabled={!exportable.length} onClick={() => exportHubspot(exportable)} title="HubSpot import format">
                  HubSpot CSV
                </Button>
              </div>
            </div>

            {leads.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-16 text-center">
                <div className="text-sm font-medium">No leads yet</div>
                <p className="mt-1 max-w-sm text-sm text-muted">
                  Paste domains or upload a SaaSquatch CSV export. Each company&apos;s public site is crawled politely, contacts are verified, and leads are ranked by acquisition fit.
                </p>
                <Button variant="primary" className="mt-4" onClick={loadSample}>Try the sample dataset</Button>
              </div>
            ) : rows.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted">No leads match these filters.</div>
            ) : (
              <LeadTable rows={rows} sort={sort} onSort={onSort} onSelect={setSelected} selected={selected} onRetry={(d) => enrichOne(d)} />
            )}

            {leads.length > 0 && (
              <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-muted">
                <span>Showing {rows.length} of {leads.length}</span>
                <button
                  className="hover:text-danger"
                  onClick={() => { if (confirm("Clear all leads from this browser?")) { setLeads([]); setSelected(null); setNotice(null); } }}
                >
                  Clear list
                </button>
              </div>
            )}
          </Card>

          <p className="text-[11px] leading-relaxed text-muted">
            Scores combine reachability (35), acquisition fit (40), buy-box match (15) and data confidence (10). LeadScout only reads public company websites, honours robots.txt, identifies itself with a bot user-agent and caches results for 7 days to avoid repeat crawling.
          </p>
        </div>
      </div>

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
    </div>
  );
}
