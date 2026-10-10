// Request validation for the API routes. Size limits keep client-supplied data
// (which ends up in the AI prompt) bounded.

import { z } from "zod";
import { INDUSTRIES } from "./score";

const str = (max: number) => z.string().max(max);
const url = z.string().max(2048);

const EvidenceSchema = z.object({
  method: z.enum(["structured", "stated", "inferred"]),
  confidence: z.enum(["high", "medium", "low"]),
  source: url,
  snippet: str(400),
});

export const IcpSchema = z.object({
  industries: z.array(z.enum(INDUSTRIES)).max(INDUSTRIES.length),
  keywords: z.array(str(60)).max(20),
  minYears: z.number().int().min(0).max(200),
  prefer: z
    .object({ familyOwned: z.boolean(), ownerOperated: z.boolean(), directContact: z.boolean() })
    .default({ familyOwned: false, ownerOperated: false, directContact: false }),
});

export const EnrichmentSchema = z.object({
  version: z.number(),
  domain: str(253).min(3),
  name: str(200),
  description: str(400),
  industry: str(60).nullable(),
  location: str(120).nullable(),
  foundedYear: z.number().int().nullable(),
  copyrightYear: z.number().int().nullable(),
  emails: z.array(z.object({
    address: str(254), status: z.enum(["mx-ok", "no-mx"]), isRole: z.boolean(), onDomain: z.boolean(), source: url,
  })).max(10),
  phones: z.array(z.object({ display: str(40), e164: str(20), source: url })).max(10),
  people: z.array(z.object({ name: str(80), title: str(80), evidence: EvidenceSchema })).max(10),
  socials: z.record(z.string(), url),
  tech: z.array(str(40)).max(30),
  signals: z.object({
    familyOwned: z.boolean(), ownerOperated: z.boolean(), hiring: z.boolean(), ecommerce: z.boolean(), onlineBooking: z.boolean(),
  }),
  evidence: z.object({
    name: EvidenceSchema.optional(),
    description: EvidenceSchema.optional(),
    industry: EvidenceSchema.optional(),
    location: EvidenceSchema.optional(),
    foundedYear: EvidenceSchema.optional(),
    familyOwned: EvidenceSchema.optional(),
    ownerOperated: EvidenceSchema.optional(),
  }),
  pagesCrawled: z.array(url).max(10),
  blockedByRobots: z.array(str(512)).max(10),
  thinContent: z.boolean(),
  scrapedAt: z.number(),
});

export const EnrichRequestSchema = z.object({
  domain: str(300).min(1),
  refresh: z.boolean().optional(),
});

export const BriefRequestSchema = z.object({
  data: EnrichmentSchema,
  icp: IcpSchema,
  sender: z.object({ name: str(80).optional(), firm: str(120).optional() }).default({}),
});

export function firstIssue(err: z.ZodError): string {
  const i = err.issues[0];
  return i ? `${i.path.join(".") || "body"}: ${i.message}` : "Invalid request";
}
