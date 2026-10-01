import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCard } from '../../core/src/sign.ts';
import { openDb } from '../../reports/src/db.ts';
import { limiter, readBody } from '../../reports/src/limit.ts';
import { render, type Data, type Line, type Vote } from './menu.ts';
import { PHONE_HTML } from './phone.ts';
import { topicOf } from './topic.ts';

/**
 * USSD gateway endpoint.
 *
 * It speaks the Africa's Talking contract — form-encoded `sessionId`, `phoneNumber`, `text`,
 * answered with a plain-text body beginning `CON ` or `END ` — so pointing a real shortcode
 * at this service is a configuration change, not a rewrite. It is exercised here through a
 * simulated handset because a shortcode needs a telco agreement; the protocol is real either way.
 *
 * `phoneNumber` arrives on every request and is deliberately never read. Reports filed over
 * USSD land in the same table as reports from the web reader, which has no column for it.
 */
/**
 * Paths resolve from this file, not from the working directory, so the service runs from
 * anywhere — a systemd unit, a container, a cron job — without a `cd` first. Every one can
 * still be overridden, which is how a container points at mounted data.
 */
const ROOT = process.env.SSENTE_ROOT ?? path.resolve(fileURLToPath(import.meta.url), '../../../..');
const BUNDLES = process.env.BUNDLE_DIR ?? path.join(ROOT, 'apps/reader/public/bundles');
const TRUSTED_KEYS = process.env.TRUSTED_KEYS ?? path.join(ROOT, 'keys/trusted.json');

/**
 * Optional allowlist of gateway addresses. With a real shortcode every request arrives from
 * the telco's gateway, and that is the only thing that should be able to reach this endpoint.
 * Unset, the service accepts anyone, which is right for the simulated handset and wrong in
 * production — so startup says which mode it is in.
 */
const ALLOW_IPS = (process.env.USSD_ALLOW_IPS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const MAX_BODY = 8_000;           // form bodies are a few hundred bytes; this is generous
const navLimit = limiter(600);    // one request per keypress, so navigation needs headroom
const writeLimit = limiter(30);   // filing a verdict is the abuse vector, not browsing

function loadData(): Data {
  const trusted = Object.fromEntries(Object.entries(
    JSON.parse(fs.readFileSync(TRUSTED_KEYS, 'utf8')) as Record<string, { publicKey: string }>
  ).map(([k, v]) => [k, v.publicKey]));
  const index = JSON.parse(fs.readFileSync(path.join(BUNDLES, 'index.json'), 'utf8')) as {
    years: { a: string; b: string }; votes: { vote: string; name: string; level: string; aliases?: string[] }[];
  };
  const votes: Vote[] = index.votes.map(v => ({ vote: v.vote, name: v.name, level: v.level, aliases: v.aliases }));
  const cache = new Map<string, Line[]>();
  const store = openDb(process.env.REPORTS_DB ?? path.join(ROOT, 'reports.db'));

  return {
    years: index.years,
    votes,
    linesFor(vote) {
      // Defence in depth: vote codes only ever come from the index, but this value is
      // interpolated into a file path, so it is checked rather than trusted.
      if (!/^\d{3}$/.test(vote)) return [];
      const hit = cache.get(vote);
      if (hit) return hit;
      // A bundle can be missing or unreadable — a partly synced directory, a bad mount, a
      // deleted file. That must degrade to "no information for this district", never take the
      // gateway down for every other caller.
      let body: { cards: unknown[] };
      try {
        body = JSON.parse(fs.readFileSync(path.join(BUNDLES, `${vote}.json`), 'utf8')) as { cards: unknown[] };
      } catch {
        console.warn(`bundle unavailable for vote ${vote}`);
        cache.set(vote, []);
        return [];
      }
      // Only signed, reconciled cards ever reach a screen — the same gate the web reader applies.
      const lines: Line[] = [];
      for (const signed of body.cards) {
        const r = verifyCard(signed, trusted);
        if (!r.ok) continue;
        const c = r.card;
        lines.push({
          id: c.id, topic: topicOf(c.topic), item: c.item, unit: c.unit, page: c.source.page, claim: c.claim,
          a: c.amounts[0]?.ugx ?? 0, b: c.amounts[1]?.ugx ?? 0,
        });
      }
      cache.set(vote, lines);
      return lines;
    },
    report(cardId, vote, verdict) {
      if (!writeLimit(currentIp)) return false;
      try { store.insert(cardId, vote, verdict); return true; } catch { return false; }
    },
  };
}

/**
 * The address of the caller currently being served, for write rate limiting. The menu is a
 * pure function and must not learn about transports, so the request handler sets this
 * immediately before rendering and the store callback reads it. Single-threaded Node makes
 * that safe; it is never persisted.
 */
let currentIp = 'unknown';

const data = loadData();
const port = Number(process.env.PORT ?? 8788);

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const ip = req.socket.remoteAddress ?? 'unknown';   // limiting only; never stored

  if (ALLOW_IPS.length && !ALLOW_IPS.includes(ip)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    return res.end('forbidden');
  }
  if (!navLimit(ip)) {
    res.writeHead(429, { 'content-type': 'text/plain' });
    return res.end('END Too many requests. Please try again later.');
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    });
    return res.end(PHONE_HTML);
  }

  if (req.method === 'POST' && (url.pathname === '/' || url.pathname === '/ussd')) {
    let raw: string;
    try { raw = await readBody(req, MAX_BODY); }
    catch { res.writeHead(413, { 'content-type': 'text/plain' }); res.end('END Request too large.'); return req.destroy(); }
    const form = new URLSearchParams(raw);
    // form.get('phoneNumber') exists and is intentionally not read.
    const text = form.get('text') ?? '';
    currentIp = ip;
    // A caller must always get a screen. An unexpected fault ends their session politely
    // instead of dropping the connection and killing the process for everyone else.
    let reply;
    try { reply = render(text, data); }
    catch (e) {
      console.error('render failed:', e instanceof Error ? e.message : e);
      reply = { text: 'END Service temporarily unavailable. Please try again shortly.', end: true };
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' });
    return res.end(reply.text);
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
}).listen(port, () => {
  console.log(`USSD gateway on http://127.0.0.1:${port}`);
  console.log(`  open that address for a simulated feature phone (dial *384#)`);
  console.log(`  POST / with sessionId, phoneNumber, text  — Africa's Talking contract`);
  console.log(`  ${data.votes.length} local governments loaded from ${BUNDLES}`);
  console.log(ALLOW_IPS.length
    ? `  gateway allowlist: ${ALLOW_IPS.join(', ')}`
    : '  gateway allowlist: OPEN — set USSD_ALLOW_IPS before exposing this publicly');
});
