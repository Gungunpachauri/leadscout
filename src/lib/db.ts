// Enrichment cache. Local dev uses a SQLite file via libSQL; production points
// TURSO_DATABASE_URL at a hosted libSQL (Turso) database. If the database is
// unavailable (e.g. read-only serverless filesystem with no Turso configured)
// we fall back to an in-memory cache so the app keeps working.

import { createClient, type Client } from "@libsql/client";
import type { Enrichment } from "./types";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

let client: Client | null = null;
let ready: Promise<boolean> | null = null;
const memory = new Map<string, Enrichment>();

function init(): Promise<boolean> {
  if (!ready) {
    ready = (async () => {
      try {
        client = createClient({
          url: process.env.TURSO_DATABASE_URL ?? "file:leadscout.db",
          authToken: process.env.TURSO_AUTH_TOKEN,
        });
        await client.execute(
          `CREATE TABLE IF NOT EXISTS enrichments (
             domain TEXT PRIMARY KEY,
             data TEXT NOT NULL,
             scraped_at INTEGER NOT NULL
           )`,
        );
        return true;
      } catch (err) {
        console.warn("[db] falling back to in-memory cache:", (err as Error).message);
        client = null;
        return false;
      }
    })();
  }
  return ready;
}

export async function getCached(domain: string): Promise<Enrichment | null> {
  const fresh = (e: Enrichment | undefined | null) => (e && Date.now() - e.scrapedAt < TTL_MS ? e : null);
  if (await init()) {
    try {
      const r = await client!.execute({ sql: "SELECT data FROM enrichments WHERE domain = ?", args: [domain] });
      if (r.rows[0]) return fresh(JSON.parse(String(r.rows[0].data)) as Enrichment);
    } catch { /* fall through to memory */ }
  }
  return fresh(memory.get(domain));
}

export async function putCached(e: Enrichment): Promise<void> {
  memory.set(e.domain, e);
  if (await init()) {
    try {
      await client!.execute({
        sql: `INSERT INTO enrichments (domain, data, scraped_at) VALUES (?, ?, ?)
              ON CONFLICT(domain) DO UPDATE SET data = excluded.data, scraped_at = excluded.scraped_at`,
        args: [e.domain, JSON.stringify(e), e.scrapedAt],
      });
    } catch (err) {
      console.warn("[db] write failed:", (err as Error).message);
    }
  }
}
