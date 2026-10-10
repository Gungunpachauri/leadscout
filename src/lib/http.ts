// SSRF-hardened HTTP GET for the crawler.
//
// The private-address check runs *inside* the socket's DNS lookup, so the IP we
// validate is the IP we connect to. A separate "resolve, check, then fetch"
// step would leave a DNS-rebinding window between the check and the connect.

import dns, { type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import net, { type LookupFunction } from "node:net";
import zlib from "node:zlib";
import type { Readable } from "node:stream";

export const USER_AGENT =
  "LeadScoutBot/1.0 (+https://github.com/Gungunpachauri/leadscout; polite B2B research crawler)";
const TIMEOUT_MS = 8000;
const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 4;
const ALLOWED_PORTS = new Set(["", "80", "443"]);

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateIp(v6.slice(7));
  return (
    v6 === "::1" ||
    v6 === "::" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe80") ||
    v6.startsWith("ff")
  );
}

class BlockedError extends Error {
  code = "EBLOCKED";
}

const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as unknown as LookupAddress[];
    if (!list.length || list.some((a) => isPrivateIp(a.address))) {
      return callback(new BlockedError(`Blocked non-public address for ${hostname}`), "", 4);
    }
    if (options.all) (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    else callback(null, list[0].address, list[0].family);
  });
};

/** Cheap pre-flight check of a URL before any network activity. */
export function urlAllowed(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!ALLOWED_PORTS.has(u.port)) return null;
  if (u.username || u.password) return null;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  // IP literals skip DNS lookup entirely, so check them here.
  if (net.isIP(host) && isPrivateIp(host)) return null;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal"))
    return null;
  return u;
}

interface RawResponse {
  status: number;
  location?: string;
  contentType: string;
  body: string;
}

function getOnce(u: URL): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      u,
      {
        method: "GET",
        lookup: guardedLookup,
        timeout: TIMEOUT_MS,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
          "accept-encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers["content-type"] ?? "");
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location: res.headers.location, contentType, body: "" });
        }
        let stream: Readable = res;
        const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
        if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
        else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
        else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());

        const chunks: Buffer[] = [];
        let total = 0;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve({ status, contentType, body: Buffer.concat(chunks).toString("utf8") });
        };
        stream.on("data", (c: Buffer) => {
          total += c.length;
          chunks.push(c);
          if (total > MAX_BYTES) {
            finish();
            req.destroy();
          }
        });
        stream.on("end", finish);
        stream.on("error", (e) => (done ? undefined : reject(e)));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

/** GET with manual redirect handling; every hop is re-validated. Returns null on any failure. */
export async function safeFetch(url: string): Promise<{ url: string; body: string; contentType: string } | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = urlAllowed(current);
    if (!u) return null;
    try {
      const res = await getOnce(u);
      if (res.status >= 300 && res.status < 400) {
        if (!res.location) return null;
        current = new URL(res.location, u).toString();
        continue;
      }
      if (res.status < 200 || res.status >= 300) return null;
      return { url: u.toString(), body: res.body, contentType: res.contentType };
    } catch {
      return null;
    }
  }
  return null;
}
