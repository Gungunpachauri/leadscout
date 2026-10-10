# LeadScout: acquisition-fit lead scoring for SaaSquatch

SaaSquatch Leads is good at *finding* companies. LeadScout answers the next question a searcher or PE buyer has: **which of these should I call first?**

Drop in a SaaSquatch CSV export (or paste domains). LeadScout politely crawls each company's public website, extracts and verifies contacts, detects ownership and maturity signals, and ranks every lead with a transparent 0–100 **acquisition-fit score**. One click exports the ranked list to CSV or a HubSpot-ready import, and an optional AI brief drafts an acquisition thesis plus a personalised owner email.

> Approach: **Quality First.** Rather than bolting on many small tools, this enhances the one step that decides whether scraped leads turn into conversations: qualification.

## Why this feature

Caprae's thesis is acquiring established, owner-operated businesses and creating value post-acquisition through operations and AI. A raw lead list doesn't reflect that thesis. A plumbing company founded in 1978 with a family owner and a 2016-era website is a far better target than a 2-year-old VC-backed startup, even if both have an email address. LeadScout encodes that judgement so a searcher spends their time on the top 20% of a list.

## Features

| Area | What it does |
|---|---|
| **Import** | CSV upload (auto-detects website/domain/email and company-name columns) or paste. URLs, `www.`, paths and emails are normalised to a domain; duplicates are merged and invalid rows reported. |
| **Enrichment** | Crawls the homepage plus up to 3 high-signal pages (contact / about / team / our-story). Extracts emails (mailto + text + JSON-LD), phones, decision-makers (founder/owner/CEO patterns + schema.org), socials, founding year, location, industry, tech stack, and signals (family-owned, owner-operated, hiring, e-commerce, online booking). |
| **Validation** | Email syntax + junk filtering (retina images, vendor/placeholder domains), **MX lookup** per domain, role-inbox vs direct-person detection, on-domain check. Phones normalised to E.164 and deduped; fictional/invalid NANP numbers dropped. |
| **Scoring** | Rule-based and explainable, so every point has a reason shown in the UI: Reachability 35 · Acquisition fit 40 · Buy-box (ICP) match 15 · Data confidence 10 → tiers A/B/C/D. |
| **Buy-box** | Pick target industries, keywords and minimum years in business. Scores recompute **instantly in the browser** without re-crawling. |
| **Workflow** | Filter by tier, min score, has email / phone, search; sort by score, name, age. Export the filtered view to CSV or **HubSpot import format**. |
| **AI brief** (optional) | On demand per lead: summary, acquisition thesis, diligence questions, 1–10 fit rating and a personalised outreach email, via Claude with structured output. Without an API key, a template email is built from scraped facts. |
| **Ethics** | Public company websites only (no LinkedIn scraping), honours `robots.txt`, identifies itself with a bot user-agent, 4 pages max per site, results cached 7 days to avoid re-crawling. |

## Architecture

```
Browser (Next.js client)                      Server (Next.js route handlers, Node runtime)
┌────────────────────────────┐   POST /api/enrich {domain}   ┌──────────────────────────────────┐
│ CSV parse + dedupe          │ ────────────────────────────▶ │ cache lookup (libSQL, 7-day TTL) │
│ worker pool (4 concurrent)  │                               │ robots.txt → fetch ≤4 pages       │
│ scoreLead() — pure, instant │ ◀──────────────────────────── │ SSRF guard on every hop           │
│ filters / sort / export     │        Enrichment JSON        │ extract → validate (DNS MX)       │
│ localStorage session        │                               └──────────────────────────────────┘
│                             │   POST /api/brief             ┌──────────────────────────────────┐
│ "Generate AI brief"         │ ────────────────────────────▶ │ Claude (structured JSON output)   │
└────────────────────────────┘                               └──────────────────────────────────┘
```

