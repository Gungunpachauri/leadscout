# LeadScout

**Acquisition-fit lead scoring for SaaSquatch leads.**
SaaSquatch finds companies. LeadScout tells a searcher or PE buyer **which ones to call first, and why**.

**Live demo:** https://leadscout-liart.vercel.app (click **Try sample**, about 3s)

## What it does

1. **Import:** upload a SaaSquatch CSV, drag and drop, or paste domains. URLs and emails are normalised, duplicates merged and invalid rows reported.
2. **Enrich:** reads each company's public site (homepage plus up to 3 About/Contact/Team pages) and extracts founding year, ownership, decision-maker, industry, location, contacts and site signals. **Every fact carries evidence:** source page, quoted text, *structured / stated / inferred*, and a confidence level. Missing facts show as *Unknown*.
3. **Validate:** email syntax and domain MX checks (mailboxes are not verified), role vs named inbox, phone normalisation.
4. **Score:** a transparent 0–100 acquisition-fit score with reasons and caveats for every point, plus **next best actions** (e.g. *Identify the owner*, *Confirm founding year*).
5. **Buy-box:** set target industries, keywords, minimum years and preferred traits. The list **re-ranks instantly**, with no re-crawl.
6. **Act:** filter, search and sort, then export the current view to **CSV** or **HubSpot**. Optional **AI brief** (Gemini or Claude) writes a thesis, diligence questions and an owner email grounded in the evidence.

*Approach:* **Quality First.** Rather than adding many small tools, it makes qualification, the step that decides which leads become conversations, excellent and explainable.

## Scoring

| Component | Max | Based on |
|---|---:|---|
| Reachability | 35 | Mail-ready email, named inbox, phone, decision-maker, LinkedIn |
| Acquisition fit | 40 | Years in business, stated family/owner ownership, long tenure, observed digital upside |
| Buy-box match | 15 | Your industries, keywords and preferences (neutral when unset) |
| Data confidence | 10 | How many key facts are backed by evidence, and how strongly |

Tiers: **A** 70+ · **B** 50–69 · **C** 30–49 · **D** <30. Weights live in one `SCORING` config (`src/lib/score.ts`).
The score is heuristic fit, **not** a prediction that a company is for sale. Inferred facts score lower than stated ones, and "not detected" is never treated as "no".

## Stack and architecture

**Next.js 15 · React 19 · TypeScript · Tailwind v4 · Cheerio · Zod · libSQL · Vitest**, deployed serverless on **Vercel**.

```
Browser: import → 4-way enrichment queue → scoreLead() (pure, instant) → filters / export
   │ POST /api/enrich                         │ POST /api/brief (optional)
Server: cache (7 days) → robots.txt → crawl ≤4 pages → extract evidence → MX check
                                                    Gemini / Claude → validated JSON
```

- **Cache:** results keyed by domain for 7 days. SQLite locally, Turso in production (falls back to `/tmp` or memory). The lead list persists in the browser.
- **Security:** private-IP blocking inside the DNS lookup (no rebinding window), every redirect re-checked, ports 80/443 only, timeouts and size caps, Zod-validated inputs, keys server-side only.
- **Ethics:** public sites only, robots.txt honoured, identifies as a bot, no LinkedIn scraping.

## Run locally

Requires Node.js 20+.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 65 tests, no network needed
```

On Windows PowerShell, if scripts are blocked, use `npm.cmd run dev`.

**Optional `.env.local`** (copy from `.env.example`):

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | AI briefs via Gemini (free tier: aistudio.google.com/apikey) |
| `ANTHROPIC_API_KEY` | AI briefs via Claude (used if both keys are set) |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Durable production cache |

Without any keys the app is fully functional: rules-based scoring and template emails.

## Limitations

- Extraction is heuristic; the evidence labels make every fact quick to verify.
- JavaScript-only sites yield little data (flagged in the UI).
- MX checks the email domain, not the individual mailbox.

**Next steps:** mailbox verification, headless-browser fallback, revenue/headcount estimates, direct HubSpot push.
