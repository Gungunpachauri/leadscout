import Papa from "papaparse";
import type { Lead, LeadScore } from "./types";

type Scored = { lead: Lead; score: LeadScore };

function bestEmail(l: Lead) {
  return l.data?.emails.find((e) => e.status === "deliverable-domain")?.address ?? l.data?.emails[0]?.address ?? "";
}

function splitName(full?: string) {
  if (!full) return ["", ""];
  const parts = full.trim().split(/\s+/);
  return [parts[0], parts.slice(1).join(" ")];
}

function download(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export function exportCsv(rows: Scored[]) {
  const data = rows.map(({ lead: l, score: s }) => ({
    Company: l.data?.name ?? l.inputName ?? l.domain,
    Domain: l.domain,
    Score: s.total,
    Tier: s.tier,
    Industry: l.data?.industry ?? "",
    Location: l.data?.location ?? "",
    "Founded": l.data?.foundedYear ?? "",
    "Best Email": bestEmail(l),
    "All Emails": l.data?.emails.map((e) => e.address).join("; ") ?? "",
    Phone: l.data?.phones[0]?.display ?? "",
    "Decision Maker": l.data?.people[0] ? `${l.data.people[0].name} (${l.data.people[0].title})` : "",
    LinkedIn: l.data?.socials.linkedin ?? "",
    "Family Owned": l.data?.signals.familyOwned ? "Yes" : "No",
    "Owner Operated": l.data?.signals.ownerOperated ? "Yes" : "No",
    Tech: l.data?.tech.join("; ") ?? "",
    "Score Reasons": s.components.map((c) => `${c.label} ${c.points}/${c.max}: ${c.reasons.join(", ")}`).join(" | "),
    "AI Fit (1-10)": l.ai?.fitRating ?? "",
    "AI Thesis": l.ai?.acquisitionThesis ?? "",
  }));
  download(`leadscout-${stamp()}.csv`, Papa.unparse(data));
}

/** Column names match HubSpot's default company + contact import properties. */
export function exportHubspot(rows: Scored[]) {
  const data = rows.map(({ lead: l, score: s }) => {
    const [first, last] = splitName(l.data?.people[0]?.name);
    const [city, state] = (l.data?.location ?? "").split(",").map((x) => x.trim());
    return {
      "Company name": l.data?.name ?? l.inputName ?? l.domain,
      "Company Domain Name": l.domain,
      Industry: l.data?.industry ?? "",
      City: city ?? "",
      "State/Region": state ?? "",
      "Year Founded": l.data?.foundedYear ?? "",
      "Phone Number": l.data?.phones[0]?.e164 ?? "",
      "LinkedIn Company Page": l.data?.socials.linkedin ?? "",
      "First Name": first,
      "Last Name": last,
      "Job Title": l.data?.people[0]?.title ?? "",
      Email: bestEmail(l),
      "Lead Status": "NEW",
      "HubSpot Score": s.total,
      Description: `LeadScout tier ${s.tier} (${s.total}/100). ${l.ai?.summary ?? l.data?.description ?? ""}`.trim(),
    };
  });
  download(`leadscout-hubspot-${stamp()}.csv`, Papa.unparse(data));
}

/** Template email for when AI isn't configured, built only from scraped facts. */
export function templateEmail(l: Lead, sender: { name?: string; firm?: string }) {
  const d = l.data!;
  const first = d.people[0]?.name.split(" ")[0];
  const age = d.foundedYear ? new Date().getFullYear() - d.foundedYear : null;
  const legacy = age && age >= 10 ? `${age} years of serving ${d.location ? `the ${d.location.split(",")[0]} community` : "your customers"}` : "what you've built";
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
