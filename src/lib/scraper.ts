import * as cheerio from "cheerio";
import { safeFetch } from "./http";
import {
  ENRICHMENT_VERSION,
  type Enrichment,
  type Evidence,
  type FactKey,
  type PersonContact,
  type Socials,
} from "./types";
import { normalizePhones, validateEmails } from "./validate";

const MAX_PAGES = 4;

// ---------- robots.txt ----------

export type RobotsRules = { allow: string[]; disallow: string[] };

export function parseRobots(txt: string): RobotsRules {
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
      if (sawRuleInGroup) {
        inStar = false;
        sawRuleInGroup = false;
      }
      if (val === "*") inStar = true;
    } else if (key === "allow" || key === "disallow") {
      sawRuleInGroup = true;
      if (inStar && val) rules[key].push(val);
    }
  }
  return rules;
}

export function robotsAllows(rules: RobotsRules, path: string): boolean {
  // Longest matching rule wins, per RFC 9309.
  const match = (p: string) => {
    const re = new RegExp(
      "^" +
        p
          .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\\\$$/, "$"),
    );
    return re.test(path) ? p.length : -1;
  };
  const allow = Math.max(-1, ...rules.allow.map(match));
  const disallow = Math.max(-1, ...rules.disallow.map(match));
  return disallow < 0 || allow >= disallow;
}

// ---------- extraction ----------

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const FOUNDED_RE =
  /\b(?:since|established|est\.?|founded(?:\s+in)?|serving[^.]{0,40}since|in business since)\s*(?:in\s*)?((?:18|19|20)\d{2})\b/gi;
// "for 25 years" usually describes a person's tenure, so only lower-bound phrasing counts.
const YEARS_RE = /\b(?:over|more than|nearly|almost)\s+(\d{2,3})\s+years\b/i;
// "Nth generation" alone often comes from customer reviews ("the 4th generation visited"),
// so it only counts when tied to the business itself.
const FAMILY_RE =
  /\b(family[- ]owned|family[- ]run|family business|owned by the [A-Z][a-z]+ family|(?:second|third|fourth|fifth|2nd|3rd|4th|5th)[- ]generation[- ](?:family|owned|business|company|owners?|operated))\b/i;
const OWNER_RE =
  /\b(owner[- ]operated|locally owned|independently owned|veteran[- ]owned|woman[- ]owned|women[- ]owned|owned and operated)\b/i;
// Title words match in lower or Title case, but names must stay case-sensitive,
// so we can't use the regex "i" flag.
const TITLE_WORDS = [
  "founder",
  "co-founder",
  "owner",
  "president",
  "ceo",
  "principal",
  "managing partner",
  "managing director",
]
  .map((w) => w.replace(/\b[a-z]/g, (c) => `[${c.toUpperCase()}${c}]`))
  .concat("CEO")
  .join("|");
const NAME = "[A-Z][a-z]+(?:\\s[A-Z]\\.)?\\s[A-Z][a-z][a-zA-Z'’-]*";
const PERSON_AFTER = new RegExp(`\\b(${TITLE_WORDS})\\b[\\s,:\\-–—]+(?:and\\s+\\w+\\s+)?(${NAME})\\b`, "g");
const PERSON_BEFORE = new RegExp(`\\b(${NAME})\\s*[,\\-–—|]\\s*(?:the\\s+|our\\s+)?(${TITLE_WORDS})\\b`, "g");
const NOT_NAMES =
  /^(Our|The|About|Contact|Meet|Read|Learn|Call|Email|Home|View|More|Your|Free|Get|Privacy|Terms|Copyright|All|New|Best|Top|Why|How)\b/;
const NOT_SURNAMES =
  /\b(Farmer|Owner|Manager|Director|Partner|Team|Group|Family|Company|Services?|Store|Shop|Founder|President|Officer|Staff|Members?)$/;

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
  ["BigCommerce", /cdn\d*\.bigcommerce\.com|bigcommerce\.com\/s-/i],
  ["Magento", /mage\/cookies|Magento_|requirejs-config\.js/i],
  ["Salesforce Commerce Cloud", /demandware\.(static|store|net)|\/on\/demandware\./i],
  ["WooCommerce", /woocommerce/i],
  ["jQuery", /jquery(\.min)?\.js/i],
];

