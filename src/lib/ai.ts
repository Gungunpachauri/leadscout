// On-demand AI brief for a single lead. Only runs when the user clicks, so API
// spend tracks the leads someone actually cares about (same idea as
// SaaSquatch's "only enrich the leads you want" credits).

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { AiBrief, Enrichment, IcpSettings, LeadScore } from "./types";

const DEFAULT_MODEL = "claude-opus-5-5";
// Server-side refusal fallback ("default" routing) is only accepted by these models.
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export function aiModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

export function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const BriefSchema = z.object({
  summary: z.string().describe("2-3 sentences on what the business does and who it serves, using only the supplied data."),
  acquisitionThesis: z.string().describe("2-3 sentences on why this could be an attractive acquisition. Label hypotheses as such (e.g. 'If ..., then ...')."),
  improvementOpportunities: z.array(z.string()).describe("Up to 3 possible operational or digital improvements, each tied to an observed website signal."),
  diligenceQuestions: z.array(z.string()).describe("Up to 4 concrete questions a buyer should answer before an LOI."),
  uncertainties: z.array(z.string()).describe("Up to 3 key unknowns or risks, including any low-confidence facts."),
  fitRating: z.number().int().describe("1-10 fit for a buyer acquiring an established, owner-operated small business."),
  email: z.object({
    subject: z.string(),
    body: z.string().describe("Under 130 words. Warm, specific, no hype. Use the owner's first name only if a decision-maker is supplied."),
  }),
});

const SYSTEM = `You are an analyst at a search fund / private equity firm that acquires established, owner-operated small and mid-sized businesses and grows them with operational support and practical AI.
You receive facts scraped from a company's public website. Each fact may carry evidence with a method ("structured" = schema.org, "stated" = explicit page text, "inferred" = heuristic) and a confidence level.
Rules:
- Ground every claim in the supplied data. Treat "inferred" or low-confidence facts as uncertain and say so.
- Clearly separate evidence from hypotheses. Never present a hypothesis as fact.
- If something is not in the data, write "Unknown". Never invent owner names, personal circumstances, revenue, headcount, financials or any intent to sell.
- A high score is not evidence the company is for sale.
- The outreach email expresses genuine interest in the business, asks for a short conversation, and never mentions scraping, scores or succession assumptions.`;

export async function generateBrief(
  data: Enrichment,
  score: LeadScore,
  icp: IcpSettings,
  sender: { name?: string; firm?: string },
): Promise<AiBrief> {
  const client = new Anthropic();
  const model = aiModel();
  const payload = {
    company: {
      name: data.name, domain: data.domain, description: data.description, industry: data.industry,
      location: data.location, foundedYear: data.foundedYear, websiteCopyrightYear: data.copyrightYear,
      decisionMakers: data.people.map((p) => ({ name: p.name, title: p.title, method: p.evidence.method })),
      signals: data.signals, tech: data.tech,
      contact: { mailReadyEmail: data.emails.some((e) => e.status === "mx-ok"), phone: data.phones.length > 0 },
      evidence: data.evidence,
    },
    score: {
      total: score.total, tier: score.tier,
      components: score.components.map((c) => ({ label: c.label, points: `${c.points}/${c.max}`, reasons: c.reasons, caveats: c.caveats })),
    },
    buyerThesis: { targetIndustries: icp.industries, keywords: icp.keywords, minYearsInBusiness: icp.minYears, preferences: icp.prefer },
    sender: { name: sender.name || "[Your Name]", firm: sender.firm || "[Your Firm]" },
  };

  const response = await client.beta.messages.parse({
    model,
    max_tokens: 4000,
    ...(FALLBACK_MODELS.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
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
    improvementOpportunities: out.improvementOpportunities.slice(0, 3),
    diligenceQuestions: out.diligenceQuestions.slice(0, 4),
    uncertainties: out.uncertainties.slice(0, 3),
    model: response.model,
  };
}
