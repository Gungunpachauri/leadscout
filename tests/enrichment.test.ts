import { describe, expect, it } from "vitest";
import { isPrivateIp, safeFetch, urlAllowed } from "@/lib/http";
import { analyzePages, parsePage, parseRobots, robotsAllows } from "@/lib/scraper";
import { isPlausibleEmail, isRoleLocal, normalizePhones } from "@/lib/validate";

const HOME = `<!doctype html><html><head>
<title>Acme Plumbing | Dayton HVAC</title>
<meta name="description" content="Family-owned plumbing and HVAC serving Dayton since 1975.">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Plumber","name":"Acme Plumbing",
 "telephone":"937-461-0142","address":{"addressLocality":"Dayton","addressRegion":"OH"},
 "founder":{"@type":"Person","name":"Robert Smith","jobTitle":"Owner"}}</script>
</head><body>
<h1>Plumbing &amp; HVAC</h1><p>Proudly family-owned since 1975.</p>
<a href="mailto:bob@acmeplumbing.com">Email Bob</a><a href="/about">About us</a>
<footer>© 2019 Acme Plumbing</footer>
</body></html>`;

describe("analyzePages (fixture HTML, no network)", () => {
  const facts = analyzePages("acmeplumbing.com", [parsePage("https://acmeplumbing.com/", HOME)], 2026);

  it("prefers structured data and records its evidence", () => {
    expect(facts.name).toBe("Acme Plumbing");
    expect(facts.evidence.name?.method).toBe("structured");
    expect(facts.industry).toBe("Home Services");
    expect(facts.evidence.industry).toMatchObject({ method: "structured", confidence: "high" });
    expect(facts.location).toBe("Dayton, OH");
    expect(facts.people[0]).toMatchObject({ name: "Robert Smith", title: "Owner" });
    expect(facts.people[0].evidence.method).toBe("structured");
  });

  it("quotes the sentence that states the founding year and ownership", () => {
    expect(facts.foundedYear).toBe(1975);
    expect(facts.evidence.foundedYear).toMatchObject({ method: "stated", confidence: "high" });
    expect(facts.evidence.foundedYear?.snippet).toMatch(/since 1975/);
    expect(facts.signals.familyOwned).toBe(true);
    expect(facts.evidence.familyOwned?.snippet).toMatch(/family-owned/i);
  });

  it("extracts contacts and site observations", () => {
    expect(facts.emailFinds.map((e) => e.address)).toContain("bob@acmeplumbing.com");
    expect(facts.phones[0].display).toBe("(937) 461-0142");
    expect(facts.copyrightYear).toBe(2019);
  });

  it("leaves unknown facts empty instead of guessing", () => {
    const bare = analyzePages("x.com", [parsePage("https://x.com/", "<html><body><p>Hello</p></body></html>")], 2026);
    expect(bare.foundedYear).toBeNull();
    expect(bare.industry).toBeNull();
    expect(bare.evidence.foundedYear).toBeUndefined();
    expect(bare.people).toEqual([]);
    expect(bare.thinContent).toBe(true);
  });

  it("marks 'over N years' as a low-confidence inferred estimate", () => {
    const f = analyzePages("y.com", [parsePage("https://y.com/", "<body><p>Serving clients for over 30 years.</p></body>")], 2026);
    expect(f.foundedYear).toBe(1996);
    expect(f.evidence.foundedYear).toMatchObject({ method: "inferred", confidence: "low" });
  });

  it("does not read a customer's 'generation' remark as family ownership", () => {
    const review = analyzePages("r.com", [parsePage("https://r.com/", "<body><p>My kids joined the tradition and the 4th generation visited last summer!</p></body>")], 2026);
    expect(review.signals.familyOwned).toBe(false);
    const owned = analyzePages("o.com", [parsePage("https://o.com/", "<body><p>We are a third-generation family business.</p></body>")], 2026);
    expect(owned.signals.familyOwned).toBe(true);
  });

  it("ignores a person's tenure ('for 25 years')", () => {
    const f = analyzePages("z.com", [parsePage("https://z.com/", "<body><p>Ian has been an illustrator here for 25 years.</p></body>")], 2026);
    expect(f.foundedYear).toBeNull();
  });
});

describe("robots.txt", () => {
  const rules = parseRobots("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private\nAllow: /private/ok\nDisallow: /*.pdf$");
  it("applies only the * group, longest match wins", () => {
    expect(robotsAllows(rules, "/")).toBe(true);
    expect(robotsAllows(rules, "/private/x")).toBe(false);
    expect(robotsAllows(rules, "/private/ok/page")).toBe(true);
    expect(robotsAllows(rules, "/files/a.pdf")).toBe(false);
  });
});

describe("contact validation", () => {
  it("filters junk email-like strings", () => {
    expect(isPlausibleEmail("bob@acme.com")).toBe(true);
    expect(isPlausibleEmail("logo@2x.png")).toBe(false);
    expect(isPlausibleEmail("you@example.com")).toBe(false);
  });

  it("separates role inboxes from named people", () => {
    expect(["info", "sales", "bizgifts", "customercare", "events"].every(isRoleLocal)).toBe(true);
    expect(["bob", "jane.doe", "jsmith"].some(isRoleLocal)).toBe(false);
  });

  it("normalises and dedupes phone numbers, dropping fictional ones", () => {
    const out = normalizePhones([
      { raw: "+1-888-636-8162", source: "a" },
      { raw: "(888) 636-8162", source: "b" },
      { raw: "555-555-5555", source: "c" },
      { raw: "123-456-7890", source: "d" },
    ]);
    expect(out.map((p) => p.e164)).toEqual(["+18886368162"]);
  });
});

describe("SSRF guard", () => {
  it("classifies private and public addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "93.184.216.34", "2606:4700::1111"]) expect(isPrivateIp(ip), ip).toBe(false);
  });

  it("rejects disallowed URLs before any network call", () => {
    for (const u of ["ftp://acme.com", "file:///etc/passwd", "http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data", "http://localhost:3000", "https://acme.com:8443/", "http://user:pass@acme.com/", "not a url"]) {
      expect(urlAllowed(u), u).toBeNull();
    }
    expect(urlAllowed("https://acme.com/about")).not.toBeNull();
  });

  it("refuses to fetch hostnames that resolve to loopback", async () => {
    // localhost.localtest.me-style names resolve to 127.0.0.1; plain "localhost" is blocked earlier.
    expect(await safeFetch("http://localhost/")).toBeNull();
  });
});