const INDUSTRY_KEYWORDS: [string, RegExp][] = [
  [
    "Home Services",
    /\b(hvac|plumb(?:ing|er)|roof(?:ing|er)|landscap\w*|electrician|pest control|remodel\w*|handyman|cleaning services?|garage door|pool service)/gi,
  ],
  ["Construction", /\b(construction|general contractor|excavat\w*|concrete|framing|builders?)\b/gi],
  ["Manufacturing", /\b(manufactur\w*|machin(?:e|ing) shop|fabricat\w*|cnc|injection mold\w*|industrial|assembly)/gi],
  [
    "Healthcare",
    /\b(dental|dentist|clinic|medical|chiropract\w*|physical therapy|veterinar\w*|orthodont\w*|pharmacy|health ?care)/gi,
  ],
  [
    "Professional Services",
    /\b(accounting|cpa|bookkeeping|tax preparation|law firm|attorney|consulting|engineering firm|architect\w*)/gi,
  ],
  [
    "IT Services",
    /\b(managed services|msp|it support|cybersecurity|network(?:ing)? services|it services|help ?desk)\b/gi,
  ],
  ["Software", /\b(saas|software|platform|api|app for|cloud-based)\b/gi],
  ["Logistics", /\b(logistics|trucking|freight|warehous\w*|distribution|courier|3pl)/gi],
  ["Food & Beverage", /\b(restaurant|bakery|catering|brewery|coffee|cafe|deli|food|spices?|winery)\b/gi],
  ["Retail & E-commerce", /\b(shop now|add to cart|free shipping|online store|retail|boutique)\b/gi],
  ["Marketing Agency", /\b(marketing agency|digital agency|seo services|advertising agency|branding agency)\b/gi],
  ["Insurance", /\b(insurance agency|insurance broker|coverage|policyholders?)\b/gi],
  ["Education", /\b(school|academy|tutoring|training courses|curriculum)\b/gi],
];

const SCHEMA_INDUSTRY: Record<string, string> = {
  HVACBusiness: "Home Services",
  Plumber: "Home Services",
  RoofingContractor: "Home Services",
  Electrician: "Home Services",
  HousePainter: "Home Services",
  GeneralContractor: "Construction",
  Dentist: "Healthcare",
  MedicalClinic: "Healthcare",
  Physician: "Healthcare",
  VeterinaryCare: "Healthcare",
  AccountingService: "Professional Services",
  LegalService: "Professional Services",
  Attorney: "Professional Services",
  Restaurant: "Food & Beverage",
  Bakery: "Food & Beverage",
  FoodEstablishment: "Food & Beverage",
  Store: "Retail & E-commerce",
  OnlineStore: "Retail & E-commerce",
  InsuranceAgency: "Insurance",
  SoftwareApplication: "Software",
  EducationalOrganization: "Education",
};

export interface PageFacts {
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

/** ~140-char excerpt around a match, for showing evidence in the UI. */
function excerpt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + length + 60);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

export function parsePage(url: string, html: string): PageFacts {
  // Pad element boundaries so text from adjacent tags doesn't run together
  // ("hello@foo.com" + "What we do" must not become "hello@foo.comWhat").
  const $ = cheerio.load(
    html.replace(
      /<\/(p|div|li|h[1-6]|td|th|span|a|section|footer|header|address|strong|b|em|i|label|button)>|<br\s*\/?>/gi,
      "$& ",
    ),
  );
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
    } catch {
      /* malformed JSON-LD is common; skip it */
    }
  });

  const links: { href: string; text: string }[] = [];
  const emails: string[] = [];
  const phones: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (href.startsWith("mailto:")) emails.push(href.slice(7));
    else if (href.startsWith("tel:")) {
      try {
        phones.push(decodeURIComponent(href.slice(4)));
      } catch {
        /* bad escape */
      }
    } else links.push({ href, text: $(el).text().trim().slice(0, 80) });
  });

  $("script, style, noscript, svg, iframe, template").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  emails.push(...(text.match(EMAIL_RE) ?? []));
  // Footer/contact text is where phone numbers live; limit to avoid false hits in long prose.
  phones.push(...(text.match(PHONE_RE) ?? []).slice(0, 10));

  return {
    url,
    text,
    html,
    title: $("title").first().text().trim(),
    description: (
      $('meta[name="description"]').attr("content") ??
      $('meta[property="og:description"]').attr("content") ??
      ""
    ).trim(),
    siteName: ($('meta[property="og:site_name"]').attr("content") ?? "").trim(),
    links,
    emails,
    phones,
    jsonLd,
  };
}