- **Stack:** Next.js 15 (App Router) + React 19 + TypeScript, Tailwind CSS v4, Cheerio (HTML parsing), PapaParse (CSV), `@libsql/client` (SQLite / Turso), `@anthropic-ai/sdk` + Zod (AI brief).
- **One domain per request.** The client runs a 4-wide worker pool, so the table fills in live and each serverless invocation stays short (well under the 30s limit), with no long-running job queue to operate.
- **Scoring runs client-side.** `scoreLead()` is a pure function shared by client and server, so changing the buy-box re-ranks hundreds of leads instantly with zero network calls.
- **Data storage & caching:** enrichment results are cached by domain in libSQL: a local `leadscout.db` SQLite file in development, a hosted **Turso** database in production (`TURSO_DATABASE_URL`). If no database is reachable (e.g. read-only serverless filesystem), it degrades to an in-memory cache. MX lookups are memoised per domain. The working lead list lives in the browser (`localStorage`) so a session survives reloads.
- **Performance:** per-page 8s timeout, 1.5MB response cap, sub-pages fetched in parallel, cached domains return in milliseconds.
- **Security:** user input drives server-side fetches, so every request (including each redirect hop, followed manually) resolves DNS and refuses private/loopback/link-local ranges (SSRF protection). Only `http(s)` is allowed.
- **Hosting:** serverless on **Vercel** (static dashboard + Node.js functions), with Turso as the managed database and Anthropic for AI. No servers to manage; the cost is near zero at idle.

### AI design

- Model: `claude-opus-5-5` with `effort: "low"` (a short, grounded writing task) and **structured outputs** via a Zod schema, so the UI never parses free text.
- Server-side refusal fallback is enabled (`fallbacks: "default"`), so a declined request is retried on a fallback model automatically.
- Runs **only when the user clicks**, so spend tracks the leads someone actually cares about (the same philosophy as SaaSquatch's "only enrich what you want" credits).
- The prompt is grounded in scraped data and instructed to say "unknown" rather than invent facts; the email never mentions scraping or scores.

## Getting started

Requires Node.js 20+.

```bash
npm install
cp .env.example .env.local   # optional: add ANTHROPIC_API_KEY for AI briefs
npm run dev
```

Open http://localhost:3000 and click **Try the sample dataset**.

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | No | Enables AI briefs and personalised emails. Without it the app is rules-only. |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | No | Hosted cache for production. Defaults to local `leadscout.db`. |

### Deploy (Vercel)

```bash
npx vercel --prod
```

Set `ANTHROPIC_API_KEY` (and optionally the Turso variables) in the Vercel project settings.

## Dataset

`public/sample-leads.csv` mimics a SaaSquatch export: real, long-established consumer brands with public websites, plus a duplicate row and an invalid row to demonstrate deduplication and validation. Any CSV with a website, domain or email column works.

## Scoring reference

| Component | Max | Signals |
|---|---|---|
| Reachability | 35 | Email on an MX-valid domain (12), direct named inbox (8), phone (8), decision-maker identified (4), LinkedIn (3) |
| Acquisition fit | 40 | Years in business (up to 15), family-owned / owner-operated (10), long-tenured owner → succession (5), digital upside: dated site, no marketing automation, DIY builder / no online booking (up to 10) |
| Buy-box match | 15 | Target industry (10), keyword match (5), −5 if below minimum years. Neutral 8 when no buy-box is set |
| Data confidence | 10 | Share of 8 profile fields found |

Tiers: **A** ≥ 70 (priority) · **B** ≥ 50 · **C** ≥ 30 · **D** < 30.

## Limitations & next steps

- Heuristic extraction: names, founding years and industries come from patterns and schema.org, so they can be wrong on unusual sites. The score breakdown shows its evidence so a human can sanity-check quickly.
- JavaScript-only sites (no server-rendered HTML) yield little data; a headless-browser fallback would help.
- Next: SMTP-level mailbox verification, revenue/employee estimates, a direct HubSpot API push, and batch AI briefs via the Message Batches API at 50% cost.
