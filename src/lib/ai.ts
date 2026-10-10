// On-demand AI brief for a single lead. Only runs when the user clicks, so API
// spend tracks the leads someone actually cares about (same idea as
// SaaSquatch's "only enrich the leads you want" credits).
//
// Two interchangeable providers: Anthropic Claude or Google Gemini (which has a
// free tier). Whichever key is configured is used; AI_PROVIDER can force one.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { AiBrief, Enrichment, IcpSettings, LeadScore } from "./types";

export type AiProvider = "anthropic" | "gemini";

const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-opus-5-5",
  gemini: "gemini-3.8-flash",
};
// Server-side refusal fallback ("default" routing) is only accepted by these Claude models.
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

const anthropicKey = () => process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
const geminiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

/** The provider to use, or null when no key is configured (rules-only mode). */
export function aiProvider(): AiProvider | null {
  const forced = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (forced === "gemini") return geminiKey() ? "gemini" : null;
  if (forced === "anthropic") return anthropicKey() ? "anthropic" : null;
  if (anthropicKey()) return "anthropic";
  if (geminiKey()) return "gemini";
  return null;
}

export function aiEnabled(): boolean {
  return aiProvider() !== null;
}

export function aiModel(provider = aiProvider() ?? "anthropic"): string {
  const override = provider === "gemini" ? process.env.GEMINI_MODEL : process.env.ANTHROPIC_MODEL;
  return override?.trim() || DEFAULT_MODELS[provider];
}

/** Provider error with an HTTP status the route can map to a friendly message. */
export class AiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const BriefSchema = z.object({
  summary: z
    .string()
    .describe("2-3 sentences on what the business does and who it serves, using only the supplied data."),
  acquisitionThesis: z
    .string()
    .describe(
      "2-3 sentences on why this could be an attractive acquisition. Label hypotheses as such (e.g. 'If ..., then ...').",
    ),
  improvementOpportunities: z
    .array(z.string())
    .describe("Up to 3 possible operational or digital improvements, each tied to an observed website signal."),
  diligenceQuestions: z.array(z.string()).describe("Up to 4 concrete questions a buyer should answer before an LOI."),
  uncertainties: z.array(z.string()).describe("Up to 3 key unknowns or risks, including any low-confidence facts."),
  fitRating: z.number().int().describe("1-10 fit for a buyer acquiring an established, owner-operated small business."),
  email: z.object({
    subject: z.string(),
    body: z
      .string()
      .describe(
        "Under 130 words. Warm, specific, no hype. Use the owner's first name only if a decision-maker is supplied.",
      ),
  }),
});
type BriefOut = z.infer<typeof BriefSchema>;

const SYSTEM = `You are an analyst at a search fund / private equity firm that acquires established, owner-operated small and mid-sized businesses and grows them with operational support and practical AI.
You receive facts scraped from a company's public website. Each fact may carry evidence with a method ("structured" = schema.org, "stated" = explicit page text, "inferred" = heuristic) and a confidence level.
Rules:
- Ground every claim in the supplied data. Treat "inferred" or low-confidence facts as uncertain and say so.
- Clearly separate evidence from hypotheses. Never present a hypothesis as fact.
- If something is not in the data, write "Unknown". Never invent owner names, personal circumstances, revenue, headcount, financials or any intent to sell.
- Website signals listed under "notDetected" were simply not found on the few crawled pages. Never state or imply the business lacks them (e.g. do not say "no e-commerce" or "not owner-operated"); treat them as unknown and, if relevant, turn them into a diligence question.
- Only propose improvement opportunities that are supported by a detected signal or technology, and phrase them as possibilities to verify.
- A high score is not evidence the company is for sale.
- The outreach email expresses genuine interest in the business, asks for a short conversation, and never mentions scraping, scores or succession assumptions.`;

const SIGNAL_LABELS: Record<keyof Enrichment["signals"], string> = {
  familyOwned: "family-owned wording",
  ownerOperated: "owner-operated wording or an owner/founder title",
  hiring: "careers/jobs link",
  ecommerce: "online store (cart, checkout or commerce platform)",
  onlineBooking: "online booking",
};

/**
 * What the model sees. Website signals are split into detected / not detected
 * rather than true/false: a crawler not finding something on a few pages is
 * not evidence the business lacks it.
 */