type Found<T> = { value: T; evidence: Evidence } | null;

function findSocials(pages: PageFacts[]): Socials {
  const s: Socials = {};
  const all = pages.flatMap((p) => p.links.map((l) => l.href));
  for (const p of pages)
    for (const ld of p.jsonLd) {
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
  const add = (name: string, title: string, evidence: Evidence) => {
    name = name.trim();
    if (NOT_NAMES.test(name) || NOT_SURNAMES.test(name) || name.length > 40) return;
    if (!out.has(name)) out.set(name, { name, title: title.replace(/\b\w/g, (c) => c.toUpperCase()), evidence });
  };
  for (const p of pages) {
    for (const ld of p.jsonLd) {
      for (const key of ["founder", "employee", "member"]) {
        const v = ld[key];
        for (const person of Array.isArray(v) ? v : v ? [v] : []) {
          const o = person as Record<string, unknown> | null;
          if (o && typeof o === "object" && typeof o.name === "string") {
            const title = typeof o.jobTitle === "string" ? o.jobTitle : key === "founder" ? "Founder" : "Team";
            add(o.name, title, {
              method: "structured",
              confidence: "high",
              source: p.url,
              snippet: `schema.org ${key}: ${o.name}`,
            });
          }
        }
      }
    }
    for (const m of p.text.matchAll(PERSON_AFTER)) {
      add(m[2], m[1], {
        method: "inferred",
        confidence: "medium",
        source: p.url,
        snippet: excerpt(p.text, m.index ?? 0, m[0].length),
      });
    }
    for (const m of p.text.matchAll(PERSON_BEFORE)) {
      add(m[1], m[2], {
        method: "inferred",
        confidence: "medium",
        source: p.url,
        snippet: excerpt(p.text, m.index ?? 0, m[0].length),
      });
    }
  }
  // Structured entries first; they are the most trustworthy.
  return [...out.values()]
    .sort((a, b) => (a.evidence.method === "structured" ? 0 : 1) - (b.evidence.method === "structured" ? 0 : 1))
    .slice(0, 5);
}

function findIndustry(pages: PageFacts[]): Found<string> {
  for (const p of pages)
    for (const ld of p.jsonLd) {
      const types = ([] as unknown[]).concat(ld["@type"] ?? []);
      for (const t of types) {
        if (typeof t === "string" && SCHEMA_INDUSTRY[t]) {
          return {
            value: SCHEMA_INDUSTRY[t],
            evidence: { method: "structured", confidence: "high", source: p.url, snippet: `schema.org @type: ${t}` },
          };
        }
      }
    }
  // Title and meta description say what the business *is*; body copy is noisier.
  const head = pages.map((p) => `${p.title} ${p.description}`).join(" ");
  const body = pages.map((p) => p.text.slice(0, 20000)).join(" ");
  let best: { industry: string; score: number; headHits: number; terms: Map<string, number> } | null = null;
  for (const [industry, re] of INDUSTRY_KEYWORDS) {
    const headMatches = head.match(re) ?? [];
    const bodyMatches = body.match(re) ?? [];
    const score = headMatches.length * 3 + bodyMatches.length;
    if (score >= 2 && (!best || score > best.score)) {
      const terms = new Map<string, number>();
      for (const t of [...headMatches, ...bodyMatches])
        terms.set(t.toLowerCase(), (terms.get(t.toLowerCase()) ?? 0) + 1);
      best = { industry, score, headHits: headMatches.length, terms };
    }
  }
  if (!best) return null;
  const top = [...best.terms]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([t, n]) => `"${t}" ×${n}`)
    .join(", ");
  return {
    value: best.industry,
    evidence: {
      method: "inferred",
      confidence: best.headHits > 0 && best.score >= 6 ? "medium" : "low",
      source: pages[0].url,
      snippet: `Keyword match: ${top}`,
    },
  };
}

