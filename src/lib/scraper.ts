import * as cheerio from "cheerio";
import type { Enrichment, PersonContact, Socials } from "./types";
import { isPublicHost, normalizePhones, validateEmails } from "./validate";

const USER_AGENT = "LeadScoutBot/1.0 (+https://github.com/Gungunpachauri/leadscout; polite B2B research crawler)";
const PAGE_TIMEOUT_MS = 8000;
const MAX_BYTES = 1_500_000;
const MAX_PAGES = 4;
const MAX_REDIRECTS = 4;

// ---------- fetching ----------

async function safeFetch(url: string): Promise<{ url: string; body: string; contentType: string } | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = new URL(current);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    if (!(await isPublicHost(u.hostname))) return null;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS);
    try {
      // Follow redirects by hand so every hop goes through the SSRF check.
      const res = await fetch(current, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain;q=0.8" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return null;
        current = new URL(loc, current).toString();
        continue;
      }
      if (!res.ok) return null;
      const contentType = res.headers.get("content-type") ?? "";
      const buf = await readCapped(res);
      return { url: current, body: buf, contentType };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    chunks.push(value);
    if (total > MAX_BYTES) {
      await reader.cancel();
      break;
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

// ---------- robots.txt ----------

type RobotsRules = { allow: string[]; disallow: string[] };

function parseRobots(txt: string): RobotsRules {
  // Only the "*" group applies to us; we don't claim a named agent.
  const rules: RobotsRules = { allow: [], disallow: [] };
  let inStar = false;
  let sawRuleInGroup = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (sawRuleInGroup) { inStar = false; sawRuleInGroup = false; }
      if (val === "*") inStar = true;
    } else if (key === "allow" || key === "disallow") {
      sawRuleInGroup = true;
      if (inStar && val) rules[key].push(val);
    }
  }
  return rules;
}

function robotsAllows(rules: RobotsRules, path: string): boolean {
  // Longest matching rule wins, per RFC 9309.
  const match = (p: string) => {
    const re = new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    return re.test(path) ? p.length : -1;
  };
  const allow = Math.max(-1, ...rules.allow.map(match));
  const disallow = Math.max(-1, ...rules.disallow.map(match));
  return disallow < 0 || allow >= disallow;
}

// ---------- extraction ----------

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const FOUNDED_RE = /\b(?:since|established|est\.?|founded(?:\s+in)?|serving[^.]{0,40}since|in business since)\s*(?:in\s*)?((?:18|19|20)\d{2})\b/i;
const YEARS_RE = /\b(?:over|more than|nearly|for)\s+(\d{2,3})\s+years\b/i;
const FAMILY_RE = /\b(family[- ]owned|family[- ]run|family business|(?:second|third|fourth|2nd|3rd|4th)[- ]generation|generations of)\b/i;
const OWNER_RE = /\b(owner[- ]operated|locally owned|independently owned|veteran[- ]owned|woman[- ]owned|women[- ]owned|owned and operated)\b/i;
// Title words match in lower or Title case, but names must stay case-sensitive,
// so we can't use the regex "i" flag.
const TITLE_WORDS = ["founder", "co-founder", "owner", "president", "ceo", "principal", "managing partner", "managing director"]
  .map((w) => w.replace(/\b[a-z]/g, (c) => `[${c.toUpperCase()}${c}]`))
  .concat("CEO")
  .join("|");
const NAME = "[A-Z][a-z]+(?:\\s[A-Z]\\.)?\\s[A-Z][a-z][a-zA-Z'’-]*";
const PERSON_AFTER = new RegExp(`\\b(${TITLE_WORDS})\\b[\\s,:\\-–—]+(?:and\\s+\\w+\\s+)?(${NAME})\\b`, "g");
const PERSON_BEFORE = new RegExp(`\\b(${NAME})\\s*[,\\-–—|]\\s*(?:the\\s+|our\\s+)?(${TITLE_WORDS})\\b`, "g");
const NOT_NAMES = /^(Our|The|About|Contact|Meet|Read|Learn|Call|Email|Home|View|More|Your|Free|Get|Privacy|Terms|Copyright|All|New|Best|Top|Why|How)\b/;

