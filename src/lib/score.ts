// Transparent, deterministic scoring. Pure functions with no I/O, so the
// dashboard can re-rank instantly when the buy-box changes and the same code is
// unit-tested.
//
// The score is a heuristic for *acquisition fit and reachability*. It is not a
// probability of a deal and not evidence that a company is for sale.

import type { Confidence, Enrichment, IcpSettings, LeadScore, NextAction, ScoreComponent } from "./types";

/** Every weight and threshold lives here. Component maxima must sum to 100. */
export const SCORING = {
  reach: {
    max: 35,
    mailReadyEmail: 12,
    emailNoMx: 3,
    directInbox: 8,
    phone: 8,
    decisionMaker: 4,
    linkedin: 3,
  },
  fit: {
    max: 40,
    years: { gte20: 15, gte10: 11, gte5: 6, under5: 2, unknown: 5 },
    /** Multiplier when the founding year is inferred ("over 30 years") rather than stated. */
    inferredYearsFactor: 0.8,
    ownershipStated: 10,
    ownershipInferred: 6,
    longTenure: 5,
    longTenureYears: 20,
    digital: { staleSite: 4, noMarketingAutomation: 3, diyOrNoBooking: 3, staleAfterYears: 2 },
  },
  icp: {
    max: 15,
    /** Used when no buy-box criteria are configured, so nobody is penalised. */
    neutral: 8,
    weights: { industry: 7, keywords: 4, preferences: 4 },
    belowMinYearsPenalty: 5,
  },
  confidence: {
    max: 10,
    perConfidence: { high: 1, medium: 0.75, low: 0.4 } satisfies Record<Confidence, number>,
  },
  tiers: { A: 70, B: 50, C: 30 },
} as const;

export const INDUSTRIES = [
  "Home Services", "Construction", "Manufacturing", "Healthcare", "Professional Services",
  "IT Services", "Software", "Logistics", "Food & Beverage", "Retail & E-commerce",
  "Marketing Agency", "Insurance", "Education",
] as const;

export const DEFAULT_ICP: IcpSettings = {
  industries: [],
  keywords: [],
  minYears: 10,
  prefer: { familyOwned: false, ownerOperated: false, directContact: false },
};

const DIY_BUILDERS = ["Wix", "Squarespace", "GoDaddy Builder"];
const MARTECH = ["HubSpot", "Salesforce", "Intercom", "Drift", "Meta Pixel"];

export function tierFor(total: number): LeadScore["tier"] {
  const t = SCORING.tiers;
  return total >= t.A ? "A" : total >= t.B ? "B" : total >= t.C ? "C" : "D";
}

export function yearsInBusiness(d: Enrichment, nowYear = new Date().getFullYear()): number | null {
  return d.foundedYear ? nowYear - d.foundedYear : null;
}

export function hasDirectContact(d: Enrichment): boolean {
  return d.emails.some((e) => e.status === "mx-ok" && !e.isRole);
}

