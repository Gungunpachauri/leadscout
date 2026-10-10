import { NextResponse } from "next/server";
import { getCached, putCached } from "@/lib/db";
import { normalizeDomain } from "@/lib/normalize";
import { enrichDomain } from "@/lib/scraper";

export const runtime = "nodejs";
export const maxDuration = 30;

// One domain per request: the client runs a small concurrent queue, which gives
// live per-row progress and keeps each serverless invocation short.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { domain?: string; refresh?: boolean };
  const domain = normalizeDomain(body.domain ?? "");
  if (!domain) return NextResponse.json({ error: "Invalid domain" }, { status: 400 });

  if (!body.refresh) {
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
