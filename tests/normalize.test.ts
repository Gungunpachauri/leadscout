import { describe, expect, it } from "vitest";
import { dedupeInputs, guessColumns, normalizeDomain, parseImport } from "@/lib/normalize";

describe("normalizeDomain", () => {
  it.each([
    ["acme.com", "acme.com"],
    ["  ACME.com  ", "acme.com"],
    ["https://www.acme.com/about?x=1#team", "acme.com"],
    ["http://www2.acme.co.uk:8080/", "acme.co.uk"],
    ["owner@acme.com", "acme.com"],
    ["sub.acme.com.", "sub.acme.com"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it.each(["", "not a website", "localhost", "acme", "http://", "-bad-.com", "a@b"])("rejects %j", (input) => {
    expect(normalizeDomain(input)).toBeNull();
  });
});

describe("dedupeInputs", () => {
  it("merges variants of the same domain and reports invalid rows", () => {
    const r = dedupeInputs([
      { value: "https://www.acme.com/about" },
      { value: "acme.com", name: "Acme Inc" },
      { value: "info@acme.com" },
      { value: "beta.io" },
      { value: "not a website" },
      { value: "   " },
    ]);
    expect(r.rows.map((x) => x.domain)).toEqual(["acme.com", "beta.io"]);
    expect(r.duplicates).toBe(2);
    expect(r.invalid).toEqual(["not a website"]);
    // The first name seen for a domain is kept, even if it arrives on a duplicate row.
    expect(r.rows[0].name).toBe("Acme Inc");
  });
});

describe("guessColumns", () => {
  it("finds SaaSquatch-style headers", () => {
    expect(guessColumns(["Company Name", "Website", "Industry"])).toEqual({ domainCol: "Website", nameCol: "Company Name" });
    expect(guessColumns(["business", "URL"])).toEqual({ domainCol: "URL", nameCol: "business" });
    expect(guessColumns(["Account", "Email"])).toEqual({ domainCol: "Email", nameCol: "Account" });
  });
});

describe("parseImport", () => {
  it("reads a CSV with a recognised header", () => {
    const rows = parseImport('Company Name,Website\n"Acme, Inc.",acme.com\nBeta,https://beta.io/');
    expect(rows).toEqual([{ value: "acme.com", name: "Acme, Inc." }, { value: "https://beta.io/", name: "Beta" }]);
  });

  it("treats a plain list as data, including a first line that contains 'site'", () => {
    expect(parseImport("mysite.com\nacme.com").map((r) => r.value)).toEqual(["mysite.com", "acme.com"]);
  });

  it("accepts comma-separated lists and strips a BOM", () => {
    expect(parseImport("﻿acme.com, beta.io").map((r) => r.value.trim())).toEqual(["acme.com", "beta.io"]);
  });

  it("returns nothing for empty or whitespace input", () => {
    expect(parseImport("")).toEqual([]);
    expect(parseImport(" \n \n")).toEqual([]);
  });

  it("survives malformed CSV (unbalanced quotes)", () => {
    const rows = parseImport('Website\n"acme.com\nbeta.io');
    expect(Array.isArray(rows)).toBe(true);
  });
});
