// Turns messy user input (URLs, emails, "www.Foo.com/about") into clean,
// deduplicated domains. Runs in both the browser and the API route.

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

export function normalizeDomain(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  // Accept an email and use its domain.
  if (s.includes("@") && !s.includes("/")) s = s.split("@").pop() ?? "";
  s = s.replace(/^[a-z]+:\/\//, "");
  s = s.split(/[/?#\s]/)[0];
  s = s.replace(/:\d+$/, "").replace(/^www\d?\./, "").replace(/\.$/, "");
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
