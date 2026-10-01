import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import { verifyCard } from '../../core/src/sign.ts';
import { openDb, VERDICTS, type Store, type Verdict } from './db.ts';
import { limiter, readBody, BodyTooLarge } from './limit.ts';

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

/**
 * Which origins may call this service from a browser.
 *
 * A signature is required on every report, so no site can fabricate a budget line. But an
 * arbitrary page could still make its visitors file reports on real cards, so the default
 * deployment names its reader explicitly. `*` stays available for local development and says
 * so on startup rather than passing silently.
 */
const ENV_ALLOWED = (process.env.ALLOWED_ORIGINS ?? '*').split(',').map(s => s.trim()).filter(Boolean);
const makeOriginFor = (allowed: string[]) => (req: IncomingMessage): string | null => {
  if (allowed.includes('*')) return '*';
  const origin = req.headers.origin;
  return origin && allowed.includes(origin) ? origin : null;
};

const json = (res: ServerResponse, code: number, body: unknown, origin: string | null) => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
    vary: 'origin',
  };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-headers'] = 'content-type';
    headers['access-control-allow-methods'] = 'GET,POST,OPTIONS';
  }
  res.writeHead(code, headers);
  res.end(JSON.stringify(body));
};

export function createReportsServer(opts: { store: Store; trusted: Trusted; perHour?: number; allowedOrigins?: string[] }) {
  const allow = limiter(opts.perHour ?? 30);
  const originFor = makeOriginFor(opts.allowedOrigins ?? ENV_ALLOWED);
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const origin = originFor(req);
    if (req.method === 'OPTIONS') return json(res, 204, null, origin);

    if (req.method === 'GET' && url.pathname === '/aggregate') {
      const vote = url.searchParams.get('vote') ?? '';
      if (!/^\d{3}$/.test(vote)) return json(res, 400, { error: 'vote must be three digits' }, origin);
      return json(res, 200, { vote, disclaimer: DISCLAIMER, counts: opts.store.aggregate(vote) }, origin);
    }

    if (req.method === 'POST' && url.pathname === '/reports') {
      const ip = (req.socket.remoteAddress ?? 'unknown');   // used for limiting only, never stored
      if (!allow(ip)) return json(res, 429, { error: 'too many reports from this connection, try later' }, origin);
      let body: { signed?: unknown; verdict?: string };
      try { body = JSON.parse(await readBody(req, 64_000)); }
      catch (e) {
        if (e instanceof BodyTooLarge) { json(res, 413, { error: 'report too large' }, origin); return req.destroy(); }
        return json(res, 400, { error: 'invalid request' }, origin);
      }
      if (!VERDICTS.includes(body.verdict as Verdict)) return json(res, 400, { error: `verdict must be one of ${VERDICTS.join(', ')}` }, origin);
      const check = verifyCard(body.signed, opts.trusted);
      if (!check.ok) return json(res, 400, { error: `report refused: ${check.reason}` }, origin);
      opts.store.insert(check.card.id, check.card.scope.voteCode, body.verdict as Verdict);
      return json(res, 201, { ok: true, cardId: check.card.id, disclaimer: DISCLAIMER }, origin);
    }

    return json(res, 404, { error: 'not found' }, origin);
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
    console.log(`  allowed origins: ${ENV_ALLOWED.join(', ')}${ENV_ALLOWED.includes('*') ? '  (set ALLOWED_ORIGINS before exposing this publicly)' : ''}`);
  });
}
