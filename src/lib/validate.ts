import { promises as dns } from "node:dns";
import net from "node:net";
import type { EmailContact, EmailStatus, PhoneContact } from "./types";

// Department inboxes, matched as substrings so "bizgifts@" and "customercare@" count too.
const ROLE_KEYWORDS = [
  "info", "contact", "sales", "support", "admin", "office", "hello", "service",
  "help", "team", "career", "job", "hr", "billing", "account", "marketing",
  "media", "press", "reply", "webmaster", "order", "enquir", "inquir", "general",
  "mail", "event", "gift", "store", "shop", "wholesale", "catering", "booking",
  "reserv", "feedback", "privacy", "legal", "care", "present", "location", "visit",
  "tech", "dispatch", "quote", "estimat", "hiring", "partner", "invoice", "accessib",
];
const isRoleLocal = (local: string) => {
  const l = local.toLowerCase().replace(/[^a-z]/g, "");
  return l.length <= 2 || ROLE_KEYWORDS.some((k) => l.includes(k));
};

// Placeholder or vendor addresses that show up in page source but aren't leads.
const JUNK_EMAIL_DOMAINS = [
  "example.com", "domain.com", "email.com", "yourdomain.com", "sentry.io",
  "wixpress.com", "sentry-next.wixpress.com", "godaddy.com", "squarespace.com",
  "shopify.com", "wordpress.com", "schema.org", "w3.org",
];

const EMAIL_SYNTAX = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/;

export function isPlausibleEmail(address: string): boolean {
  const a = address.toLowerCase();
  if (!EMAIL_SYNTAX.test(a)) return false;
  // Retina image names like logo@2x.png match the email pattern.
  if (/\.(png|jpe?g|gif|svg|webp|css|js)$/.test(a)) return false;
  const domain = a.split("@")[1];
  return !JUNK_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith("." + d));
}

const mxCache = new Map<string, Promise<boolean>>();

/** True if the domain publishes MX records (or an A record, per RFC 5321 fallback). */
export function domainAcceptsMail(domain: string): Promise<boolean> {
  let p = mxCache.get(domain);
  if (!p) {
    p = dns
      .resolveMx(domain)
      .then((r) => r.length > 0)
      .catch(() => dns.resolve4(domain).then((r) => r.length > 0).catch(() => false));
    mxCache.set(domain, p);
  }
  return p;
}

export async function validateEmails(
  found: { address: string; source: string }[],
  companyDomain: string,
): Promise<EmailContact[]> {
  const unique = new Map<string, string>();
  for (const f of found) {
    const a = f.address.toLowerCase().replace(/^mailto:/, "").split("?")[0].trim();
    if (isPlausibleEmail(a) && !unique.has(a)) unique.set(a, f.source);
  }
  const results = await Promise.all(
    [...unique].map(async ([address, source]): Promise<EmailContact> => {
      const [local, domain] = address.split("@");
      const ok = await domainAcceptsMail(domain);
      const status: EmailStatus = ok ? "deliverable-domain" : "no-mx";
      return {
        address,
        status,
        isRole: isRoleLocal(local),
        onDomain: domain === companyDomain || domain.endsWith("." + companyDomain),
        source,
      };
    }),
  );
  // Best first: deliverable, on-domain, named person.
  const rank = (e: EmailContact) =>
    (e.status === "deliverable-domain" ? 4 : 0) + (e.onDomain ? 2 : 0) + (e.isRole ? 0 : 1);
  return results.sort((a, b) => rank(b) - rank(a)).slice(0, 8);
}

/** Normalise North American numbers; keep other plausible international numbers as-is. */
export function normalizePhones(found: { raw: string; source: string }[]): PhoneContact[] {
  const out = new Map<string, PhoneContact>();
  for (const { raw, source } of found) {
    let digits = raw.replace(/\D/g, "");
    const nanp = digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
    const intl = raw.trim().startsWith("+") && !nanp;
    if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
    if (!intl && digits.length === 10) {
      if (/^(\d)\1{9}$/.test(digits) || digits === "1234567890") continue;
      if (/^[01]/.test(digits) || /^\d{3}555/.test(digits)) continue; // invalid area code / fictional
      const e164 = "+1" + digits;
      if (!out.has(e164)) {
        out.set(e164, {
          e164,
          display: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`,
          source,
        });
      }
    } else if (intl && digits.length >= 8 && digits.length <= 15) {
      const e164 = "+" + digits;
      if (!out.has(e164)) out.set(e164, { e164, display: raw.trim(), source });
    }
  }
  return [...out.values()].slice(0, 5);
}

/** SSRF guard: refuse to fetch hosts that resolve to private or loopback ranges. */
export async function isPublicHost(hostname: string): Promise<boolean> {
  try {
    const addrs = await dns.lookup(hostname, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateIp(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}
