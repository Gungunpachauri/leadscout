# LeadScout: acquisition-fit intelligence for SaaSquatch leads

SaaSquatch Leads helps you **find** companies. LeadScout answers the next question:

> *Which of these companies should an acquisition entrepreneur or PE buyer investigate and contact first?*

Drop in a SaaSquatch CSV export (or paste domains). LeadScout reads each company's public website, extracts facts **with the evidence behind them**, verifies contact routes, and ranks every lead with a transparent 0–100 acquisition-fit score. You can tune it to your buy-box, see exactly why each lead scored what it did, get a recommended next step, and export a prioritised list to CSV or HubSpot.

It is an **acquisition decision-support layer**, not another scraper: every number is explained, every fact is sourced, and anything unknown is shown as *Unknown*.

**Who it's for:** searchers (ETA), independent sponsors and lower-middle-market PE teams qualifying owner-operated small businesses.

## Why this approach

Caprae acquires established, owner-operated businesses and creates value through operations and AI. A raw lead list doesn't reflect that thesis: a 1975 family plumbing company with an owner's email and a 2016-era website is a far better first call than a two-year-old startup with an info@ inbox. LeadScout encodes that judgement, shows its working, and stays honest about what a public website can and cannot prove.

The handbook offered *Quality First* or *Quantity Driven*. LeadScout is **Quality First**: it makes qualification excellent, because that's the step that decides whether scraped leads turn into conversations.

## Feature status

| Feature | Status |
|---|---|
| CSV upload, drag-and-drop, paste; column auto-detection | ✅ Implemented |
| URL / www / path / email normalisation, dedupe, invalid-row and duplicate reporting | ✅ Implemented |
| Sample dataset | ✅ Implemented |
| Polite crawl: homepage + up to 3 About/Contact/Team/Story pages, robots.txt, timeouts, size caps, 4 concurrent | ✅ Implemented |
| Evidence per fact (source page, quoted snippet, structured / stated / inferred, confidence) | ✅ Implemented |
| Email syntax + domain MX check; role vs named inbox; phone normalisation | ✅ Implemented |
| Deterministic, explainable scoring with caveats; weights in one config | ✅ Implemented |
| Buy-box: industries, keywords, min years, preferred characteristics; instant client-side re-rank | ✅ Implemented |
| Next-action recommendations per lead | ✅ Implemented |
| Search, tier tabs, industry and min-score filters, email/phone toggles, sorting | ✅ Implemented |
| CSV export (filtered view) and HubSpot-format CSV | ✅ Implemented |
| SSRF hardening (DNS-pinned private-IP blocking, per-hop redirect checks, port allow-list) | ✅ Implemented |
| Zod validation on all API inputs | ✅ Implemented |
| Automated tests (65) | ✅ Implemented |
| AI acquisition brief (Gemini or Claude, structured output) | ⚙️ Optional: needs `GEMINI_API_KEY` (free tier) or `ANTHROPIC_API_KEY` |
| Durable enrichment cache in production (Turso) | ⚙️ Optional: needs `TURSO_DATABASE_URL` |
| Mailbox-level (SMTP) email verification | ❌ Not supported: MX checks the domain only |
| JavaScript-rendered sites (headless browser) | ❌ Not supported: flagged as "thin content" |
| Direct HubSpot API push, revenue/headcount estimates | ❌ Not supported (see Future work) |

## How it works

### 1. Import
CSV or pasted text is parsed with PapaParse. A first row is treated as a header only if it names a website/domain/email column **and** doesn't itself look like a domain, so a plain list keeps its first row. Values are normalised (`https://www.Acme.com/about` → `acme.com`, `owner@acme.com` → `acme.com`) and deduplicated. Users see "*7 added · 1 duplicate merged · 1 invalid skipped*". Unsupported file types, empty files and files over 5 MB get a clear message.

