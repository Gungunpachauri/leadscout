import { describe, expect, it } from "vitest";
import { DEFAULT_ICP, SCORING, nextActions, scoreLead, tierFor } from "@/lib/score";
import type { IcpSettings } from "@/lib/types";
import { inferred, makeEnrichment, stated, strongLead } from "./fixtures";

const NOW = 2026;
const comp = (s: ReturnType<typeof scoreLead>, k: string) => s.components.find((c) => c.key === k)!;

describe("SCORING config", () => {
  it("component maxima sum to 100", () => {
    expect(SCORING.reach.max + SCORING.fit.max + SCORING.icp.max + SCORING.confidence.max).toBe(100);
  });

  it("maps totals to tiers at the documented thresholds", () => {
    expect([100, 70, 69, 50, 49, 30, 29, 0].map(tierFor)).toEqual(["A", "A", "B", "B", "C", "C", "D", "D"]);
  });
});

describe("scoreLead", () => {
  it("is deterministic and stays within component bounds", () => {
    const a = scoreLead(strongLead(), DEFAULT_ICP, NOW);
    const b = scoreLead(strongLead(), DEFAULT_ICP, NOW);
    expect(a).toEqual(b);
    for (const c of a.components) {
      expect(c.points).toBeGreaterThanOrEqual(0);
      expect(c.points).toBeLessThanOrEqual(c.max);
    }
    expect(a.total).toBe(a.components.reduce((s, c) => s + c.points, 0));
  });

  it("ranks a reachable, long-tenured family business as tier A", () => {
    const s = scoreLead(strongLead(), DEFAULT_ICP, NOW);
    expect(s.tier).toBe("A");
    expect(comp(s, "reach").points).toBe(SCORING.reach.max);
  });

  it("scores an empty profile low without crashing", () => {
    const s = scoreLead(makeEnrichment(), DEFAULT_ICP, NOW);
    expect(s.tier).toBe("D");
    expect(comp(s, "reach").points).toBe(0);
  });

  it("uses a neutral buy-box score when no criteria are set", () => {
    const s = scoreLead(strongLead(), { ...DEFAULT_ICP, minYears: 0 }, NOW);
    expect(comp(s, "icp").points).toBe(SCORING.icp.neutral);
  });

  it("re-ranks when the buy-box changes, without new data", () => {
    const lead = strongLead();
    const match: IcpSettings = { ...DEFAULT_ICP, industries: ["Home Services"] };
    const miss: IcpSettings = { ...DEFAULT_ICP, industries: ["Software"] };
    expect(comp(scoreLead(lead, match, NOW), "icp").points).toBe(SCORING.icp.max);
    expect(comp(scoreLead(lead, miss, NOW), "icp").points).toBe(0);
  });

  it("shares buy-box points across configured criteria", () => {
    const icp: IcpSettings = { ...DEFAULT_ICP, industries: ["Home Services"], keywords: ["software"] };
    // Industry (7) matched, keywords (4) not: round(7/11 * 15) = 10.
    expect(comp(scoreLead(strongLead(), icp, NOW), "icp").points).toBe(10);
  });

  it("applies preferred characteristics", () => {
    const icp: IcpSettings = { ...DEFAULT_ICP, prefer: { familyOwned: true, ownerOperated: false, directContact: true } };
    expect(comp(scoreLead(strongLead(), icp, NOW), "icp").points).toBe(SCORING.icp.max);
    const noFamily = { ...strongLead(), signals: { ...strongLead().signals, familyOwned: false } };
    expect(comp(scoreLead(noFamily, icp, NOW), "icp").points).toBeLessThan(SCORING.icp.max);
  });

  it("penalises leads below the minimum years", () => {
    const young = makeEnrichment({ foundedYear: 2022, evidence: { foundedYear: stated("since 2022") } });
    const reasons = comp(scoreLead(young, { ...DEFAULT_ICP, minYears: 10 }, NOW), "icp").reasons.join(" ");
    expect(reasons).toMatch(/Below your 10-year minimum/);
  });

  it("scores an inferred founding year below a stated one, with a caveat", () => {
    const base = { foundedYear: 1990 };
    const s1 = scoreLead(makeEnrichment({ ...base, evidence: { foundedYear: stated("since 1990") } }), DEFAULT_ICP, NOW);
    const s2 = scoreLead(makeEnrichment({ ...base, evidence: { foundedYear: inferred() } }), DEFAULT_ICP, NOW);
    expect(comp(s2, "fit").points).toBeLessThan(comp(s1, "fit").points);
    expect(comp(s2, "fit").caveats.join(" ")).toMatch(/estimated/i);
  });

  it("does not treat unknown years as a hard negative", () => {
    const s = scoreLead(makeEnrichment(), DEFAULT_ICP, NOW);
    expect(comp(s, "fit").points).toBeGreaterThanOrEqual(SCORING.fit.years.unknown);
  });

  it("caveats MX checks, long tenure and website observations", () => {
    const caveats = scoreLead(strongLead(), DEFAULT_ICP, NOW).components.flatMap((c) => c.caveats).join(" ");
    expect(caveats).toMatch(/mailbox is not verified/);
    expect(caveats).toMatch(/not evidence that the owner plans to sell/);
    expect(caveats).toMatch(/do not prove/);
  });

  it("skips website-based signals for JavaScript-only sites", () => {
    const s = scoreLead({ ...strongLead(), thinContent: true }, DEFAULT_ICP, NOW);
    expect(comp(s, "fit").reasons.join(" ")).not.toMatch(/improvement levers/);
  });

  it("tolerates saved settings without `prefer`", () => {
    const legacy = { industries: [], keywords: [], minYears: 10 } as unknown as IcpSettings;
    expect(() => scoreLead(strongLead(), legacy, NOW)).not.toThrow();
  });
});

