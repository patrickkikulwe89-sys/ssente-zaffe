import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytesToHex } from '@noble/hashes/utils';
import { cardId, type Card } from '../src/card.ts';
import { generateKeypair, signCard, verifyCard } from '../src/sign.ts';
import { canonicalize } from '../src/canonical.ts';

const issuer = generateKeypair();
const attacker = generateKeypair();
const trusted = { [issuer.keyId]: bytesToHex(issuer.publicKey) };

const base = (): Card => ({
  v: 1,
  id: cardId({ voteCode: '840', unit: 'Health Development', item: 'Health Development - Facility upgrades', fy: '2026/27', lang: 'en' }),
  lang: 'en',
  scope: { country: 'UG', voteCode: '840', voteName: 'Kasese District', level: 'district' },
  topic: 'health',
  unit: 'Uganda Intergovernmental Fiscal Transfer Reform (UGIFT)',
  item: 'Health Development - Facility upgrades',
  claim: 'Kasese District had UGX 4,720,437,000 budgeted for health facility upgrades in FY2025/26. The FY2026/27 draft budget allocates nothing.',
  amounts: [
    { fy: '2025/26', ugx: 4_720_437_000, kind: 'approved' },
    { fy: '2026/27', ugx: 0, kind: 'draft' },
  ],
  change: { from: '2025/26', to: '2026/27', pct: -100 },
  source: {
    docId: 'ug-mofped-lg-estimates-2026-27',
    title: 'Draft Estimates of Revenue and Expenditure FY2026/27, Volume II: Local Government Votes',
    publisher: 'Ministry of Finance, Planning and Economic Development, Uganda',
    page: 842,
    table: 'V4',
    sha256: 'a'.repeat(64),
    retrieved: '2026-09-29T00:00:00.000Z',
  },
  provenance: { extractor: 'lg-estimates-det-v1', reconciled: true, aiAssisted: ['wording'] },
  issued: '2026-09-29T00:00:00.000Z',
  expires: '2027-06-30T00:00:00.000Z',
});

test('a correctly signed card verifies offline', () => {
  const signed = signCard(base(), issuer.secretKey);
  const r = verifyCard(signed, trusted);
  assert.equal(r.ok, true);
});

test('altering a single digit of a figure invalidates the card', () => {
  const signed = signCard(base(), issuer.secretKey);
  signed.card.amounts[0]!.ugx = 4_720_437_001;
  const r = verifyCard(signed, trusted);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /signature does not match/);
});

test('rewriting the plain-language claim invalidates the card', () => {
  const signed = signCard(base(), issuer.secretKey);
  signed.card.claim = 'Kasese District health funding was increased.';
  assert.equal(verifyCard(signed, trusted).ok, false);
});

test('changing the cited page number invalidates the card', () => {
  const signed = signCard(base(), issuer.secretKey);
  signed.card.source.page = 1;
  assert.equal(verifyCard(signed, trusted).ok, false);
});

test('a card re-signed by someone else is rejected as an unknown key', () => {
  const forged = signCard({ ...base(), claim: 'Kasese District received a large increase.' }, attacker.secretKey);
  const r = verifyCard(forged, trusted);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /unknown signing key/);
});

test('a card whose figures never reconciled is refused even when validly signed', () => {
  const card = base();
  card.provenance.reconciled = false;
  const r = verifyCard(signCard(card, issuer.secretKey), trusted);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /did not reconcile/);
});

test('verification survives key reordering, so transport may reserialise freely', () => {
  const signed = signCard(base(), issuer.secretKey);
  // Reverse every key order, which is the harshest reserialisation a transport could apply.
  const flip = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(flip)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, flip(x)]))
    : v;
  const reordered = flip(signed);
  assert.equal(verifyCard(reordered, trusted).ok, true);
});

test('card ids are derived, so re-ingestion is idempotent', () => {
  const a = cardId({ voteCode: '840', unit: 'u', item: 'i', fy: '2026/27', lang: 'en' });
  const b = cardId({ voteCode: '840', unit: 'u', item: 'i', fy: '2026/27', lang: 'en' });
  assert.equal(a, b);
  assert.notEqual(a, cardId({ voteCode: '841', unit: 'u', item: 'i', fy: '2026/27', lang: 'en' }));
});

test('canonicalization refuses fractional money', () => {
  assert.throws(() => canonicalize({ ugx: 1.5 }), /integers/);
});
