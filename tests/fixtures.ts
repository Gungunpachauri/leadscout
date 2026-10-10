import { ENRICHMENT_VERSION, type Enrichment, type Evidence } from "@/lib/types";

export const stated = (snippet = "since 1975"): Evidence => ({
  method: "stated",
  confidence: "high",
  source: "https://acme.com/about",
  snippet,
});
export const inferred = (snippet = "over 30 years"): Evidence => ({
  method: "inferred",
  confidence: "medium",
  source: "https://acme.com/",
  snippet,
});

/** A minimal, empty-ish enrichment; tests add only what they need. */
export function makeEnrichment(over: Partial<Enrichment> = {}): Enrichment {
  return {
    version: ENRICHMENT_VERSION,
    domain: "acme.com",
    name: "Acme",
    description: "",
    industry: null,
    location: null,
    foundedYear: null,
    copyrightYear: null,
    emails: [],
    phones: [],
    people: [],
    socials: {},
    tech: [],
    signals: { familyOwned: false, ownerOperated: false, hiring: false, ecommerce: false, onlineBooking: false },
    evidence: {},
    pagesCrawled: ["https://acme.com/"],
    blockedByRobots: [],
    thinContent: false,
    scrapedAt: Date.now(),
    ...over,
  };
}

/** A strong acquisition target: old, family-owned, reachable owner. */
export function strongLead(): Enrichment {
  return makeEnrichment({
    name: "Acme Plumbing",
    description: "Family-owned plumbing and HVAC since 1975.",
    industry: "Home Services",
    location: "Dayton, OH",
    foundedYear: 1975,
    copyrightYear: 2019,
    emails: [
      { address: "bob@acme.com", status: "mx-ok", isRole: false, onDomain: true, source: "https://acme.com/contact" },
    ],
    phones: [{ display: "(937) 555-0100", e164: "+19375550100", source: "https://acme.com/contact" }],
    people: [
      {
        name: "Bob Smith",
        title: "Owner",
        evidence: {
          method: "structured",
          confidence: "high",
          source: "https://acme.com/about",
          snippet: "schema.org founder: Bob Smith",
        },
      },
    ],
    socials: { linkedin: "https://linkedin.com/company/acme" },
    signals: { familyOwned: true, ownerOperated: true, hiring: false, ecommerce: false, onlineBooking: false },
    evidence: {
      name: {
        method: "structured",
        confidence: "high",
        source: "https://acme.com/",
        snippet: "schema.org name: Acme Plumbing",
      },
      description: stated("Meta description"),
      industry: {
        method: "structured",
        confidence: "high",
        source: "https://acme.com/",
        snippet: "schema.org @type: Plumber",
      },
      location: stated("Dayton, OH 45402"),
      foundedYear: stated("Family-owned since 1975"),
      familyOwned: stated("Family-owned since 1975"),
    },
    pagesCrawled: ["https://acme.com/", "https://acme.com/about", "https://acme.com/contact"],
  });
}