describe("score explanation integrity", () => {
  it("components always sum to the total, across buy-box changes", () => {
    const icps: IcpSettings[] = [
      DEFAULT_ICP,
      { ...DEFAULT_ICP, industries: ["Home Services"], keywords: ["hvac"] },
      { ...DEFAULT_ICP, industries: ["Software"], minYears: 60 },
      { ...DEFAULT_ICP, prefer: { familyOwned: true, ownerOperated: true, directContact: true } },
    ];
    for (const d of [strongLead(), makeEnrichment()]) {
      for (const icp of icps) {
        const s = scoreLead(d, icp, NOW);
        expect(s.total).toBe(s.components.reduce((a, c) => a + c.points, 0));
        expect(s.tier).toBe(tierFor(s.total));
        expect(s.components.every((c) => c.reasons.length > 0)).toBe(true);
      }
    }
  });

  it("buy-box explanations change together with the points", () => {
    const miss = comp(scoreLead(strongLead(), { ...DEFAULT_ICP, industries: ["Software"] }, NOW), "icp");
    const hit = comp(scoreLead(strongLead(), { ...DEFAULT_ICP, industries: ["Home Services"] }, NOW), "icp");
    expect(miss.reasons.join()).toMatch(/not a target industry/);
    expect(hit.reasons.join()).toMatch(/Target industry: Home Services/);
  });
});

describe("nextActions", () => {
  it("never asserts a sale or retirement", () => {
    const d = strongLead();
    const text = nextActions(d, scoreLead(d, DEFAULT_ICP, NOW), NOW).map((a) => `${a.title} ${a.why}`).join(" ");
    expect(text).not.toMatch(/for sale|retir(e|ing)|wants to sell/i);
  });

  it("asks for a contact route when none exists", () => {
    const d = makeEnrichment();
    expect(nextActions(d, scoreLead(d, DEFAULT_ICP, NOW), NOW)[0].title).toBe("Find a contact route");
  });

  it("prioritises outreach for a tier A lead with a direct contact", () => {
    const d = strongLead();
    const titles = nextActions(d, scoreLead(d, DEFAULT_ICP, NOW), NOW).map((a) => a.title);
    expect(titles[0]).toBe("Prioritise outreach");
    expect(titles).toContain("Ask about long-term plans");
  });

  it("flags missing ownership and longevity evidence", () => {
    const d = makeEnrichment({ phones: [{ display: "(937) 555-0100", e164: "+19375550100", source: "x" }] });
    const titles = nextActions(d, scoreLead(d, DEFAULT_ICP, NOW), NOW).map((a) => a.title);
    expect(titles).toEqual(expect.arrayContaining(["Identify the owner", "Establish business longevity"]));
  });
});