export function buildPayload(
  data: Enrichment,
  score: LeadScore,
  icp: IcpSettings,
  sender: { name?: string; firm?: string },
) {
  const keys = Object.keys(SIGNAL_LABELS) as (keyof Enrichment["signals"])[];
  return {
    company: {
      name: data.name,
      domain: data.domain,
      description: data.description || "Unknown",
      industry: data.industry ?? "Unknown",
      location: data.location ?? "Unknown",
      foundedYear: data.foundedYear ?? "Unknown",
      websiteCopyrightYear: data.copyrightYear ?? "Unknown",
      decisionMakers: data.people.length
        ? data.people.map((p) => ({ name: p.name, title: p.title, method: p.evidence.method }))
        : "Unknown",
      websiteSignals: {
        detected: keys.filter((k) => data.signals[k]).map((k) => SIGNAL_LABELS[k]),
        notDetected: keys.filter((k) => !data.signals[k]).map((k) => SIGNAL_LABELS[k]),
        note: `Based on ${data.pagesCrawled.length} crawled page(s)${data.thinContent ? " with little server-rendered text (likely a JavaScript site)" : ""}. "notDetected" means the crawler did not see it; it does NOT mean the business lacks it.`,
      },
      technologiesDetected: data.tech,
      contact: {
        mailReadyEmailFound: data.emails.some((e) => e.status === "mx-ok"),
        phoneFound: data.phones.length > 0,
      },
      evidence: data.evidence,
    },
    score: {
      total: score.total,
      tier: score.tier,
      components: score.components.map((c) => ({
        label: c.label,
        points: `${c.points}/${c.max}`,
        reasons: c.reasons,
        caveats: c.caveats,
      })),
    },
    buyerThesis: {
      targetIndustries: icp.industries.length ? icp.industries : "Any",
      keywords: icp.keywords.length ? icp.keywords : "None",
      minYearsInBusiness: icp.minYears,
      // Only the buyer's switched-on preferences; "false" here could be misread as a company fact.
      preferredCharacteristics: (Object.keys(icp.prefer ?? {}) as (keyof IcpSettings["prefer"])[]).filter(
        (k) => icp.prefer[k],
      ),
    },
    sender: { name: sender.name || "[Your Name]", firm: sender.firm || "[Your Firm]" },
  };
}

async function viaAnthropic(prompt: string, model: string): Promise<{ out: BriefOut; model: string }> {
  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model,
    max_tokens: 4000,
    ...(FALLBACK_MODELS.has(model)
      ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
      : {}),
    output_config: { effort: "low", format: betaZodOutputFormat(BriefSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") throw new AiError("The model declined to write a brief for this lead.", 422);
  if (!response.parsed_output) throw new AiError("AI response could not be parsed.", 502);
  return { out: response.parsed_output, model: response.model };
}

async function viaGemini(prompt: string, model: string): Promise<{ out: BriefOut; model: string }> {
  const client = new GoogleGenAI({ apiKey: geminiKey() });
  // Gemini enforces the JSON schema; Zod then validates the result.
  // Gemini's schema subset does not accept the JSON Schema "$schema" keyword.
  const schema: Record<string, unknown> = { ...z.toJSONSchema(BriefSchema) };
  delete schema.$schema;
  let interaction;
  try {
    interaction = await client.interactions.create({
      model,
      system_instruction: SYSTEM,
      input: prompt,
      response_format: { type: "text", mime_type: "application/json", schema },
      store: false,
    });
  } catch (err) {
    const status = Number((err as { status?: number; code?: number }).status ?? (err as { code?: number }).code) || 502;
    const msg =
      status === 401 || status === 403
        ? "Invalid Gemini API key."
        : status === 404
          ? `Gemini model "${model}" was not found. Check GEMINI_MODEL.`
          : status === 429
            ? "Gemini free-tier rate limit reached. Wait a minute and retry."
            : `Gemini error (${status}).`;
    throw new AiError(msg, status === 401 || status === 403 ? 401 : status === 404 ? 400 : status === 429 ? 429 : 502);
  }
  const text = interaction.output_text;
  if (!text) throw new AiError("Gemini returned an empty response.", 502);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AiError("Gemini response was not valid JSON.", 502);
  }
  const parsed = BriefSchema.safeParse(json);
  if (!parsed.success) throw new AiError("Gemini response did not match the brief format.", 502);
  return { out: parsed.data, model };
}

export async function generateBrief(
  data: Enrichment,
  score: LeadScore,
  icp: IcpSettings,
  sender: { name?: string; firm?: string },
): Promise<AiBrief> {
  const provider = aiProvider();
  if (!provider) throw new AiError("AI is not configured.", 503);
  const prompt = `Lead data:\n${JSON.stringify(buildPayload(data, score, icp, sender), null, 2)}`;
  const { out, model } =
    provider === "gemini"
      ? await viaGemini(prompt, aiModel("gemini"))
      : await viaAnthropic(prompt, aiModel("anthropic"));
  return {
    ...out,
    fitRating: Math.max(1, Math.min(10, Math.round(out.fitRating))),
    improvementOpportunities: out.improvementOpportunities.slice(0, 3),
    diligenceQuestions: out.diligenceQuestions.slice(0, 4),
    uncertainties: out.uncertainties.slice(0, 3),
    model,
  };
}
