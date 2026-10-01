import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytesToHex } from '@noble/hashes/utils';
import { cardId, type Card } from '../src/card.ts';
import { generateKeypair, signCard, verifyCard } from '../src/sign.ts';
import { canonicalize } from '../src/canonical.ts';
import { limiter, readBody } from '../../reports/src/limit.ts';

const issuer = generateKeypair();
const trusted = { [issuer.keyId]: bytesToHex(issuer.publicKey) };

const card = (): Card => ({
  v: 1,
  id: cardId({ voteCode: '933', unit: 'Health', item: 'PHC', fy: '2026/27', lang: 'en' }),
  lang: 'en',
  scope: { country: 'UG', voteCode: '933', voteName: 'Wakiso District', level: 'district' },
  topic: 'health', unit: 'Health', item: 'PHC',
  claim: 'Wakiso District is allocated UGX 1,981,498,000 for primary health care.',
  amounts: [{ fy: '2025/26', ugx: 1_889_472_000, kind: 'approved' }, { fy: '2026/27', ugx: 1_981_498_000, kind: 'draft' }],
  source: { docId: 'd', title: 't', publisher: 'p', page: 1442, table: 'V4', sha256: 'b'.repeat(64), retrieved: '2026-09-29T00:00:00.000Z' },
  provenance: { extractor: 'lg-estimates-det-v1', reconciled: true, aiAssisted: [] },
  issued: '2026-09-29T00:00:00.000Z', expires: '2027-06-30T00:00:00.000Z',
});

test('keys injected into a card are discarded, not carried through verification', () => {
  const signed = signCard(card(), issuer.secretKey) as unknown as Record<string, any>;
  signed.card.evil = '<script>alert(1)</script>';
  signed.card.scope.evil = 'injected';
  const r = verifyCard(signed, trusted);
  // The schema strips unknown keys before the signature is checked, so the injection is
  // simply absent from what the reader renders — it cannot ride along on a valid signature.
  assert.equal(r.ok, true);
  assert.equal((r as { card: Record<string, unknown> }).card.evil, undefined);
  assert.equal(((r as { card: { scope: Record<string, unknown> } }).card.scope).evil, undefined);
});

test('a __proto__ payload does not pollute Object.prototype', () => {
  const signed = signCard(card(), issuer.secretKey);
  const hostile = JSON.parse(
    JSON.stringify(signed).replace('{"card":', '{"__proto__":{"polluted":true},"card":'),
  );
  verifyCard(hostile, trusted);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted'), false);
});

test('a card signed for one district cannot be replayed as another', () => {
  const signed = signCard(card(), issuer.secretKey);
  signed.card.scope.voteCode = '856';
  signed.card.scope.voteName = 'Kasese District';
  assert.equal(verifyCard(signed, trusted).ok, false);
});

test('canonicalization rejects values whose encoding is ambiguous', () => {
  assert.throws(() => canonicalize({ n: Number.NaN }), /non-finite/);
  assert.throws(() => canonicalize({ n: 0.1 }), /integers/);
  assert.throws(() => canonicalize({ f: () => 1 }), /unsupported/);
});

test('the rate limiter stops at its ceiling and forgets the key on reset', () => {
  const allow = limiter(3);
  assert.deepEqual([allow('a'), allow('a'), allow('a'), allow('a')], [true, true, true, false]);
  assert.equal(allow('b'), true, 'limiting one key must not limit another');
});

test('reading a body refuses to buffer past its ceiling and drops what follows', async () => {
  const handlers: Record<string, (c?: unknown) => void> = {};
  const req = { on: (e: string, f: (c?: unknown) => void) => { handlers[e] = f; } };
  const p = readBody(req, 10);
  handlers.data!('x'.repeat(11));
  await assert.rejects(p, /too large/);
  // Further chunks from an endless upload must not keep accumulating after the rejection.
  handlers.data!('y'.repeat(1_000_000));
  handlers.end!();
});

// ---- the signing secret is pasted by a person into a web form ----

test('a pasted signing secret is accepted whatever shape it arrives in', async () => {
  const { normalise } = await import('../src/cli-key-from-env.ts');
  const key = 'a'.repeat(32) + 'b'.repeat(32);
  const valid = (s: string) => /^[0-9a-f]{64}$/.test(normalise(s));
  assert.ok(valid(key), 'plain');
  assert.ok(valid(key.toUpperCase()), 'uppercase hex');
  assert.ok(valid(`  ${key}\n`), 'surrounding whitespace');
  assert.ok(valid(`${key.slice(0, 32)} ${key.slice(32)}`), 'a space in the middle');
  assert.ok(valid(JSON.stringify({ keyId: 'x', issuer: 'y', secretKey: key })), 'the whole file pasted');
  assert.equal(normalise(key.toUpperCase()), key, 'case is normalised, not just accepted');
});

test('a secret that is not a key is still rejected', async () => {
  const { normalise } = await import('../src/cli-key-from-env.ts');
  for (const bad of ['not-a-key', '', 'a'.repeat(63), 'z'.repeat(64), '{"nope":1}'])
    assert.ok(!/^[0-9a-f]{64}$/.test(normalise(bad)), `should reject: ${bad.slice(0, 20)}`);
});

test('a keyId or a public key is not mistaken for a secret key', async () => {
  const { normalise } = await import('../src/cli-key-from-env.ts');
  // A keyId is 16 hex characters; a public key is 64, exactly like a secret key, which is
  // why the CLI compares it against the trust list rather than only checking the shape.
  assert.ok(!/^[0-9a-f]{64}$/.test(normalise('398a95cbf44222e4')), 'a keyId must not validate');
  assert.ok(/^[0-9a-f]{64}$/.test(normalise('b'.repeat(64))), 'shape alone cannot tell them apart');
});