export function scoreLead(d: Enrichment, icpIn: IcpSettings, nowYear = new Date().getFullYear()): LeadScore {
  // Older saved settings may predate `prefer`.
  const icp: IcpSettings = { ...icpIn, prefer: { ...DEFAULT_ICP.prefer, ...icpIn.prefer } };
  const age = yearsInBusiness(d, nowYear);
  const ev = d.evidence;
  const S = SCORING;

  // 1. Reachability: can a buyer actually start a conversation with the owner?
  const reach: ScoreComponent = { key: "reach", label: "Reachability", points: 0, max: S.reach.max, reasons: [], caveats: [] };
  const mailReady = d.emails.filter((e) => e.status === "mx-ok");
  if (mailReady.length) {
    reach.points += S.reach.mailReadyEmail;
    reach.reasons.push(`Email on a mail-ready domain: ${mailReady[0].address}`);
    reach.caveats.push("MX records show the domain accepts mail; the specific mailbox is not verified.");
  } else if (d.emails.length) {
    reach.points += S.reach.emailNoMx;
    reach.reasons.push("Email found, but its domain publishes no mail servers");
  } else reach.reasons.push("No email address published on the site");
  if (hasDirectContact(d)) { reach.points += S.reach.directInbox; reach.reasons.push("Named inbox, not only info@/sales@"); }
  if (d.phones.length) { reach.points += S.reach.phone; reach.reasons.push(`Phone ${d.phones[0].display}`); }
  if (d.people.length) {
    const p = d.people[0];
    reach.points += S.reach.decisionMaker;
    reach.reasons.push(`Decision-maker named: ${p.name} (${p.title})`);
    if (p.evidence.method === "inferred") reach.caveats.push(`"${p.name}" was matched from page text and may be misread.`);
  }
  if (d.socials.linkedin) { reach.points += S.reach.linkedin; reach.reasons.push("LinkedIn company page linked"); }

  // 2. Acquisition fit: maturity, ownership, tenure and observable improvement levers.
  const fit: ScoreComponent = { key: "fit", label: "Acquisition fit", points: 0, max: S.fit.max, reasons: [], caveats: [] };
  const Y = S.fit.years;
  if (age === null) {
    fit.points += Y.unknown;
    fit.reasons.push("Years in business unknown (scored neutral-low, not as a negative)");
  } else {
    const base = age >= 20 ? Y.gte20 : age >= 10 ? Y.gte10 : age >= 5 ? Y.gte5 : Y.under5;
    const inferred = ev.foundedYear?.method === "inferred";
    fit.points += inferred ? Math.round(base * S.fit.inferredYearsFactor) : base;
    fit.reasons.push(inferred ? `About ${age}+ years in business (estimated)` : `${age} years in business (since ${d.foundedYear})`);
    if (inferred) fit.caveats.push("Founding year estimated from wording such as \"over 30 years\".");
  }

  const ownershipEv = ev.familyOwned ?? ev.ownerOperated;
  if (ownershipEv) {
    const stated = ownershipEv.method !== "inferred";
    fit.points += stated ? S.fit.ownershipStated : S.fit.ownershipInferred;
    fit.reasons.push(`${d.signals.familyOwned ? "Family-owned" : "Owner-operated"} (${stated ? "stated on site" : "inferred from a founder/owner title"})`);
  }
  if (age !== null && age >= S.fit.longTenureYears && ownershipEv) {
    fit.points += S.fit.longTenure;
    fit.reasons.push(`Long tenure under the same ownership type (${age} yrs)`);
    fit.caveats.push("Long tenure is not evidence that the owner plans to sell or retire.");
  }

  // Website observations that *may* indicate operational / digital levers.
  if (d.thinContent) {
    fit.caveats.push("Site had little server-rendered text (likely JavaScript-only), so website signals were not assessed.");
  } else {
    const D = S.fit.digital;
    const obs: string[] = [];
    let pts = 0;
    if (d.copyrightYear && d.copyrightYear <= nowYear - D.staleAfterYears) { pts += D.staleSite; obs.push(`footer © ${d.copyrightYear}`); }
    if (!d.tech.some((t) => MARTECH.includes(t))) { pts += D.noMarketingAutomation; obs.push("no marketing automation detected"); }
    const diy = d.tech.find((t) => DIY_BUILDERS.includes(t));
    if (diy || !d.signals.onlineBooking) { pts += D.diyOrNoBooking; obs.push(diy ? `built on ${diy}` : "no online booking detected"); }
    if (pts) {
      fit.points += pts;
      fit.reasons.push(`Possible improvement levers observed: ${obs.join(", ")}`);
      fit.caveats.push("Website observations only. They suggest, but do not prove, operational upside.");
    }
  }

  // 3. Buy-box match: configured criteria share the 15 points proportionally.
  const icpC: ScoreComponent = { key: "icp", label: "Buy-box match", points: 0, max: S.icp.max, reasons: [], caveats: [] };
  const W = S.icp.weights;
  const prefs = (Object.keys(icp.prefer) as (keyof IcpSettings["prefer"])[]).filter((k) => icp.prefer[k]);
  let available = 0;
  let earned = 0;
  if (icp.industries.length) {
    available += W.industry;
    if (d.industry && icp.industries.includes(d.industry)) {
      earned += W.industry;
      icpC.reasons.push(`Target industry: ${d.industry}`);
      if (ev.industry?.confidence === "low") icpC.caveats.push("Industry was inferred from a few keywords; confirm it.");
    } else icpC.reasons.push(d.industry ? `${d.industry} is not a target industry` : "Industry unknown");
  }
  if (icp.keywords.length) {
    available += W.keywords;
    const hay = `${d.name} ${d.description} ${d.industry ?? ""}`.toLowerCase();
    const hits = icp.keywords.filter((k) => k && hay.includes(k.toLowerCase()));
    if (hits.length) { earned += W.keywords; icpC.reasons.push(`Keyword match: ${hits.join(", ")}`); }
    else icpC.reasons.push("No keyword match in name or description");
  }
  if (prefs.length) {
    available += W.preferences;
    const label = { familyOwned: "Family-owned", ownerOperated: "Owner-operated", directContact: "Direct contact" } as const;
    const met = prefs.filter((k) => (k === "familyOwned" ? d.signals.familyOwned : k === "ownerOperated" ? d.signals.ownerOperated : hasDirectContact(d)));
    earned += (W.preferences * met.length) / prefs.length;
    icpC.reasons.push(`Preferences met: ${met.length}/${prefs.length}${met.length ? ` (${met.map((k) => label[k]).join(", ")})` : ""}`);
  }
  if (!available) {
    icpC.points = S.icp.neutral;
    icpC.reasons.push("No buy-box criteria set, so a neutral score is used");
  } else {
    icpC.points = Math.round((earned / available) * S.icp.max);
  }
  if (age !== null && age < icp.minYears) {
    icpC.points = Math.max(0, icpC.points - S.icp.belowMinYearsPenalty);
    icpC.reasons.push(`Below your ${icp.minYears}-year minimum`);
  } else if (age === null && icp.minYears > 0) {
    icpC.caveats.push(`Years in business unknown, so the ${icp.minYears}-year minimum could not be checked.`);
  }

  // 4. Data confidence: how much of the profile is backed by evidence, weighted by its quality.
  const C = S.confidence.perConfidence;
  const weigh = (e?: { confidence: Confidence }) => (e ? C[e.confidence] : 0);
  const fields: [string, number][] = [
    ["name", weigh(ev.name)],
    ["description", weigh(ev.description)],
    ["industry", weigh(ev.industry)],
    ["location", weigh(ev.location)],
    ["founding year", weigh(ev.foundedYear)],
    ["ownership", weigh(ev.familyOwned ?? ev.ownerOperated)],
    ["contact", d.emails.length || d.phones.length ? 1 : 0],
    ["decision-maker", d.people[0] ? C[d.people[0].evidence.confidence] : 0],
  ];
  const sum = fields.reduce((s, [, v]) => s + v, 0);
  const missing = fields.filter(([, v]) => v === 0).map(([k]) => k);
  const conf: ScoreComponent = {
    key: "confidence", label: "Data confidence", max: S.confidence.max,
    points: Math.round((sum / fields.length) * S.confidence.max),
    reasons: [`${fields.length - missing.length}/${fields.length} key facts found across ${d.pagesCrawled.length} page(s)`],
    caveats: missing.length ? [`Unknown: ${missing.join(", ")}`] : [],
  };

  const components = [reach, fit, icpC, conf].map((c) => ({ ...c, points: Math.max(0, Math.min(Math.round(c.points), c.max)) }));
  const total = components.reduce((s, c) => s + c.points, 0);
  return { total, tier: tierFor(total), components };
}

