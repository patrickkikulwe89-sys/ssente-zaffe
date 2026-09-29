import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import { verifyCard } from '../../core/src/sign.ts';
import { openDb, VERDICTS, type Store, type Verdict } from './db.ts';

/**
 * The one piece of server in the whole project.
 *
 * Two rules it exists to enforce:
 *  1. A report may only attach to a card that verifies against a trusted key. The client
 *     sends the signed card, not a bare id, so nobody can file reports against invented
 *     budget lines or flood ids that do not exist.
 *  2. Nothing identifying is stored or logged — see db.ts.
 *
 * Reports are *not* facts. They are unsigned citizen observations, and every response says
 * so, because the reader must never render them with the authority of a signed card.
 */
const DISCLAIMER = 'Citizen reports are unverified observations, not signed government figures.';

type Trusted = Record<string, string>;
const loadTrusted = (file = 'keys/trusted.json'): Trusted =>
  Object.fromEntries(Object.entries(
    JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, { publicKey: string }>
  ).map(([k, v]) => [k, v.publicKey]));

/** Rate limit by IP without ever storing it: an in-memory bucket, dropped on restart. */
function limiter(perHour = 30) {
  const seen = new Map<string, { n: number; resetAt: number }>();
  return (ip: string): boolean => {
    const now = Date.now();
    const b = seen.get(ip);
    if (!b || now > b.resetAt) { seen.set(ip, { n: 1, resetAt: now + 3_600_000 }); return true; }
    if (b.n >= perHour) return false;
    b.n++; return true;
  };
}

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(body));
};

const readBody = (req: IncomingMessage, limit = 64_000) => new Promise<string>((resolve, reject) => {
  let s = '', n = 0;
  req.on('data', c => { n += c.length; if (n > limit) { reject(new Error('too large')); req.destroy(); } else s += c; });
  req.on('end', () => resolve(s));
  req.on('error', reject);
});

export function createReportsServer(opts: { store: Store; trusted: Trusted; perHour?: number }) {
  const allow = limiter(opts.perHour);
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'OPTIONS') return json(res, 204, null);

    if (req.method === 'GET' && url.pathname === '/aggregate') {
      const vote = url.searchParams.get('vote') ?? '';
      if (!/^\d{3}$/.test(vote)) return json(res, 400, { error: 'vote must be three digits' });
      return json(res, 200, { vote, disclaimer: DISCLAIMER, counts: opts.store.aggregate(vote) });
    }

    if (req.method === 'POST' && url.pathname === '/reports') {
      const ip = (req.socket.remoteAddress ?? 'unknown');   // used for limiting only, never stored
      if (!allow(ip)) return json(res, 429, { error: 'too many reports from this connection, try later' });
      let body: { signed?: unknown; verdict?: string };
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid request' }); }
      if (!VERDICTS.includes(body.verdict as Verdict)) return json(res, 400, { error: `verdict must be one of ${VERDICTS.join(', ')}` });
      const check = verifyCard(body.signed, opts.trusted);
      if (!check.ok) return json(res, 400, { error: `report refused: ${check.reason}` });
      opts.store.insert(check.card.id, check.card.scope.voteCode, body.verdict as Verdict);
      return json(res, 201, { ok: true, cardId: check.card.id, disclaimer: DISCLAIMER });
    }

    return json(res, 404, { error: 'not found' });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8787);
  const store = openDb(process.env.REPORTS_DB ?? 'reports.db');
  createReportsServer({ store, trusted: loadTrusted() }).listen(port, () => {
    console.log(`reports service on http://127.0.0.1:${port}`);
    console.log('  POST /reports          { signed: <signed card>, verdict }');
    console.log('  GET  /aggregate?vote=933');
    console.log('  stores: card id, vote, verdict, UTC date. nothing else.');
  });
}
