// Shared types between the enrichment API and the dashboard.

/** Bump when the Enrichment shape changes so stale caches are re-crawled. */
export const ENRICHMENT_VERSION = 3;

/**
 * How a fact was established:
 * - "structured": schema.org / JSON-LD published by the site itself
 * - "stated": explicit wording on a page ("Family-owned since 1946")
 * - "inferred": heuristic (keyword counts, "over 30 years", page title)
 */
export type EvidenceMethod = "structured" | "stated" | "inferred";
export type Confidence = "high" | "medium" | "low";

export interface Evidence {
  method: EvidenceMethod;
  confidence: Confidence;
  /** Page the fact came from. */
  source: string;
  /** Short excerpt that supports the fact. */
  snippet: string;
}

export type FactKey = "name" | "description" | "industry" | "location" | "foundedYear" | "familyOwned" | "ownerOperated";

/** Mail-domain readiness only. An MX record does not prove a mailbox exists. */
export type EmailStatus = "mx-ok" | "no-mx";

export interface EmailContact {
  address: string;
  status: EmailStatus;
  /** Role inboxes (info@, sales@) are less valuable than a named person. */
  isRole: boolean;
  /** True when the email domain matches the company's own domain. */
  onDomain: boolean;
  source: string;
}

export interface PhoneContact {
  display: string;
  e164: string;
  source: string;
}

export interface PersonContact {
  name: string;
  title: string;
  evidence: Evidence;
}

export interface Socials {
  linkedin?: string;
  facebook?: string;
  instagram?: string;
  x?: string;
  youtube?: string;
}

/** Everything we managed to learn about one company from public pages. */
export interface Enrichment {
  version: number;
  domain: string;
  name: string;
  description: string;
  industry: string | null;
  location: string | null;
  foundedYear: number | null;
  copyrightYear: number | null;
  emails: EmailContact[];
  phones: PhoneContact[];
  people: PersonContact[];
  socials: Socials;
  tech: string[];
  signals: {
    familyOwned: boolean;
    ownerOperated: boolean;
    hiring: boolean;
    ecommerce: boolean;
    onlineBooking: boolean;
  };
  /** Supporting evidence for the facts we found. Absent key = unknown. */
  evidence: Partial<Record<FactKey, Evidence>>;
  pagesCrawled: string[];
  /** Pages we skipped because robots.txt disallowed them. */
  blockedByRobots: string[];
  /** True when pages had almost no server-rendered text (likely a JS-only site). */
  thinContent: boolean;
  scrapedAt: number;
}

export type LeadStatus = "queued" | "running" | "done" | "error";

export interface Lead {
  /** Normalised domain, used as the dedupe key. */
  domain: string;
  inputName?: string;
  status: LeadStatus;
  error?: string;
  cached?: boolean;
  data?: Enrichment;
  ai?: AiBrief;
}

export interface IcpSettings {
  industries: string[];
  keywords: string[];
  minYears: number;
  /** Preferred characteristics; each adds to the buy-box score when present. */
  prefer: { familyOwned: boolean; ownerOperated: boolean; directContact: boolean };
}

export interface ScoreComponent {
  key: "reach" | "fit" | "icp" | "confidence";
  label: string;
  points: number;
  max: number;
  reasons: string[];
  /** Caveats about what the points do *not* prove. */
  caveats: string[];
}

export interface LeadScore {
  total: number;
  tier: "A" | "B" | "C" | "D";
  components: ScoreComponent[];
}

export interface NextAction {
  title: string;
  why: string;
}

export interface AiBrief {
  summary: string;
  acquisitionThesis: string;
  improvementOpportunities: string[];
  diligenceQuestions: string[];
  uncertainties: string[];
  fitRating: number;
  email: { subject: string; body: string };
  model: string;
}