function findLocation(pages: PageFacts[]): Found<string> {
  for (const p of pages)
    for (const ld of p.jsonLd) {
      const addr = (ld.address ?? (ld.location as Record<string, unknown> | undefined)?.address) as
        Record<string, string> | string | undefined;
      if (typeof addr === "string" && addr.trim()) {
        return {
          value: addr.slice(0, 80),
          evidence: {
            method: "structured",
            confidence: "high",
            source: p.url,
            snippet: `schema.org address: ${addr.slice(0, 80)}`,
          },
        };
      }
      if (addr && typeof addr === "object" && (addr.addressLocality || addr.addressRegion)) {
        const value = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
          .filter((x) => typeof x === "string")
          .join(", ");
        return {
          value,
          evidence: {
            method: "structured",
            confidence: "high",
            source: p.url,
            snippet: `schema.org address: ${value}`,
          },
        };
      }
    }
  for (const p of pages) {
    const m = p.text.match(
      /\b([A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+)?),\s(A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\s\d{5}\b/,
    );
    if (m) {
      // "123 Main Drive Wauwatosa, WI" captures the street suffix too; drop it.
      const city = m[1].replace(
        /^(?:(?:Drive|Dr\.?|Road|Rd\.?|Street|St\.?|Avenue|Ave\.?|Blvd\.?|Boulevard|Lane|Ln\.?|Way|Hwy|Highway|Suite|Ste\.?|Court|Ct\.?|Parkway|Pkwy\.?|Place|Pl\.?)\s+)+/,
        "",
      );
      if (city) {
        return {
          value: `${city}, ${m[2]}`,
          evidence: {
            method: "stated",
            confidence: "medium",
            source: p.url,
            snippet: excerpt(p.text, m.index ?? 0, m[0].length),
          },
        };
      }
    }
  }
  return null;
}

function findFounded(pages: PageFacts[], nowYear: number): Found<number> {
  for (const p of pages)
    for (const ld of p.jsonLd) {
      const fd = ld.foundingDate;
      if (typeof fd === "string" || typeof fd === "number") {
        const y = parseInt(String(fd).slice(0, 4), 10);
        if (y > 1800 && y <= nowYear) {
          return {
            value: y,
            evidence: {
              method: "structured",
              confidence: "high",
              source: p.url,
              snippet: `schema.org foundingDate: ${fd}`,
            },
          };
        }
      }
    }
  // Pages mention several "since YYYY" milestones; the oldest is usually the founding.
  let oldest: Found<number> = null;
  for (const p of pages) {
    for (const m of p.text.matchAll(FOUNDED_RE)) {
      const y = parseInt(m[1], 10);
      if (y < 1800 || y > nowYear) continue;
      if (!oldest || y < oldest.value) {
        oldest = {
          value: y,
          evidence: {
            method: "stated",
            confidence: "high",
            source: p.url,
            snippet: excerpt(p.text, m.index ?? 0, m[0].length),
          },
        };
      }
    }
  }
  if (oldest) return oldest;
  for (const p of pages) {
    const m = p.text.match(YEARS_RE);
    if (m && +m[1] < 200) {
      // "Over 30 years" is a lower bound, not a founding date.
      return {
        value: nowYear - parseInt(m[1], 10),
        evidence: {
          method: "inferred",
          confidence: "low",
          source: p.url,
          snippet: excerpt(p.text, m.index ?? 0, m[0].length),
        },
      };
    }
  }
  return null;
}

function findPattern(pages: PageFacts[], re: RegExp): Found<true> {
  for (const p of pages) {
    const m = p.text.match(re);
    if (m)
      return {
        value: true,
        evidence: {
          method: "stated",
          confidence: "high",
          source: p.url,
          snippet: excerpt(p.text, m.index ?? 0, m[0].length),
        },
      };
  }
  return null;
}

function findName(pages: PageFacts[], domain: string): { value: string; evidence: Evidence } {
  for (const p of pages)
    for (const ld of p.jsonLd) {
      const types = ([] as unknown[]).concat(ld["@type"] ?? []).map(String);
      const isOrg = types.some(
        (t) => /Organization|Business|Corporation|Store|Restaurant/i.test(t) || t in SCHEMA_INDUSTRY,
      );
      if (typeof ld.name === "string" && ld.name.trim() && isOrg) {
        return {
          value: ld.name,
          evidence: { method: "structured", confidence: "high", source: p.url, snippet: `schema.org name: ${ld.name}` },
        };
      }
    }
  const home = pages[0];
  if (home.siteName)
    return {
      value: home.siteName,
      evidence: { method: "stated", confidence: "high", source: home.url, snippet: `og:site_name: ${home.siteName}` },
    };
  const title = home.title.split(/\s[|–—-]\s|:\s/)[0]?.trim();
  if (title && title.length <= 60 && !/^(home\s?page|home|welcome|index|untitled)$/i.test(title)) {
    return {
      value: title,
      evidence: {
        method: "inferred",
        confidence: "medium",
        source: home.url,
        snippet: `Page title: ${home.title.slice(0, 100)}`,
      },
    };
  }
  const base = domain.split(".")[0];
  return {
    value: base.charAt(0).toUpperCase() + base.slice(1),
    evidence: { method: "inferred", confidence: "low", source: home.url, snippet: `Derived from domain ${domain}` },
  };
}

/**
 * Pure extraction over already-fetched pages. Everything except email MX
 * checks happens here, so it can be unit-tested against fixture HTML.
 */
export function analyzePages(domain: string, pages: PageFacts[], nowYear = new Date().getFullYear()) {
  const allText = pages.map((p) => p.text).join(" ");
  const allHtml = pages.map((p) => p.html).join(" ");
  const evidence: Partial<Record<FactKey, Evidence>> = {};

  const name = findName(pages, domain);
  evidence.name = name.evidence;

  const descPage = pages.find((p) => p.description);
  if (descPage)
    evidence.description = { method: "stated", confidence: "high", source: descPage.url, snippet: "Meta description" };

  const industry = findIndustry(pages);
  if (industry) evidence.industry = industry.evidence;
  const location = findLocation(pages);
  if (location) evidence.location = location.evidence;
  const founded = findFounded(pages, nowYear);
  if (founded) evidence.foundedYear = founded.evidence;

  const people = findPeople(pages);
  const family = findPattern(pages, FAMILY_RE);
  if (family) evidence.familyOwned = family.evidence;
  let owner = findPattern(pages, OWNER_RE);
  if (!owner) {
    const p = people.find((x) => /owner|founder/i.test(x.title));
    if (p) owner = { value: true, evidence: { ...p.evidence, method: "inferred", confidence: "medium" } };
  }
  if (owner) evidence.ownerOperated = owner.evidence;

  const copyrightYears = [...allText.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})/gi)]
    .map((m) => +m[1])
    .filter((y) => y <= nowYear);

  const emailFinds = pages.flatMap((p) => p.emails.map((address) => ({ address, source: p.url })));
  for (const p of pages)
    for (const ld of p.jsonLd) if (typeof ld.email === "string") emailFinds.push({ address: ld.email, source: p.url });
  const phoneFinds = pages.flatMap((p) => p.phones.map((raw) => ({ raw, source: p.url })));
  for (const p of pages)
    for (const ld of p.jsonLd)
      if (typeof ld.telephone === "string") phoneFinds.unshift({ raw: ld.telephone, source: p.url });

  return {
    name: name.value,
    description: (descPage?.description ?? "").slice(0, 300),
    industry: industry?.value ?? null,
    location: location?.value ?? null,
    foundedYear: founded?.value ?? null,
    copyrightYear: copyrightYears.length ? Math.max(...copyrightYears) : null,
    people,
    phones: normalizePhones(phoneFinds),
    emailFinds,
    socials: findSocials(pages),
    tech: TECH_SIGNATURES.filter(([, re]) => re.test(allHtml)).map(([n]) => n),
    signals: {
      familyOwned: Boolean(family),
      ownerOperated: Boolean(owner),
      hiring: pages.some((p) =>
        p.links.some((l) => /careers|jobs|join-our-team|we're hiring|now hiring/i.test(l.href + " " + l.text)),
      ),
      ecommerce: detectEcommerce(pages, allText, allHtml),
      onlineBooking:
        /book (an |your )?(appointment|online|now)|schedule (service|online|an appointment)|calendly\.com/i.test(
          allText + allHtml,
        ),
    },
    evidence,
    thinContent: allText.length < 400,
  };
}

