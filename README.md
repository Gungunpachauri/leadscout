# LeadScout

**Acquisition-fit lead scoring for SaaSquatch leads.** SaaSquatch finds companies; LeadScout tells a searcher or PE
buyer **which ones to contact first, and why**.

- **Live demo:** https://leadscout-liart.vercel.app (click **Try sample**, about 3 seconds)
- **Approach:** _Quality First_. One feature, lead qualification, built to be accurate, explainable and fast.

## Business use case

Caprae acquires established, owner-operated businesses and grows them with operations and AI. A raw lead list doesn't
reflect that thesis: a 1975 family business with an owner's email beats a two-year-old startup with an `info@` inbox.
LeadScout encodes that judgement so a buyer spends time on the top of the list:

1. **Import** a SaaSquatch CSV (or paste domains). URLs and emails are normalised, duplicates merged, invalid rows reported.
2. **Enrich** each company from its public website: founding year, ownership, decision-maker, industry, location,
   contacts and site signals. **Every fact carries evidence** (source page, quote, stated vs inferred, confidence).
3. **Validate** contacts: email syntax and domain MX checks, role vs named inbox, phone normalisation.
4. **Score** 0–100 for acquisition fit, with the reason for every point and a **next best action** per lead.
5. **Tune** a buy-box (industries, keywords, minimum years, preferences). The ranking updates instantly.
6. **Act:** filter, export the current view to **CSV or HubSpot**, or generate an optional **AI brief** with a thesis,
   diligence questions and an owner email.

### Scoring

| Component       | Max | Based on                                                                  |
| --------------- | --: | ------------------------------------------------------------------------- |
| Reachability    |  35 | Mail-ready email, named inbox, phone, decision-maker, LinkedIn            |
| Acquisition fit |  40 | Years in business, stated ownership, long tenure, observed digital upside |
| Buy-box match   |  15 | User's industries, keywords and preferences (neutral when unset)          |
| Data confidence |  10 | How many key facts are backed by evidence, and how strongly               |

Tiers: **A** 70+ · **B** 50–69 · **C** 30–49 · **D** below 30. All weights live in one config (`src/lib/score.ts`).
The score measures heuristic fit, not likelihood of a sale. Inferred facts count less than stated ones, and a signal
the crawler did not find is treated as unknown, never as "no".

## UX design choices

- **One focused workspace.** An empty state with a single import box, then a ranked list. Settings (buy-box) and detail
  live in slide-over panels so the list stays uncluttered.
- **Explain, don't just rank.** Hovering a score shows its four components; the detail panel shows the score as a sum,
  the evidence behind each fact, caveats, and what to investigate next.
- **Honest data.** Unknown values say _Unknown_; estimates are marked `~`; email checks show syntax, MX and "mailbox not
  verified" separately.
- **Fast feedback.** Live per-row progress, instant re-ranking, toasts that report merges and invalid rows, and clear
  error messages with retry.
- **Accessible and responsive.** Keyboard-navigable rows, tabs and dialogs; light and dark themes; mobile layout.

## Architecture

```
Browser (Next.js client)                       Server (Next.js route handlers, Node.js runtime)
import → normalise → dedupe                     POST /api/enrich
4 concurrent enrichment requests  ───────────▶  validate (Zod) → cache lookup → robots.txt
scoreLead() runs client-side (pure)             → fetch ≤ 4 pages (SSRF-guarded) → extract evidence → MX check
filters · sort · CSV/HubSpot export             POST /api/brief (optional) → Gemini or Claude → validated JSON
```

| Concern       | Choice                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend      | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, lucide icons                                                                                  |
| Backend       | Next.js route handlers on the Node.js runtime; Cheerio for HTML parsing; Zod for input/output validation                                                      |
| Data storage  | libSQL: SQLite file locally, **Turso** (hosted libSQL) in production; lead list persisted in the browser                                                      |
| Caching       | Enrichment cached per domain for 7 days with schema versioning; MX lookups memoised; in-memory fallback                                                       |
| Performance   | One domain per request (short serverless calls), 4 in parallel; 8s timeout and 1.5 MB cap per page; scoring is client-side so buy-box changes need no network |
| Hosting       | **Serverless** on **Vercel**: the dashboard is statically prerendered; the two API routes run as Node.js functions                                            |
| Deployment    | Vercel CLI (`vercel deploy --prod`) or Git integration; GitHub Actions runs typecheck, lint, format, tests and build on every push                            |
| AI (optional) | Google Gemini (free tier) or Anthropic Claude, with structured JSON output                                                                                    |
| Testing       | Vitest (65 tests: normalisation, scoring, export, extraction, SSRF guard)                                                                                     |

**Security and ethics:** private and loopback IPs are blocked inside the DNS lookup (no DNS-rebinding window), every
redirect is re-validated, only ports 80/443 are allowed, API keys stay server-side, and inputs are size-limited. The
crawler reads public pages only, honours robots.txt, identifies itself as a bot and does not scrape LinkedIn.

## Setup

Requires **Node.js 20+**.

```bash
git clone https://github.com/Gungunpachauri/leadscout.git
cd leadscout
npm install
npm run dev
```

Open http://localhost:3000 and click **Try sample**. (Windows PowerShell with scripts disabled: use `npm.cmd run dev`.)

Optional environment variables (copy `.env.example` to `.env.local`). The app works fully without them.

| Variable                                 | Purpose                                                     |
| ---------------------------------------- | ----------------------------------------------------------- |
| `GEMINI_API_KEY`                         | AI briefs via Gemini (free key: aistudio.google.com/apikey) |
| `ANTHROPIC_API_KEY`                      | AI briefs via Claude (takes precedence if both are set)     |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Durable production cache                                    |

| Command                       | Purpose                         |
| ----------------------------- | ------------------------------- |
| `npm test`                    | Run the test suite (no network) |
| `npm run typecheck` / `lint`  | Static checks                   |
| `npm run format`              | Format with Prettier            |
| `npm run build` / `npm start` | Production build and serve      |

## Dataset

`public/sample-leads.csv` mimics a SaaSquatch export: four real, long-established brands with public websites (from a
tier-A lead to a low-fit one), plus one duplicate and one invalid row to demonstrate deduplication and validation. Any
CSV with a website, domain or email column can be imported.

## Limitations and next steps

- Extraction is heuristic; evidence labels make each fact quick to verify.
- JavaScript-only websites yield little data (flagged in the UI).
- MX checks confirm the email domain, not the individual mailbox.

Next: mailbox-level verification, a headless-browser fallback, revenue and headcount estimates, and a direct HubSpot push.