### 2. Enrichment with evidence
For each domain, the server fetches `robots.txt`, the homepage, and up to three same-site pages likely to hold ownership/contact details. Extraction prefers **schema.org JSON-LD** (the site's own structured data) and falls back to explicit wording, then heuristics. Every key fact carries:

| Field | Meaning |
|---|---|
| `method` | `structured` (schema.org), `stated` (explicit page text), or `inferred` (heuristic) |
| `confidence` | `high` / `medium` / `low` |
| `source` | the page URL |
| `snippet` | the quoted text that supports it |

Examples of deliberate restraint, each covered by tests:

- "*for 25 years*" is ignored, because it usually describes a person's tenure. "*over 30 years*" yields a **low-confidence inferred** estimate.
- "*the 4th generation visited*" (a customer review) is **not** family ownership; "*third-generation family business*" is.
- A name matched from page text is marked inferred, and template emails only greet by name when the site published it in structured data.
- Sites with almost no server-rendered text are flagged `thinContent`, so missing data is shown as *possibly missing*, not *absent*.

### 3. Scoring (`src/lib/score.ts`)
`scoreLead(enrichment, buyBox)` is a pure, deterministic function. All weights live in the `SCORING` object.

| Component | Max | What earns points |
|---|---:|---|
| Reachability | 35 | Mail-ready email domain (12), named inbox (8), phone (8), decision-maker named (4), LinkedIn (3) |
| Acquisition fit | 40 | Years in business (up to 15; ×0.8 if inferred; unknown = neutral 5), ownership stated (10) or inferred (6), long tenure under that ownership (5), observed website levers: stale footer, no marketing automation, DIY builder or no online booking (up to 10) |
| Buy-box match | 15 | Configured criteria share the 15 points: industry (7), keywords (4), preferred characteristics (4). Neutral 8 when nothing is configured; −5 if below minimum years |
| Data confidence | 10 | 8 key facts, each weighted by evidence quality (high 1, medium 0.75, low 0.4) |

Tiers: **A** 70–100 · **B** 50–69 · **C** 30–49 · **D** < 30.

Every component returns **reasons** and **caveats**, shown in the UI and in exports. The caveats state, for example, that MX doesn't verify a mailbox, that long tenure isn't evidence of intent to sell, and that website observations suggest but don't prove upside. **The score is heuristic acquisition fit, not a probability of a deal or of willingness to sell.**

### 4. Next actions
`nextActions()` turns gaps and signals into concrete steps, for example *Find a contact route*, *Identify the owner*, *Confirm founding year*, *Verify ownership structure*, *Explore succession plans* or *Prioritise outreach*. Each comes with a one-line reason.

### 5. Workspace
Tier tabs with counts, email/phone toggles, a Filters menu (industry, minimum score), search, sortable columns, **Reset view**, and **Retry N failed**. Rows show industry and location, age (`~` = estimated), ownership signals, and email plus phone. Every truncated value has a full-text tooltip, and hovering or keyboard-focusing a score shows its four components.

**Header metrics** are computed from the loaded leads that have been scored (in-progress and failed rows are excluded), using the same buy-box as the table:

| Metric | Definition |
|---|---|
| Priority | Leads in tier A (score ≥ 70). Always equals the "A" tab count. |
| Reachable | Scored leads with an email on a mail-ready (MX) domain, or a phone number |
| Avg score | Mean score of scored leads under the current buy-box |

The header status reads **"Rules-based · AI off"** when no API key is set: ranking never uses AI; only the optional brief does.

**Detail panel**
- **Overview:** score with its explicit sum (e.g. `20 + 36 + 8 + 8 = 72`), **Next best actions** with reasons, **Key facts** with quoted evidence, the score breakdown with caveats, contacts (each email shows *syntax valid*, *domain MX ready/missing* and *mailbox not verified* separately), and website signals.
- **Outreach:** the AI brief, or a deterministic template email.
- **Sources:** retrieval time and cache status, an evidence summary (structured / stated / inferred counts), facts not found, every claim **grouped under the page it came from** with method, confidence and quote, the contacts found on each page, and whole-site observations (labelled as such, because no single page is recorded for them).

Keyboard: rows are focusable (Enter opens), tabs use arrow keys, dialogs trap focus, Escape closes them, and focus returns to the row that opened the panel.

### 6. Export
The **current filtered view** exports to CSV with company, domain, score, tier, each component, industry/founded/ownership **with their evidence labels and source snippet**, contacts, decision-maker, next action, reasons and caveats. A HubSpot-format CSV uses HubSpot's import property names. Values are escaped by PapaParse, cells beginning with `= + - @` are neutralised against spreadsheet formula injection, and a UTF-8 BOM keeps Excel happy.

### 7. Optional AI brief
On click, `/api/brief` sends the lead's facts, evidence and score to the configured provider: Google Gemini (free tier, `interactions` API with a JSON schema and `store: false`) or Anthropic Claude and gets back a Zod-validated JSON brief: summary, evidence-supported thesis, improvement opportunities, diligence questions, uncertainties, a 1–10 fit rating and a short owner email. The prompt requires separating evidence from hypotheses, writing "Unknown" for missing data, and never inventing names, financials or intent to sell. The model defaults to `claude-opus-5-5` (override with `ANTHROPIC_MODEL`); a server-side refusal fallback is enabled for models that support it. Without a key the app is fully functional and uses a deterministic template email.

## Architecture

```
Browser (Next.js client)                         Server (route handlers, Node.js runtime)
┌──────────────────────────────┐ POST /api/enrich ┌───────────────────────────────────────┐
│ parseImport → dedupeInputs    │ ───────────────▶ │ Zod validate → normalise domain        │
│ worker pool (4 concurrent)    │                  │ cache lookup (libSQL, 7-day TTL)       │
│ scoreLead() + nextActions()   │ ◀─────────────── │ robots.txt → safeFetch ≤4 pages        │
│   pure, instant re-rank       │  Enrichment+evid │   (DNS-pinned SSRF guard, caps)        │
│ filters / sort / export       │                  │ analyzePages() → evidence per fact     │
│ localStorage session          │                  │ validateEmails() (memoised MX)         │
│                               │ POST /api/brief  ├───────────────────────────────────────┤
│ "Generate brief" (optional)   │ ───────────────▶ │ Zod validate → Claude structured output│
└──────────────────────────────┘                  └───────────────────────────────────────┘
```

| Module | Responsibility |
|---|---|
| `src/lib/normalize.ts` | Import parsing, domain normalisation, dedupe, column detection |
| `src/lib/http.ts` | SSRF-hardened GET: DNS-pinned IP checks, redirects, timeouts, size cap, decompression |
| `src/lib/scraper.ts` | robots.txt, page parsing, `analyzePages()` evidence extraction, orchestration |
| `src/lib/validate.ts` | Email plausibility, MX readiness, role inbox detection, phone normalisation |
| `src/lib/score.ts` | `SCORING` config, `scoreLead()`, `nextActions()` (no I/O) |
| `src/lib/export.ts` | `buildCsv()` / `buildHubspotCsv()` (pure), download, template email |
| `src/lib/schemas.ts` | Zod request schemas |
| `src/lib/db.ts` | libSQL cache with schema versioning and in-memory fallback |
| `src/lib/ai.ts` | Optional Claude brief |

**Stack:** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Cheerio · PapaParse · Zod · `@libsql/client` · `@anthropic-ai/sdk` · Vitest.

### Storage and caching
- **Working list:** browser `localStorage`, so a session survives reloads. It isn't shared across devices by design.
- **Enrichment cache:** keyed by normalised domain with a 7-day TTL. Local dev uses a SQLite file (`leadscout.db`); production should set `TURSO_DATABASE_URL`. Entries carry a schema `version`, so changes to extraction logic invalidate stale cache entries and saved browser data automatically.
- **Fallback:** if no database is reachable (e.g. a read-only serverless filesystem), the cache degrades to in-memory, which is **not durable** across serverless invocations. The app still works; it just re-crawls more often.
- MX lookups are memoised per domain per server instance.

### Security
- Only `http`/`https`, ports 80/443, no credentials in URLs; `localhost`, `*.local` and `*.internal` are rejected.
- Private, loopback, link-local, CGNAT, multicast and IPv4-mapped IPv6 ranges are blocked. The check runs **inside the socket's DNS lookup**, so the validated IP is the connected IP. That closes the DNS-rebinding gap of a separate "resolve then fetch" check (verified against `localtest.me`, a public name that resolves to 127.0.0.1).
- Redirects are followed manually (max 4) and every hop is re-validated.
- 8s timeout and 1.5 MB cap per response; 4 concurrent domains; ≤4 pages per site.
- All API input is validated with Zod and size-limited (client data reaches the AI prompt).
- API keys stay server-side; no contact data is logged.
- No LinkedIn scraping; no bypassing of logins, CAPTCHAs, paywalls or robots.txt.

## Setup

Requires Node.js 20+.

```bash
npm install
cp .env.example .env.local   # all variables are optional
npm run dev                  # http://localhost:3000, then click "Try sample"
```

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | No | Enables AI briefs via Google Gemini (free tier; key from aistudio.google.com/apikey) |
| `GEMINI_MODEL` | No | Gemini model (default `gemini-3.8-flash`) |
| `ANTHROPIC_API_KEY` | No | Enables AI briefs via Claude (used if both keys are set) |
| `ANTHROPIC_MODEL` | No | Claude model (default `claude-opus-5-5`) |
| `AI_PROVIDER` | No | Force `gemini` or `anthropic` |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | No | Durable production cache |

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (Turbopack) |
| `npm test` | Vitest suite (65 tests, no network needed) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run build` / `npm start` | Production build / serve |

### Tests
`tests/` covers normalisation, dedupe and import parsing (including malformed CSV); scoring (weights sum to 100, tier thresholds, determinism, neutral buy-box, re-ranking, preferences, inferred-year discount, caveats, JS-only sites, legacy settings); next actions; CSV escaping, formula-injection neutralisation and HubSpot mapping; evidence extraction from fixture HTML (structured vs stated vs inferred, unknowns stay empty, false-positive guards); robots.txt precedence; contact validation; and the SSRF guard.

### Deploy (Vercel)
```bash
npx vercel --prod
```
Set the optional environment variables in the Vercel project. The two API routes run on the Node.js runtime (`maxDuration` 30s / 60s).

## Dataset
`public/sample-leads.csv` mimics a SaaSquatch export: real, long-established brands with public websites, plus a duplicate and an invalid row to demonstrate dedupe and validation.

## Known limitations
- Extraction is heuristic. Evidence labels and snippets exist so a person can check any fact in seconds, but some facts will still be wrong or missing.
- JavaScript-only sites yield little data (flagged in the UI).
- MX readiness doesn't prove a mailbox exists.
- Industry classification is keyword-based unless the site publishes a schema.org type.
- In-memory cache fallback is not durable on serverless without Turso.

## Future work
SMTP-level mailbox verification · headless-browser fallback for JS sites · revenue/headcount estimation from public signals · direct HubSpot API push · batch AI briefs via the Message Batches API · shared team workspaces.

## Demo checklist (≈2 minutes)
1. Click **Try sample**: the toast reports duplicates merged and invalid rows skipped.
2. Watch rows enrich live (progress bar, skeletons), then a ranked list appears.
3. Open the top lead: score, **Next steps**, **Key facts with quoted evidence**, caveats.
4. Open **Buy-box**, pick an industry and "Family-owned": the ranking changes instantly.
5. Use the tier tabs and **Filters** (industry, min score) together.
6. **Export → Spreadsheet**: the file contains exactly the filtered leads with evidence and next actions.
7. Outreach tab: template email (or the AI brief with a key).