const COMMERCE_PLATFORMS =
  /cdn\.shopify\.com|myshopify\.com|cdn\d*\.bigcommerce\.com|demandware\.(static|store|net)|\/on\/demandware\.|woocommerce|mage\/cookies|Magento_|squarespace-commerce|ecwid\.com|snipcart/i;
const CART_PATH = /\/(cart|basket|bag|checkout|shopping-?cart)(\/|\?|#|$)/i;
const CART_TEXT =
  /\b(add to (cart|bag|basket)|shopping (cart|bag)|view (cart|bag)|checkout|free shipping on orders)\b/i;

/**
 * Online store detection. Large retailers often render the cart with
 * JavaScript, so page wording alone misses them; cart/checkout links and
 * commerce-platform fingerprints in the HTML are checked too.
 */
export function detectEcommerce(pages: PageFacts[], allText: string, allHtml: string): boolean {
  if (CART_TEXT.test(allText) || COMMERCE_PLATFORMS.test(allHtml)) return true;
  return pages.some((p) =>
    p.links.some((l) => {
      try {
        return CART_PATH.test(new URL(l.href, p.url).pathname);
      } catch {
        return false;
      }
    }),
  );
}

// ---------- orchestration ----------

const SUBPAGE_HINT = /\b(about|contact|team|our-story|story|company|leadership|who-we-are|history|owners?)\b/i;

export async function enrichDomain(domain: string): Promise<Enrichment> {
  const base = `https://${domain}`;
  const robotsRes = await safeFetch(`${base}/robots.txt`);
  const robots =
    robotsRes && /text\/plain/i.test(robotsRes.contentType) ? parseRobots(robotsRes.body) : { allow: [], disallow: [] };

  const blockedByRobots: string[] = [];
  if (!robotsAllows(robots, "/")) blockedByRobots.push("/");

  let home = blockedByRobots.length ? null : await safeFetch(base);
  if (!home && !blockedByRobots.length) home = await safeFetch(`https://www.${domain}`);
  if (!home) throw new Error(blockedByRobots.length ? "Homepage disallowed by robots.txt" : "Site unreachable");
  if (!/html|text\/plain/i.test(home.contentType) && home.contentType) throw new Error("Homepage is not HTML");

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
    } catch {
      /* ignore malformed hrefs */
    }
  }
  const subpages = [...candidates]
    .sort((a, b) => a[1] - b[1])
    .map(([u]) => u)
    .slice(0, MAX_PAGES - 1);
  const allowed = subpages.filter((u) => {
    const ok = robotsAllows(robots, new URL(u).pathname);
    if (!ok) blockedByRobots.push(new URL(u).pathname);
    return ok;
  });
  const fetched = await Promise.all(allowed.map((u) => safeFetch(u)));
  for (const f of fetched) if (f && /html/i.test(f.contentType)) pages.push(parsePage(f.url, f.body));

  const { emailFinds, ...facts } = analyzePages(domain, pages);
  return {
    version: ENRICHMENT_VERSION,
    domain,
    ...facts,
    emails: await validateEmails(emailFinds, domain),
    pagesCrawled: pages.map((p) => p.url),
    blockedByRobots,
    scrapedAt: Date.now(),
  };
}