const TECH_SIGNATURES: [string, RegExp][] = [
  ["WordPress", /wp-content|wp-includes/i],
  ["Shopify", /cdn\.shopify\.com|myshopify\.com/i],
  ["Wix", /static\.wixstatic\.com|wix\.com/i],
  ["Squarespace", /squarespace\.com|static1\.squarespace/i],
  ["Webflow", /webflow\.(com|io)/i],
  ["GoDaddy Builder", /img1\.wsimg\.com|godaddy/i],
  ["Next.js", /__NEXT_DATA__|\/_next\//],
  ["HubSpot", /js\.hs-scripts\.com|hs-analytics|hubspot/i],
  ["Salesforce", /salesforce|pardot/i],
  ["Google Analytics", /googletagmanager\.com|google-analytics\.com|gtag\(/i],
  ["Meta Pixel", /connect\.facebook\.net|fbq\(/i],
  ["Intercom", /widget\.intercom\.io|intercomSettings/i],
  ["Drift", /js\.driftt\.com/i],
  ["Calendly", /calendly\.com/i],
  ["Stripe", /js\.stripe\.com/i],
  ["jQuery", /jquery(\.min)?\.js/i],
];

const INDUSTRY_KEYWORDS: [string, RegExp][] = [
  ["Home Services", /\b(hvac|plumb(ing|er)|roof(ing|er)|landscap|electrician|pest control|remodel|handyman|cleaning services?|garage door|pool service)/gi],
  ["Construction", /\b(construction|general contractor|excavat|concrete|framing|builders?)\b/gi],
  ["Manufacturing", /\b(manufactur|machin(e|ing) shop|fabricat|cnc|injection mold|industrial|assembly)/gi],
  ["Healthcare", /\b(dental|dentist|clinic|medical|chiropract|physical therapy|veterinar|orthodont|pharmacy|health ?care)/gi],
  ["Professional Services", /\b(accounting|cpa|bookkeeping|tax preparation|law firm|attorney|consulting|engineering firm|architect)/gi],
  ["IT Services", /\b(managed services|msp|it support|cybersecurity|network(ing)? services|it services|help ?desk)\b/gi],
  ["Software", /\b(saas|software|platform|api|app for|cloud-based)\b/gi],
  ["Logistics", /\b(logistics|trucking|freight|warehous|distribution|courier|3pl)/gi],
  ["Food & Beverage", /\b(restaurant|bakery|catering|brewery|coffee|cafe|deli|food|spices?|winery)\b/gi],
  ["Retail & E-commerce", /\b(shop now|add to cart|free shipping|online store|retail|boutique)\b/gi],
  ["Marketing Agency", /\b(marketing agency|digital agency|seo services|advertising agency|branding agency)\b/gi],
  ["Insurance", /\b(insurance agency|insurance broker|coverage|policyholders?)\b/gi],
  ["Education", /\b(school|academy|tutoring|training courses|curriculum)\b/gi],
];

const SCHEMA_INDUSTRY: Record<string, string> = {
  HVACBusiness: "Home Services", Plumber: "Home Services", RoofingContractor: "Home Services",
  Electrician: "Home Services", HousePainter: "Home Services", GeneralContractor: "Construction",
  Dentist: "Healthcare", MedicalClinic: "Healthcare", Physician: "Healthcare", VeterinaryCare: "Healthcare",
  AccountingService: "Professional Services", LegalService: "Professional Services", Attorney: "Professional Services",
  Restaurant: "Food & Beverage", Bakery: "Food & Beverage", FoodEstablishment: "Food & Beverage",
  Store: "Retail & E-commerce", OnlineStore: "Retail & E-commerce", InsuranceAgency: "Insurance",
  SoftwareApplication: "Software", EducationalOrganization: "Education",
};

interface PageFacts {
  url: string;
  text: string;
  html: string;
  title: string;
  description: string;
  siteName: string;
  links: { href: string; text: string }[];
  emails: string[];
  phones: string[];
  jsonLd: Record<string, unknown>[];
}

function parsePage(url: string, html: string): PageFacts {
  // Pad element boundaries so text from adjacent tags doesn't run together
  // ("hello@foo.com" + "What we do" must not become "hello@foo.comWhat").
  const $ = cheerio.load(html.replace(/<\/(p|div|li|h[1-6]|td|th|span|a|section|footer|header|address|strong|b|em|i|label|button)>|<br\s*\/?>/gi, "$& "));
  const jsonLd: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text());
      const flat = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(flat);
        else if (v && typeof v === "object") {
          const o = v as Record<string, unknown>;
          if (Array.isArray(o["@graph"])) flat(o["@graph"]);
          else jsonLd.push(o);
        }
      };
      flat(parsed);
    } catch { /* malformed JSON-LD is common; skip it */ }
  });

  const links: { href: string; text: string }[] = [];
  const emails: string[] = [];
  const phones: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (href.startsWith("mailto:")) emails.push(href.slice(7));
    else if (href.startsWith("tel:")) phones.push(decodeURIComponent(href.slice(4)));
    else links.push({ href, text: $(el).text().trim().slice(0, 80) });
  });

  $("script, style, noscript, svg, iframe").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  emails.push(...(text.match(EMAIL_RE) ?? []));
  // Footer/contact text is where phone numbers live; limit to avoid false hits in long prose.
  phones.push(...(text.match(PHONE_RE) ?? []).slice(0, 10));

  return {
    url,
    text,
    html,
    title: $("title").first().text().trim(),
    description: ($('meta[name="description"]').attr("content") ?? $('meta[property="og:description"]').attr("content") ?? "").trim(),
    siteName: ($('meta[property="og:site_name"]').attr("content") ?? "").trim(),
    links,
    emails,
    phones,
    jsonLd,
  };
}

