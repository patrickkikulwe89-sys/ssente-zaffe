import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bytesToHex } from '@noble/hashes/utils';
import { cardId, type Card } from '../../core/src/card.ts';
import { generateKeypair, signCard } from '../../core/src/sign.ts';
import { openDb } from '../src/db.ts';
import { createReportsServer } from '../src/server.ts';

const issuer = generateKeypair();
const attacker = generateKeypair();
const trusted = { [issuer.keyId]: bytesToHex(issuer.publicKey) };

const card = (): Card => ({
  v: 1,
  id: cardId({ voteCode: '856', unit: 'UGIFT', item: 'Health Development - Facility upgrades', fy: '2026/27', lang: 'en' }),
  lang: 'en',
  scope: { country: 'UG', voteCode: '856', voteName: 'Kasese District', level: 'district' },
  topic: 'health', unit: 'UGIFT', item: 'Health Development - Facility upgrades',
  claim: 'Kasese District had UGX 4,720,437,000 budgeted for health facility upgrades in FY2025/26. The FY2026/27 draft budget allocates nothing.',
  amounts: [{ fy: '2025/26', ugx: 4_720_437_000, kind: 'approved' }, { fy: '2026/27', ugx: 0, kind: 'draft' }],
  change: { from: '2025/26', to: '2026/27', pct: -100 },
  source: { docId: 'd', title: 't', publisher: 'p', page: 842, table: 'V4', sha256: 'a'.repeat(64), retrieved: '2026-09-29T00:00:00.000Z' },
  provenance: { extractor: 'lg-estimates-det-v1', reconciled: true, aiAssisted: [] },
  issued: '2026-09-29T00:00:00.000Z', expires: '2027-06-30T00:00:00.000Z',
});

let dir: string, store: ReturnType<typeof openDb>, base: string, server: ReturnType<typeof createReportsServer>;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssente-'));
  store = openDb(path.join(dir, 'test.db'));
  server = createReportsServer({ store, trusted, perHour: 100 });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => { server.close(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const post = (body: unknown) =>
  fetch(`${base}/reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('a report against a genuine card is accepted', async () => {
  const res = await post({ signed: signCard(card(), issuer.secretKey), verdict: 'disputed' });
  assert.equal(res.status, 201);
  const body = await res.json() as { ok: boolean; disclaimer: string };
  assert.equal(body.ok, true);
  assert.match(body.disclaimer, /not signed government figures/);
});

test('a report against a forged card is refused', async () => {
  const res = await post({ signed: signCard(card(), attacker.secretKey), verdict: 'disputed' });
  assert.equal(res.status, 400);
  assert.match((await res.json() as { error: string }).error, /unknown signing key/);
});

test('a report against a tampered card is refused', async () => {
  const signed = signCard(card(), issuer.secretKey);
  signed.card.amounts[1]!.ugx = 999;
  const res = await post({ signed, verdict: 'confirmed' });
  assert.equal(res.status, 400);
  assert.match((await res.json() as { error: string }).error, /signature does not match/);
});

test('an unknown verdict is refused', async () => {
  const res = await post({ signed: signCard(card(), issuer.secretKey), verdict: 'lol' });
  assert.equal(res.status, 400);
});

test('aggregates return counts and carry the disclaimer', async () => {
  const res = await fetch(`${base}/aggregate?vote=856`);
  const body = await res.json() as { counts: Record<string, Record<string, number>>; disclaimer: string };
  assert.equal(body.counts[card().id]!.disputed, 1);
  assert.match(body.disclaimer, /unverified/);
});

test('nothing identifying is stored', () => {
  const cols = (store.db.prepare("SELECT name FROM pragma_table_info('reports')").all() as { name: string }[]).map(c => c.name);
  assert.deepEqual(cols.sort(), ['card_id', 'day', 'verdict', 'vote']);
  for (const forbidden of ['ip', 'address', 'user_agent', 'device', 'phone', 'note', 'text', 'created_at'])
    assert.ok(!cols.includes(forbidden), `column ${forbidden} must not exist`);
});

test('the stored time is a date, never a timestamp', () => {
  const row = store.db.prepare('SELECT day FROM reports LIMIT 1').get() as { day: string };
  assert.match(row.day, /^\d{4}-\d{2}-\d{2}$/);
});

test('rate limiting stops a flood without storing who flooded', async () => {
  // Its own server: flooding the shared one would leave every later test rate-limited.
  const tight = createReportsServer({ store, trusted, perHour: 3 });
  await new Promise<void>(r => tight.listen(0, '127.0.0.1', r));
  const port = (tight.address() as { port: number }).port;
  const signed = signCard(card(), issuer.secretKey);
  const codes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`http://127.0.0.1:${port}/reports`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signed, verdict: 'confirmed' }),
    });
    codes.push(r.status);
  }
  tight.close();
  assert.ok(codes.includes(429), `expected a 429 within the window, got ${codes.join(',')}`);
  const cols = (store.db.prepare("SELECT name FROM pragma_table_info('reports')").all() as { name: string }[]).map(c => c.name);
  assert.ok(!cols.includes('ip'), 'limiting must not add a column recording who was limited');
});

// ---- hardening ----

test('an oversized report body is refused', async () => {
  const res = await fetch(`${base}/reports`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ signed: signCard(card(), issuer.secretKey), verdict: 'confirmed', pad: 'x'.repeat(70_000) }),
  });
  assert.equal(res.status, 413);
});

test('an unlisted browser origin receives no CORS grant', async () => {
  const strict = createReportsServer({ store, trusted, allowedOrigins: ['https://example.org'] });
  await new Promise<void>(r => strict.listen(0, '127.0.0.1', r));
  const port = (strict.address() as { port: number }).port;
  const denied = await fetch(`http://127.0.0.1:${port}/aggregate?vote=856`, { headers: { origin: 'https://evil.test' } });
  const granted = await fetch(`http://127.0.0.1:${port}/aggregate?vote=856`, { headers: { origin: 'https://example.org' } });
  strict.close();
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  assert.equal(granted.headers.get('access-control-allow-origin'), 'https://example.org');
});

test('responses carry no-sniff, no-referrer and no-store', async () => {
  const res = await fetch(`${base}/aggregate?vote=856`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});
