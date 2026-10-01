/**
 * In-memory rate limiting.
 *
 * The key is never stored anywhere durable — the map dies with the process — so limiting an
 * IP does not mean recording one. Counters are intentionally coarse; this exists to blunt
 * floods, not to identify anyone.
 *
 * Caveat for a real telco gateway: every USSD request arrives from the gateway's own
 * addresses, so per-IP limiting there would throttle the whole country at once. In that
 * deployment, allowlist the gateway (`USSD_ALLOW_IPS`) and rate-limit per subscriber using a
 * keyed hash of the MSISDN held only in memory — never the number itself.
 */
export function limiter(perHour: number) {
  const seen = new Map<string, { n: number; resetAt: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    if (seen.size > 50_000) seen.clear();          // bound memory under a distributed flood
    const b = seen.get(key);
    if (!b || now > b.resetAt) { seen.set(key, { n: 1, resetAt: now + 3_600_000 }); return true; }
    if (b.n >= perHour) return false;
    b.n++; return true;
  };
}

/**
 * Read a request body with a hard ceiling, so an endless upload cannot exhaust memory.
 *
 * It stops buffering the moment the ceiling is crossed and rejects, but does not tear the
 * socket down itself — the caller needs the connection alive long enough to answer 413, and
 * closes it afterwards. Later chunks are dropped rather than accumulated.
 */
export class BodyTooLarge extends Error {
  constructor(limit: number) { super(`request body too large (limit ${limit} bytes)`); }
}

export function readBody(req: { on: (e: string, f: (c?: unknown) => void) => void }, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = '', n = 0, over = false;
    req.on('data', (c) => {
      if (over) return;
      const chunk = String(c); n += chunk.length;
      if (n > limit) { over = true; s = ''; reject(new BodyTooLarge(limit)); return; }
      s += chunk;
    });
    req.on('end', () => { if (!over) resolve(s); });
    req.on('error', reject);
  });
}
