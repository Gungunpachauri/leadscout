// Transparent, rule-based scoring. Pure function so the dashboard can re-rank
// instantly when the ICP changes, without re-scraping anything.
//
// The weighting reflects how a searcher / PE buyer qualifies an acquisition
// target: can I reach the owner, is this a mature owner-run business, is there
// operational/digital upside post-acquisition, and does it match my thesis?

import type { Enrichment, IcpSettings, LeadScore, ScoreComponent } from "./types";

export const INDUSTRIES = [
  "Home Services", "Construction", "Manufacturing", "Healthcare", "Professional Services",
  "IT Services", "Software", "Logistics", "Food & Beverage", "Retail & E-commerce",
  "Marketing Agency", "Insurance", "Education",
] as const;

export const DEFAULT_ICP: IcpSettings = { industries: [], keywords: [], minYears: 10 };

const DIY_BUILDERS = ["Wix", "Squarespace", "GoDaddy Builder"];
const MARTECH = ["HubSpot", "Salesforce", "Intercom", "Drift", "Meta Pixel"];

export function scoreLead(d: Enrichment, icp: IcpSettings, nowYear = new Date().getFullYear()): LeadScore {
  const age = d.foundedYear ? nowYear - d.foundedYear : null;

  // 1. Reachability (35): can a searcher actually start a conversation with the owner?
  const reach: ScoreComponent = { key: "reach", label: "Reachability", points: 0, max: 35, reasons: [] };
  const goodEmails = d.emails.filter((e) => e.status === "deliverable-domain");
  if (goodEmails.length) { reach.points += 12; reach.reasons.push(`Email on a mail-accepting domain (${goodEmails[0].address})`); }
  else if (d.emails.length) { reach.points += 3; reach.reasons.push("Email found but domain has no MX records"); }
  else reach.reasons.push("No email found");
  if (goodEmails.some((e) => !e.isRole)) { reach.points += 8; reach.reasons.push("Direct (named) inbox, not just info@"); }
  if (d.phones.length) { reach.points += 8; reach.reasons.push(`Phone ${d.phones[0].display}`); }
  if (d.people.length) { reach.points += 4; reach.reasons.push(`Decision-maker identified: ${d.people[0].name} (${d.people[0].title})`); }
  if (d.socials.linkedin) { reach.points += 3; reach.reasons.push("LinkedIn page"); }

  // 2. Acquisition fit (40): maturity, owner-operated, succession and value-creation upside.
  const fit: ScoreComponent = { key: "fit", label: "Acquisition fit", points: 0, max: 40, reasons: [] };
  if (age === null) { fit.points += 4; fit.reasons.push("Founding year unknown"); }
  else if (age >= 20) { fit.points += 15; fit.reasons.push(`Established ${age} years (since ${d.foundedYear})`); }
  else if (age >= 10) { fit.points += 11; fit.reasons.push(`${age} years in business`); }
  else if (age >= 5) { fit.points += 6; fit.reasons.push(`${age} years in business`); }
  else { fit.points += 2; fit.reasons.push(`Young business (${age} yrs)`); }

  if (d.signals.familyOwned || d.signals.ownerOperated) {
    fit.points += 10;
    fit.reasons.push(d.signals.familyOwned ? "Family-owned" : "Owner-operated");
  }
  if (age !== null && age >= 20 && (d.signals.familyOwned || d.signals.ownerOperated)) {
    fit.points += 5;
    fit.reasons.push("Long-tenured owner: possible succession opportunity");
  }

  // Digital upside: a dated or DIY web presence means post-acquisition AI/ops levers.
  let upside = 0;
  const upsideReasons: string[] = [];
  if (!d.copyrightYear || d.copyrightYear <= nowYear - 2) { upside += 4; upsideReasons.push(d.copyrightYear ? `site last updated ~${d.copyrightYear}` : "no copyright year"); }
  if (!d.tech.some((t) => MARTECH.includes(t))) { upside += 3; upsideReasons.push("no marketing automation"); }
  if (d.tech.some((t) => DIY_BUILDERS.includes(t)) || !d.signals.onlineBooking) { upside += 3; upsideReasons.push(d.tech.find((t) => DIY_BUILDERS.includes(t)) ? "DIY site builder" : "no online booking"); }
  fit.points += upside;
  if (upside) fit.reasons.push(`Digital upside: ${upsideReasons.join(", ")}`);

  // 3. ICP match (15): user-defined thesis.
  const icpC: ScoreComponent = { key: "icp", label: "Buy-box match", points: 0, max: 15, reasons: [] };
  const hasIcp = icp.industries.length > 0 || icp.keywords.length > 0;
  if (!hasIcp) { icpC.points = 8; icpC.reasons.push("No buy-box set: neutral score"); }
  else {
    if (d.industry && icp.industries.includes(d.industry)) { icpC.points += 10; icpC.reasons.push(`Target industry: ${d.industry}`); }
    else if (icp.industries.length) icpC.reasons.push(d.industry ? `Industry ${d.industry} not in target list` : "Industry not detected");
    const hay = `${d.name} ${d.description} ${d.industry ?? ""}`.toLowerCase();
    const kw = icp.keywords.filter((k) => k && hay.includes(k.toLowerCase()));
    if (kw.length) { icpC.points += 5; icpC.reasons.push(`Keyword match: ${kw.join(", ")}`); }
    if (!icp.industries.length && !kw.length) icpC.reasons.push("No keyword match");
  }
  if (age !== null && age < icp.minYears) { icpC.points = Math.max(0, icpC.points - 5); icpC.reasons.push(`Below minimum ${icp.minYears} years`); }

  // 4. Data confidence (10): how much of the profile is filled in.
  const fields = [d.name, d.description, d.industry, d.location, d.foundedYear, d.emails.length, d.phones.length, d.people.length];
  const filled = fields.filter(Boolean).length;
  const conf: ScoreComponent = {
    key: "confidence", label: "Data confidence", max: 10,
    points: Math.round((filled / fields.length) * 10),
    reasons: [`${filled}/${fields.length} profile fields found across ${d.pagesCrawled.length} page(s)`],
  };

  const components = [reach, fit, icpC, conf].map((c) => ({ ...c, points: Math.min(c.points, c.max) }));
  const total = components.reduce((s, c) => s + c.points, 0);
  const tier = total >= 70 ? "A" : total >= 50 ? "B" : total >= 30 ? "C" : "D";
  return { total, tier, components };
}