/** Concrete research steps for a buyer, most important first. */
export function nextActions(d: Enrichment, score: LeadScore, nowYear = new Date().getFullYear()): NextAction[] {
  const out: NextAction[] = [];
  const age = yearsInBusiness(d, nowYear);
  const mailReady = d.emails.some((e) => e.status === "mx-ok");
  const ownership = d.evidence.familyOwned ?? d.evidence.ownerOperated;

  if (!mailReady && !d.phones.length) {
    out.push({ title: "Find a contact route", why: "No mail-ready email or phone number is published on the site." });
  } else if (score.tier === "A" && (hasDirectContact(d) || d.people.length)) {
    out.push({ title: "Prioritise outreach", why: "Strong fit with a direct route to a decision-maker." });
  }
  if (!d.people.length) out.push({ title: "Identify the owner", why: "No owner or decision-maker is named on the site." });
  else if (d.people[0].evidence.method === "inferred") out.push({ title: `Confirm ${d.people[0].name}'s role`, why: "Name and title were matched from page text." });
  if (mailReady && !hasDirectContact(d)) out.push({ title: "Reach a named contact", why: "Only generic inboxes (e.g. info@) were found." });
  if (age === null) out.push({ title: "Establish business longevity", why: "No founding year was found on the site." });
  else if (d.evidence.foundedYear?.method === "inferred") out.push({ title: "Confirm founding year", why: "Estimated from wording, not stated explicitly." });
  if (!ownership) out.push({ title: "Verify ownership structure", why: "No family-owned or owner-operated statement was found." });
  else if (age !== null && age >= SCORING.fit.longTenureYears) {
    out.push({
      title: "Ask about long-term plans",
      why: `${age} years under ${d.signals.familyOwned ? "family" : "owner"} ownership. There is no public evidence of succession or sale plans; ask before assuming either.`,
    });
  }
  const fit = score.components.find((c) => c.key === "fit");
  if (fit?.reasons.some((r) => r.startsWith("Possible improvement levers"))) {
    out.push({ title: "Research operational improvements", why: "The website suggests room for digital or process upgrades." });
  }
  return out.slice(0, 4);
}
