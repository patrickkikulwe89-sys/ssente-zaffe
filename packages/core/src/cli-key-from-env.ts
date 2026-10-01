import fs from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { generateKeypair, keyId } from './sign.ts';

/**
 * Prepare a signing key for an automated build.
 *
 * With SSENTE_ISSUER_SECRET set, the stable issuer key is reconstructed, so a card shared
 * today still verifies against a site rebuilt tomorrow — which is the entire point of signing
 * cards rather than serving them. Without it, an ephemeral key is generated so a preview can
 * still be published, and the build is marked as such.
 */
/**
 * Normalise a hand-pasted secret.
 *
 * The value is copied by a person into a web form, so be forgiving about shape and strict
 * about the value: strip any whitespace, accept either case, and recover the key when the
 * whole `issuer.secret.json` has been pasted instead of just the field — a genuinely easy
 * mistake. Whatever comes out is still validated as 64 hex characters.
 */
export function normalise(raw: string): string {
  let v = raw.trim();
  if (v.startsWith('{')) {
    try { v = String((JSON.parse(v) as { secretKey?: unknown }).secretKey ?? ''); } catch { /* not json after all */ }
  }
  return v.replace(/\s+/g, '').toLowerCase();
}

if (import.meta.url !== `file://${process.argv[1]}`) {
  // Imported for its helper (tests). Do not touch the filesystem.
} else {

const supplied = process.env.SSENTE_ISSUER_SECRET;
const hex = supplied ? normalise(supplied) : '';
const issuer = process.env.SSENTE_ISSUER ?? 'Ssente Zaffe';

let secretKey: Uint8Array, ephemeral = false;
if (hex && /^[0-9a-f]{64}$/.test(hex)) {
  secretKey = hexToBytes(hex);
} else if (supplied && supplied.trim()) {
  // Never print the value. Say enough to fix it and no more.
  throw new Error(
    `SSENTE_ISSUER_SECRET is not a valid signing key: expected 64 hex characters, ` +
    `got ${hex.length} usable character${hex.length === 1 ? '' : 's'} after trimming. ` +
    `Copy the "secretKey" value from keys/issuer.secret.json exactly.`,
  );
} else {
  ({ secretKey } = generateKeypair());
  ephemeral = true;
}
const publicKey = ed25519.getPublicKey(secretKey);
const id = keyId(publicKey);
const label = ephemeral ? `${issuer} (ephemeral preview key)` : issuer;

fs.mkdirSync('keys', { recursive: true });
fs.writeFileSync('keys/issuer.secret.json', JSON.stringify({ keyId: id, issuer: label, secretKey: bytesToHex(secretKey) }), { mode: 0o600 });
fs.writeFileSync('keys/trusted.json', JSON.stringify({ [id]: { issuer: label, publicKey: bytesToHex(publicKey) } }, null, 2));
console.log(`${ephemeral ? '⚠ ephemeral' : 'stable'} signing key ${id} (${label})`);
if (ephemeral) console.log('  cards from this build will not verify against other builds — set SSENTE_ISSUER_SECRET for a stable key');

}
