// On-demand AI brief for a single lead: summary, acquisition thesis, risks and a
// personalised first-touch email. Only runs when the user asks for it, so API
// spend tracks the leads someone actually cares about (same idea as
// SaaSquatch's "only enrich the leads you want" credits).

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { AiBrief, Enrichment, IcpSettings, LeadScore } from "./types";

export const AI_MODEL = "claude-opus-5-5";

const BriefSchema = z.object({
  summary: z.string().describe("2-3 sentence plain-English description of what the business does and who it serves."),
  acquisitionThesis: z.string().describe("2-3 sentences on why this could be an attractive acquisition and the post-acquisition value-creation levers (operations, AI/automation, digital)."),
  risks: z.array(z.string()).describe("Up to 3 short diligence risks or open questions."),
  fitRating: z.number().int().describe("1-10 rating of fit for a searcher / PE buyer acquiring an established small business."),
  email: z.object({
    subject: z.string(),
    body: z.string().describe("Under 130 words. Warm, specific, no hype. Addressed to the owner by first name if known."),
  }),
});

export function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const SYSTEM = `You are an analyst at a search fund / private equity firm that acquires established, owner-operated small and mid-sized businesses and grows them with operational support and practical AI.
You are given structured data scraped from a company's public website plus a rule-based lead score. Write a concise acquisition brief and a first-touch outreach email to the owner.
Ground every claim in the provided data; if something is unknown, say so rather than inventing it. The email should express genuine interest in the business and its legacy, ask for a short conversation, and never mention scraping or scores.`;

export async function generateBrief(
  data: Enrichment,
  score: LeadScore,
  icp: IcpSettings,
  sender: { name?: string; firm?: string },
): Promise<AiBrief> {
  const client = new Anthropic();
  const payload = {
    company: {
      name: data.name, domain: data.domain, description: data.description, industry: data.industry,
      location: data.location, foundedYear: data.foundedYear, people: data.people,
      signals: data.signals, tech: data.tech, hasEmail: data.emails.length > 0, hasPhone: data.phones.length > 0,
    },
    score: { total: score.total, tier: score.tier, components: score.components.map((c) => ({ label: c.label, points: `${c.points}/${c.max}`, reasons: c.reasons })) },
    buyerThesis: { targetIndustries: icp.industries, keywords: icp.keywords, minYearsInBusiness: icp.minYears },
    sender: { name: sender.name || "[Your Name]", firm: sender.firm || "[Your Firm]" },
  };

  const response = await client.beta.messages.parse({
    model: AI_MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(BriefSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: `Lead data:\n${JSON.stringify(payload, null, 2)}` }],
  });

  if (response.stop_reason === "refusal") throw new Error("The model declined to write a brief for this lead.");
  if (!response.parsed_output) throw new Error("AI response could not be parsed.");
  const out = response.parsed_output;
  return {
    ...out,
    fitRating: Math.max(1, Math.min(10, out.fitRating)),
    risks: out.risks.slice(0, 3),
    model: response.model,
  };
}
