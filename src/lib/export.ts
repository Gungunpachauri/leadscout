import Papa from "papaparse";
import { nextActions } from "./score";
import type { Evidence, Lead, LeadScore } from "./types";

export type Scored = { lead: Lead; score: LeadScore };

const UNKNOWN = "Unknown";

function bestEmail(l: Lead) {
  return l.data?.emails.find((e) => e.status === "mx-ok")?.address ?? l.data?.emails[0]?.address ?? "";
}

function splitName(full?: string) {
  if (!full) return ["", ""];
  const parts = full.trim().split(/\s+/);
  return [parts[0], parts.slice(1).join(" ")];
}

const fmtEvidence = (e?: Evidence) => (e ? `${e.method}/${e.confidence}` : UNKNOWN);

/** Neutralise spreadsheet formula injection (cells starting with = + - @). */
function safeCell(v: unknown): string | number {
  if (typeof v === "number") return v;
  const s = String(v ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function toCsv(records: Record<string, unknown>[]): string {
  const clean = records.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safeCell(v)])));
  return Papa.unparse(clean, { quotes: false, newline: "\r\n" });
}

export function buildCsv(rows: Scored[], nowYear = new Date().getFullYear()): string {
  return toCsv(
    rows.map(({ lead: l, score: s }) => {
      const d = l.data;
      const comp = (k: string) => s.components.find((c) => c.key === k)!;
      const actions = d ? nextActions(d, s, nowYear) : [];
      return {
        Company: d?.name ?? l.inputName ?? l.domain,
        Domain: l.domain,
        Score: s.total,
        Tier: s.tier,
        Reachability: `${comp("reach").points}/${comp("reach").max}`,
        "Acquisition Fit": `${comp("fit").points}/${comp("fit").max}`,
        "Buy-box Match": `${comp("icp").points}/${comp("icp").max}`,
        "Data Confidence": `${comp("confidence").points}/${comp("confidence").max}`,
        Industry: d?.industry ?? UNKNOWN,
        "Industry Evidence": fmtEvidence(d?.evidence.industry),
        Location: d?.location ?? UNKNOWN,
        Founded: d?.foundedYear ?? UNKNOWN,
        "Founded Evidence": fmtEvidence(d?.evidence.foundedYear),
        "Founded Source": d?.evidence.foundedYear?.snippet ?? "",
        Ownership: d?.signals.familyOwned ? "Family-owned" : d?.signals.ownerOperated ? "Owner-operated" : UNKNOWN,
        "Ownership Evidence": fmtEvidence(d?.evidence.familyOwned ?? d?.evidence.ownerOperated),
        "Best Email": bestEmail(l),
        "Email Domain MX": d?.emails[0] ? (d.emails[0].status === "mx-ok" ? "Yes (mailbox not verified)" : "No") : "",
        Phone: d?.phones[0]?.display ?? "",
        "Decision Maker": d?.people[0] ? `${d.people[0].name} (${d.people[0].title})` : UNKNOWN,
        LinkedIn: d?.socials.linkedin ?? "",
        "Next Action": actions[0] ? `${actions[0].title}: ${actions[0].why}` : "",
        "Score Reasons": s.components.map((c) => `${c.label}: ${c.reasons.join("; ")}`).join(" | "),
        Caveats: s.components.flatMap((c) => c.caveats).join(" | "),
        "AI Fit (1-10)": l.ai?.fitRating ?? "",
      };
    }),
  );
}

/** Column names match HubSpot's default company + contact import properties. */
export function buildHubspotCsv(rows: Scored[]): string {
  return toCsv(
    rows.map(({ lead: l, score: s }) => {
      const d = l.data;
      const [first, last] = splitName(d?.people[0]?.name);
      const [city, state] = (d?.location ?? "").split(",").map((x) => x.trim());
      return {
        "Company name": d?.name ?? l.inputName ?? l.domain,
        "Company Domain Name": l.domain,
        Industry: d?.industry ?? "",
        City: city ?? "",
        "State/Region": state ?? "",
        "Year Founded": d?.foundedYear ?? "",
        "Phone Number": d?.phones[0]?.e164 ?? "",
        "LinkedIn Company Page": d?.socials.linkedin ?? "",
        "First Name": first,
        "Last Name": last,
        "Job Title": d?.people[0]?.title ?? "",
        Email: bestEmail(l),
        "Lead Status": "NEW",
        "HubSpot Score": s.total,
        Description: `LeadScout tier ${s.tier} (${s.total}/100). ${l.ai?.summary ?? d?.description ?? ""}`.trim(),
      };
    }),
  );
}

function download(filename: string, csv: string) {
  // BOM so Excel opens UTF-8 correctly.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const stamp = () => new Date().toISOString().slice(0, 10);
export const exportCsv = (rows: Scored[]) => download(`leadscout-${stamp()}.csv`, buildCsv(rows));
export const exportHubspot = (rows: Scored[]) => download(`leadscout-hubspot-${stamp()}.csv`, buildHubspotCsv(rows));

/** Deterministic outreach draft for when AI isn't configured, built only from scraped facts. */
export function templateEmail(l: Lead, sender: { name?: string; firm?: string }) {
  const d = l.data!;
  // Only greet by name when the site itself published it in structured data.
  const person = d.people.find((p) => p.evidence.method === "structured");
  const first = person?.name.split(" ")[0];
  const age =
    d.foundedYear && d.evidence.foundedYear?.method !== "inferred" ? new Date().getFullYear() - d.foundedYear : null;
  const legacy =
    age && age >= 10
      ? `${age} years of serving ${d.location ? `the ${d.location.split(",")[0]} community` : "your customers"}`
      : "what you've built";
  return {
    subject: `${d.name}: a quick question`,
    body: `Hi ${first ?? "there"},

I came across ${d.name} and was impressed by ${legacy}.

I'm ${sender.name || "[Your Name]"} with ${sender.firm || "[Your Firm]"}. We partner with established, owner-led ${d.industry ? d.industry.toLowerCase() + " " : ""}businesses, whether that means growth support or thinking through a long-term transition on the owner's terms.

Would you be open to a 15-minute call in the next couple of weeks? No pressure either way.

Best,
${sender.name || "[Your Name]"}`,
  };
}
