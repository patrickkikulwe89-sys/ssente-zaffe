import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { verifyCard } from '../../core/src/sign.ts';
import { openDb } from '../../reports/src/db.ts';
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
const BUNDLES = process.env.BUNDLE_DIR ?? 'apps/reader/public/bundles';

function loadData(): Data {
  const trusted = Object.fromEntries(Object.entries(
    JSON.parse(fs.readFileSync('keys/trusted.json', 'utf8')) as Record<string, { publicKey: string }>
  ).map(([k, v]) => [k, v.publicKey]));
  const index = JSON.parse(fs.readFileSync(path.join(BUNDLES, 'index.json'), 'utf8')) as {
    years: { a: string; b: string }; votes: { vote: string; name: string; level: string }[];
  };
  const votes: Vote[] = index.votes.map(v => ({ vote: v.vote, name: v.name, level: v.level }));
  const cache = new Map<string, Line[]>();
  const store = openDb(process.env.REPORTS_DB ?? 'reports.db');

  return {
    years: index.years,
    votes,
    linesFor(vote) {
      const hit = cache.get(vote);
      if (hit) return hit;
      const body = JSON.parse(fs.readFileSync(path.join(BUNDLES, `${vote}.json`), 'utf8')) as { cards: unknown[] };
      // Only signed, reconciled cards ever reach a screen — the same gate the web reader applies.
      const lines: Line[] = [];
      for (const signed of body.cards) {
        const r = verifyCard(signed, trusted);
        if (!r.ok) continue;
        const c = r.card;
        lines.push({
          id: c.id, topic: topicOf(c.topic), item: c.item, page: c.source.page, claim: c.claim,
          a: c.amounts[0]?.ugx ?? 0, b: c.amounts[1]?.ugx ?? 0,
        });
      }
      cache.set(vote, lines);
      return lines;
    },
    report(cardId, vote, verdict) {
      try { store.insert(cardId, vote, verdict); return true; } catch { return false; }
    },
  };
}

const data = loadData();
const port = Number(process.env.PORT ?? 8788);

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(PHONE_HTML);
  }

  if (req.method === 'POST' && (url.pathname === '/' || url.pathname === '/ussd')) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const form = new URLSearchParams(raw);
    // form.get('phoneNumber') exists and is intentionally not read.
    const text = form.get('text') ?? '';
    const reply = render(text, data);
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' });
    return res.end(reply.text);
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
}).listen(port, () => {
  console.log(`USSD gateway on http://127.0.0.1:${port}`);
  console.log(`  open that address for a simulated feature phone (dial *384#)`);
  console.log(`  POST / with sessionId, phoneNumber, text  — Africa's Talking contract`);
  console.log(`  ${data.votes.length} local governments loaded from ${BUNDLES}`);
});