function findSocials(pages: PageFacts[]): Socials {
  const s: Socials = {};
  const all = pages.flatMap((p) => p.links.map((l) => l.href));
  for (const p of pages) for (const ld of p.jsonLd) {
    const same = ld.sameAs;
    if (Array.isArray(same)) all.push(...same.filter((x): x is string => typeof x === "string"));
    else if (typeof same === "string") all.push(same);
  }
  for (const href of all) {
    if (!s.linkedin && /linkedin\.com\/(company|in|school)\//i.test(href)) s.linkedin = href;
    else if (!s.facebook && /facebook\.com\/(?!sharer|share|dialog|tr\b)/i.test(href)) s.facebook = href;
    else if (!s.instagram && /instagram\.com\/(?!p\/)/i.test(href)) s.instagram = href;
    else if (!s.x && /(twitter|x)\.com\/(?!intent|share|home)/i.test(href)) s.x = href;
    else if (!s.youtube && /youtube\.com\/(channel|c|user|@)/i.test(href)) s.youtube = href;
  }
  return s;
}

function findPeople(pages: PageFacts[]): PersonContact[] {
  const out = new Map<string, PersonContact>();
  const add = (name: string, title: string, source: string) => {
    name = name.trim();
    if (NOT_NAMES.test(name) || name.length > 40) return;
    // "Shannon Lourenzo, Farmer-Owner" must not yield a person called "Lourenzo Farmer".
    if (/\b(Farmer|Owner|Manager|Director|Partner|Team|Group|Family|Company|Services?|Store|Shop|Founder|President|Officer|Staff|Members?)$/.test(name)) return;
    if (!out.has(name)) out.set(name, { name, title: title.replace(/\b\w/g, (c) => c.toUpperCase()), source });
  };
  for (const p of pages) {
    for (const ld of p.jsonLd) {
      for (const key of ["founder", "employee", "member"]) {
        const v = ld[key];
        for (const person of Array.isArray(v) ? v : v ? [v] : []) {
          if (person && typeof person === "object" && typeof (person as Record<string, unknown>).name === "string") {
            add((person as Record<string, string>).name, (person as Record<string, string>).jobTitle ?? (key === "founder" ? "Founder" : "Team"), p.url);
          }
        }
      }
    }
    for (const m of p.text.matchAll(PERSON_AFTER)) add(m[2], m[1], p.url);
    for (const m of p.text.matchAll(PERSON_BEFORE)) add(m[1], m[2], p.url);
  }
  return [...out.values()].slice(0, 5);
}

function guessIndustry(pages: PageFacts[]): string | null {
  for (const p of pages) for (const ld of p.jsonLd) {
    const types = ([] as unknown[]).concat(ld["@type"] ?? []);
    for (const t of types) if (typeof t === "string" && SCHEMA_INDUSTRY[t]) return SCHEMA_INDUSTRY[t];
  }
  // Title and meta description say what the business *is*; body copy is noisier.
  const head = pages.map((p) => `${p.title} ${p.description}`).join(" ");
  const body = pages.map((p) => p.text.slice(0, 20000)).join(" ");
  let best: [string, number] | null = null;
  for (const [industry, re] of INDUSTRY_KEYWORDS) {
    const hits = (head.match(re)?.length ?? 0) * 3 + (body.match(re)?.length ?? 0);
    if (hits >= 2 && (!best || hits > best[1])) best = [industry, hits];
  }
  return best?.[0] ?? null;
}

function guessLocation(pages: PageFacts[]): string | null {
  for (const p of pages) for (const ld of p.jsonLd) {
    const addr = (ld.address ?? (ld.location as Record<string, unknown> | undefined)?.address) as Record<string, string> | string | undefined;
    if (typeof addr === "string") return addr.slice(0, 80);
    if (addr && (addr.addressLocality || addr.addressRegion)) {
      return [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter((x) => typeof x === "string").join(", ");
    }
  }
  for (const p of pages) {
    const m = p.text.match(/\b([A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+)?),\s(A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\s\d{5}\b/);
    if (m) {
      // "123 Main Drive Wauwatosa, WI" captures the street suffix too; drop it.
      const city = m[1].replace(/^(?:(?:Drive|Dr\.?|Road|Rd\.?|Street|St\.?|Avenue|Ave\.?|Blvd\.?|Boulevard|Lane|Ln\.?|Way|Hwy|Highway|Suite|Ste\.?|Court|Ct\.?|Parkway|Pkwy\.?|Place|Pl\.?)\s+)+/, "");
      if (city) return `${city}, ${m[2]}`;
    }
  }
  return null;
}

function cleanName(pages: PageFacts[], domain: string): string {
  for (const p of pages) for (const ld of p.jsonLd) {
    if (typeof ld.name === "string" && /Organization|Business|Corporation|Store|Restaurant|LocalBusiness/i.test(String(ld["@type"]))) return ld.name;
  }
  const home = pages[0];
  if (home?.siteName) return home.siteName;
  const title = home?.title.split(/\s[|–—-]\s|:\s/)[0]?.trim();
  if (title && title.length <= 60 && !/^(home\s?page|home|welcome|index|untitled)$/i.test(title)) return title;
  const base = domain.split(".")[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

// ---------- orchestration ----------

const SUBPAGE_HINT = /\b(about|contact|team|our-story|story|company|leadership|who-we-are|history|owners?)\b/i;

export async function enrichDomain(domain: string): Promise<Enrichment> {
  const base = `https://${domain}`;
  const robotsRes = await safeFetch(`${base}/robots.txt`);
  const robots = robotsRes && /text\/plain/i.test(robotsRes.contentType) ? parseRobots(robotsRes.body) : { allow: [], disallow: [] };

  const blockedByRobots: string[] = [];
  if (!robotsAllows(robots, "/")) blockedByRobots.push("/");

  let home = blockedByRobots.length ? null : await safeFetch(base);
  if (!home && !blockedByRobots.length) home = await safeFetch(`https://www.${domain}`);
  if (!home) {
    throw new Error(blockedByRobots.length ? "Homepage disallowed by robots.txt" : "Site unreachable or not HTML");
  }
  const homeUrl = new URL(home.url);
  const pages: PageFacts[] = [parsePage(home.url, home.body)];

  // Pick a few same-site pages that usually hold contact and ownership details.
  const candidates = new Map<string, number>();
  for (const l of pages[0].links) {
    try {
      const u = new URL(l.href, home.url);
      if (u.hostname.replace(/^www\./, "") !== homeUrl.hostname.replace(/^www\./, "")) continue;
      const key = u.origin + u.pathname.replace(/\/$/, "");
      if (key === homeUrl.origin || candidates.has(key)) continue;
      if (SUBPAGE_HINT.test(u.pathname) || SUBPAGE_HINT.test(l.text)) {
        candidates.set(key, /contact/i.test(u.pathname + l.text) ? 0 : 1);
      }
    } catch { /* ignore malformed hrefs */ }
  }
  const subpages = [...candidates].sort((a, b) => a[1] - b[1]).map(([u]) => u).slice(0, MAX_PAGES - 1);
  const allowed = subpages.filter((u) => {
    const ok = robotsAllows(robots, new URL(u).pathname);
    if (!ok) blockedByRobots.push(new URL(u).pathname);
    return ok;
  });
  const fetched = await Promise.all(allowed.map((u) => safeFetch(u)));
  for (const f of fetched) if (f && /html/i.test(f.contentType)) pages.push(parsePage(f.url, f.body));

  const allText = pages.map((p) => p.text).join(" ");
  const allHtml = pages.map((p) => p.html).join(" ");
  const nowYear = new Date().getFullYear();

  let foundedYear: number | null = null;
  for (const p of pages) for (const ld of p.jsonLd) {
    const fd = ld.foundingDate;
    if (!foundedYear && (typeof fd === "string" || typeof fd === "number")) {
      const y = parseInt(String(fd).slice(0, 4), 10);
      if (y > 1800 && y <= nowYear) foundedYear = y;
    }
  }
  if (!foundedYear) {
    // Pages mention several "since YYYY" milestones; the oldest is usually the founding.
    const years = [...allText.matchAll(new RegExp(FOUNDED_RE.source, "gi"))].map((m) => parseInt(m[1], 10)).filter((y) => y <= nowYear);
    if (years.length) foundedYear = Math.min(...years);
  }
  if (!foundedYear) {
    const m = allText.match(YEARS_RE);
    if (m && +m[1] < 200) foundedYear = nowYear - parseInt(m[1], 10);
  }
  if (foundedYear && (foundedYear < 1800 || foundedYear > nowYear)) foundedYear = null;

  const copyrightYears = [...allText.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})/gi)].map((m) => +m[1]).filter((y) => y <= nowYear);
  const copyrightYear = copyrightYears.length ? Math.max(...copyrightYears) : null;

  const emailFinds = pages.flatMap((p) => p.emails.map((address) => ({ address, source: p.url })));
  for (const p of pages) for (const ld of p.jsonLd) if (typeof ld.email === "string") emailFinds.push({ address: ld.email, source: p.url });
  const phoneFinds = pages.flatMap((p) => p.phones.map((raw) => ({ raw, source: p.url })));
  for (const p of pages) for (const ld of p.jsonLd) if (typeof ld.telephone === "string") phoneFinds.unshift({ raw: ld.telephone, source: p.url });

  const people = findPeople(pages);
  const description = pages[0].description || pages.find((p) => p.description)?.description || "";

  return {
    domain,
    name: cleanName(pages, domain),
    description: description.slice(0, 300),
    industry: guessIndustry(pages),
    location: guessLocation(pages),
    foundedYear,
    copyrightYear,
    emails: await validateEmails(emailFinds, domain),
    phones: normalizePhones(phoneFinds),
    people,
    socials: findSocials(pages),
    tech: TECH_SIGNATURES.filter(([, re]) => re.test(allHtml)).map(([name]) => name),
    signals: {
      familyOwned: FAMILY_RE.test(allText),
      ownerOperated: OWNER_RE.test(allText) || people.some((p) => /owner|founder/i.test(p.title)),
      hiring: pages.some((p) => p.links.some((l) => /careers|jobs|join-our-team|we're hiring|now hiring/i.test(l.href + " " + l.text))),
      ecommerce: /add to cart|shopping cart|checkout/i.test(allText) || /cdn\.shopify\.com/i.test(allHtml),
      onlineBooking: /book (an |your )?(appointment|online|now)|schedule (service|online|an appointment)|calendly\.com/i.test(allText + allHtml),
    },
    pagesCrawled: pages.map((p) => p.url),
    blockedByRobots,
    scrapedAt: Date.now(),
  };
}
