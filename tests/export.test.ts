import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { buildCsv, buildHubspotCsv, type Scored } from "@/lib/export";
import { DEFAULT_ICP, scoreLead } from "@/lib/score";
import type { Lead } from "@/lib/types";
import { makeEnrichment, strongLead } from "./fixtures";

function scored(lead: Lead): Scored {
  return { lead, score: scoreLead(lead.data!, DEFAULT_ICP, 2026) };
}
const parse = (csv: string) => Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true }).data;

describe("buildCsv", () => {
  it("writes one row per lead in the given (filtered) order", () => {
    const rows = [
      scored({ domain: "acme.com", status: "done", data: strongLead() }),
      scored({ domain: "beta.io", status: "done", data: makeEnrichment({ domain: "beta.io", name: "Beta" }) }),
    ];
    const out = parse(buildCsv(rows, 2026));
    expect(out.map((r) => r.Domain)).toEqual(["acme.com", "beta.io"]);
    expect(out[0].Tier).toBe("A");
    expect(out[0]["Founded Evidence"]).toBe("stated/high");
    expect(out[1].Industry).toBe("Unknown");
    expect(out[0]["Next Action"]).toMatch(/^Prioritise outreach/);
  });

  it("round-trips commas, quotes and newlines", () => {
    const tricky = makeEnrichment({ name: 'Smith, Jones & "Sons"', description: "line one\nline two" });
    const out = parse(buildCsv([scored({ domain: "acme.com", status: "done", data: tricky })]));
    expect(out[0].Company).toBe('Smith, Jones & "Sons"');
  });

  it("neutralises spreadsheet formula injection", () => {
    const evil = makeEnrichment({ name: '=HYPERLINK("http://evil")' });
    const out = parse(buildCsv([scored({ domain: "acme.com", status: "done", data: evil })]));
    expect(out[0].Company.startsWith("'=")).toBe(true);
  });

  it("returns empty output for an empty selection", () => {
    expect(buildCsv([]).trim()).toBe("");
  });
});

describe("buildHubspotCsv", () => {
  it("uses HubSpot property names and splits the contact name", () => {
    const out = parse(buildHubspotCsv([scored({ domain: "acme.com", status: "done", data: strongLead() })]));
    expect(out[0]["Company Domain Name"]).toBe("acme.com");
    expect(out[0]["First Name"]).toBe("Bob");
    expect(out[0]["Last Name"]).toBe("Smith");
    expect(out[0].City).toBe("Dayton");
    expect(out[0]["State/Region"]).toBe("OH");
  });
});
