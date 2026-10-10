import { describe, expect, it } from "vitest";
import { buildPayload } from "@/lib/ai";
import { DEFAULT_ICP, scoreLead } from "@/lib/score";
import { analyzePages, parsePage } from "@/lib/scraper";
import { makeEnrichment, strongLead } from "./fixtures";

describe("AI payload", () => {
  it("splits website signals into detected / not detected instead of true/false", () => {
    const d = {
      ...strongLead(),
      signals: { familyOwned: true, ownerOperated: false, hiring: false, ecommerce: false, onlineBooking: false },
    };
    const p = buildPayload(d, scoreLead(d, DEFAULT_ICP, 2026), DEFAULT_ICP, {});
    const ws = p.company.websiteSignals;
    expect(ws.detected).toEqual(["family-owned wording"]);
    expect(ws.notDetected).toContain("online store (cart, checkout or commerce platform)");
    expect(ws.note).toMatch(/does NOT mean the business lacks it/);
    // No raw boolean signal object reaches the model.
    expect(JSON.stringify(p)).not.toMatch(/"ecommerce":\s*false|"ownerOperated":\s*false/);
  });

  it("spells out unknown facts", () => {
    const d = makeEnrichment();
    const c = buildPayload(d, scoreLead(d, DEFAULT_ICP, 2026), DEFAULT_ICP, {}).company;
    expect([c.industry, c.location, c.foundedYear, c.decisionMakers]).toEqual([
      "Unknown",
      "Unknown",
      "Unknown",
      "Unknown",
    ]);
  });
});

describe("e-commerce detection", () => {
  const facts = (html: string) => analyzePages("shop.com", [parsePage("https://shop.com/", html)], 2026);

  it("detects a JavaScript cart via a cart/checkout link", () => {
    expect(facts('<body><a href="/cart">Bag</a><p>Our story</p></body>').signals.ecommerce).toBe(true);
    expect(facts('<body><a href="https://shop.com/checkout/">Go</a></body>').signals.ecommerce).toBe(true);
  });

  it("detects commerce platforms from their fingerprints", () => {
    expect(facts('<script src="https://cdn.shopify.com/s/x.js"></script><body>Hi</body>').signals.ecommerce).toBe(true);
    expect(facts('<link href="/on/demandware.static/x.css"><body>Hi</body>').signals.ecommerce).toBe(true);
    const sfcc = facts('<link href="/on/demandware.static/x.css"><body>Hi</body>');
    expect(sfcc.tech).toContain("Salesforce Commerce Cloud");
  });

  it("does not flag a plain brochure site", () => {
    expect(facts('<body><a href="/about">About</a><p>We fix pipes.</p></body>').signals.ecommerce).toBe(false);
    // "/cartography" must not count as a cart link.
    expect(facts('<body><a href="/cartography">Maps</a></body>').signals.ecommerce).toBe(false);
  });
});
