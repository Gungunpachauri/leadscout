// Shared types between the enrichment API and the dashboard.

export type EmailStatus = "deliverable-domain" | "no-mx" | "invalid";

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
  source: string;
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
  pagesCrawled: string[];
  /** Pages we skipped because robots.txt disallowed them. */
  blockedByRobots: string[];
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
}

export interface ScoreComponent {
  key: "reach" | "fit" | "icp" | "confidence";
  label: string;
  points: number;
  max: number;
  reasons: string[];
}

export interface LeadScore {
  total: number;
  tier: "A" | "B" | "C" | "D";
  components: ScoreComponent[];
}

export interface AiBrief {
  summary: string;
  acquisitionThesis: string;
  risks: string[];
  fitRating: number;
  email: { subject: string; body: string };
  model: string;
}
