import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { aiEnabled, generateBrief } from "@/lib/ai";
import { scoreLead } from "@/lib/score";
import type { Enrichment, IcpSettings } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({ enabled: aiEnabled() });
}

export async function POST(req: Request) {
  if (!aiEnabled()) {
    return NextResponse.json({ error: "AI is not configured. Set ANTHROPIC_API_KEY in .env.local." }, { status: 503 });
  }
  const body = (await req.json().catch(() => null)) as
    | { data: Enrichment; icp: IcpSettings; sender?: { name?: string; firm?: string } }
    | null;
  if (!body?.data?.domain || !body.icp) return NextResponse.json({ error: "Missing lead data" }, { status: 400 });

  try {
    const brief = await generateBrief(body.data, scoreLead(body.data, body.icp), body.icp, body.sender ?? {});
    return NextResponse.json({ brief });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "Invalid Anthropic API key." }, { status: 401 });
    } else if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "Rate limited by the AI provider, try again shortly." }, { status: 429 });
    } else if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `AI provider error (${err.status}).` }, { status: 502 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
