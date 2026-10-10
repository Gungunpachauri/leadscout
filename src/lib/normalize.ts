// Turns messy user input (URLs, emails, "www.Foo.com/about") into clean,
// deduplicated domains. Runs in both the browser and the API route.

import Papa from "papaparse";

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

export function normalizeDomain(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  // Accept an email and use its domain.
  if (s.includes("@") && !s.includes("/")) s = s.split("@").pop() ?? "";
  s = s.replace(/^[a-z]+:\/\//, "");
  s = s.split(/[/?#\s]/)[0];
  s = s
    .replace(/:\d+$/, "")
    .replace(/^www\d?\./, "")
    .replace(/\.$/, "");
  return DOMAIN_RE.test(s) ? s : null;
}

export interface ParsedInput {
  rows: { domain: string; name?: string }[];
  duplicates: number;
  invalid: string[];
}

/** Dedupe by normalised domain, keeping the first name seen. */
export function dedupeInputs(items: { value: string; name?: string }[]): ParsedInput {
  const seen = new Map<string, { domain: string; name?: string }>();
  const invalid: string[] = [];
  let duplicates = 0;
  for (const item of items) {
    if (!item.value.trim()) continue;
    const domain = normalizeDomain(item.value);
    if (!domain) {
      invalid.push(item.value.trim());
      continue;
    }
    if (seen.has(domain)) {
      duplicates++;
      const existing = seen.get(domain)!;
      if (!existing.name && item.name) existing.name = item.name;
      continue;
    }
    seen.set(domain, { domain, name: item.name?.trim() || undefined });
  }
  return { rows: [...seen.values()], duplicates, invalid };
}

/**
 * Turn pasted text or CSV content into raw rows. A first line is only treated
 * as a header if it names a recognisable website/domain/email column and does
 * not itself look like a domain (so a plain "mysite.com" list keeps row one).
 */
export function parseImport(text: string): { value: string; name?: string }[] {
  const trimmed = text.replace(/^﻿/, "").trim();
  if (!trimmed) return [];
  const res = Papa.parse<string[]>(trimmed, { skipEmptyLines: true });
  const rows = res.data.filter((r) => Array.isArray(r) && r.some((c) => String(c).trim()));
  if (!rows.length) return [];
  const header = rows[0].map((c) => String(c));
  const headerLooksLikeData = header.some((h) => normalizeDomain(h) !== null);
  const { domainCol, nameCol } = headerLooksLikeData ? {} : guessColumns(header);
  if (domainCol === undefined) {
    // Plain list: every cell is a candidate domain.
    return rows.flat().map((value) => ({ value: String(value) }));
  }
  const di = header.indexOf(domainCol);
  const ni = nameCol !== undefined ? header.indexOf(nameCol) : -1;
  return rows.slice(1).map((r) => ({ value: String(r[di] ?? ""), name: ni >= 0 ? String(r[ni] ?? "") : undefined }));
}

/** Pick the column most likely to hold a website from CSV headers. */
export function guessColumns(headers: string[]): { domainCol?: string; nameCol?: string } {
  const lower = headers.map((h) => h.toLowerCase().trim());
  const find = (patterns: RegExp[]) => {
    for (const p of patterns) {
      const i = lower.findIndex((h) => p.test(h));
      if (i >= 0) return headers[i];
    }
    return undefined;
  };
  return {
    domainCol: find([/^(company )?domain/, /website/, /^url$/, /site/, /domain/, /e-?mail/]),
    nameCol: find([/^(company|business|organization|account)( name)?$/, /company/, /^name$/, /business/]),
  };
}
