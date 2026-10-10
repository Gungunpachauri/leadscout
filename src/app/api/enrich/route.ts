import { NextResponse } from "next/server";
import { getCached, putCached } from "@/lib/db";
import { normalizeDomain } from "@/lib/normalize";
import { EnrichRequestSchema, firstIssue } from "@/lib/schemas";
import { enrichDomain } from "@/lib/scraper";

export const runtime = "nodejs";
export const maxDuration = 30;

// One domain per request: the client runs a small concurrent queue, which gives
// live per-row progress and keeps each serverless invocation short.
export async function POST(req: Request) {
  const parsed = EnrichRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });

  const domain = normalizeDomain(parsed.data.domain);
  if (!domain) return NextResponse.json({ error: "Not a valid domain" }, { status: 400 });

  if (!parsed.data.refresh) {
    const cached = await getCached(domain);
    if (cached) return NextResponse.json({ data: cached, cached: true });
  }

  try {
    const data = await enrichDomain(domain);
    await putCached(data);
    return NextResponse.json({ data, cached: false });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Enrichment failed" }, { status: 422 });
  }
}
