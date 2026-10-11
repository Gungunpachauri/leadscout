import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { AiError, aiModel, aiProvider, generateBrief } from "@/lib/ai";
import { BriefRequestSchema, firstIssue } from "@/lib/schemas";
import { scoreLead } from "@/lib/score";
import type { Enrichment } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const provider = aiProvider();
  return NextResponse.json({ enabled: provider !== null, provider, model: provider ? aiModel(provider) : null });
}

export async function POST(req: Request) {
  if (!aiProvider()) {
    return NextResponse.json(
      { error: "AI is not configured. Set GEMINI_API_KEY or ANTHROPIC_API_KEY in .env.local." },
      { status: 503 },
    );
  }
  const parsed = BriefRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });

  const { icp, sender } = parsed.data;
  const data = parsed.data.data as Enrichment;
  try {
    const brief = await generateBrief(data, scoreLead(data, icp), icp, sender);
    return NextResponse.json({ brief });
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    } else if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "Invalid Anthropic API key." }, { status: 401 });
    } else if (err instanceof Anthropic.NotFoundError) {
      return NextResponse.json({ error: "Configured ANTHROPIC_MODEL was not found." }, { status: 400 });
    } else if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "Rate limited by the AI provider, try again shortly." }, { status: 429 });
    } else if (err instanceof Anthropic.APIConnectionTimeoutError) {
      return NextResponse.json({ error: "The AI took too long to respond. Please try again." }, { status: 504 });
    } else if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `AI provider error (${err.status}).` }, { status: 502 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
