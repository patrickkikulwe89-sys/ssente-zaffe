import fs from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519';
import { hexToBytes } from '@noble/hashes/utils';
import { canonicalize, utf8 } from './canonical.ts';
import { cardHash } from './card.ts';
import { verifyCard } from './sign.ts';

/**
 * Verifies a bundle exactly as the offline reader does: signatures only, no network,
 * no trust in whoever handed us the file.
 */
const file = process.argv[2] ?? 'apps/reader/public/bundles/933.json';
const trustedFile = JSON.parse(fs.readFileSync('keys/trusted.json', 'utf8')) as Record<string, { issuer: string; publicKey: string }>;
const trusted = Object.fromEntries(Object.entries(trustedFile).map(([k, v]) => [k, v.publicKey]));
const bundle = JSON.parse(fs.readFileSync(file, 'utf8')) as { manifest: any; cards: unknown[] };

console.log(`bundle   ${file}`);
console.log(`issuer   ${bundle.manifest.issuer}  (key ${bundle.manifest.keyId ?? bundle.manifest.sig.keyId})`);

let ok = 0; const failures: string[] = [];
for (const c of bundle.cards) {
  const r = verifyCard(c, trusted);
  if (r.ok) ok++; else failures.push(r.reason);
}
console.log(`cards    ${ok}/${bundle.cards.length} signatures valid`);
failures.slice(0, 5).forEach(f => console.log(`  ! ${f}`));

// The manifest proves nothing was withheld or inserted, which per-card signatures alone cannot.
const { sig, ...body } = bundle.manifest;
const manifestOk = ed25519.verify(hexToBytes(sig.value), utf8(canonicalize(body)), hexToBytes(trusted[sig.keyId]!));
const present = new Set((bundle.cards as { card: any }[]).map(c => cardHash(c.card)));
const listed = new Set<string>(body.cardHashes);
const missing = [...listed].filter(h => !present.has(h));
const extra = [...present].filter(h => !listed.has(h));
console.log(`manifest ${manifestOk ? 'valid' : 'INVALID'} · withheld ${missing.length} · unlisted ${extra.length}`);

// Prove the property rather than assert it: tamper with a real card and watch it fail.
const clone = JSON.parse(JSON.stringify(bundle.cards[0])) as any;
const before = clone.card.amounts[1].ugx;
clone.card.amounts[1].ugx = before + 1_000_000_000;
const t = verifyCard(clone, trusted);
console.log(`\ntamper   changed one figure by +UGX 1,000,000,000 (${before.toLocaleString()} -> ${clone.card.amounts[1].ugx.toLocaleString()})`);
console.log(`         verdict: ${t.ok ? 'ACCEPTED (BUG!)' : 'REJECTED — ' + t.reason}`);

const exitBad = failures.length > 0 || !manifestOk || missing.length || extra.length || t.ok;
process.exit(exitBad ? 1 : 0);
