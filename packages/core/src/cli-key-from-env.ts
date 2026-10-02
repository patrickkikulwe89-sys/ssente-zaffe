import fs from 'node:fs';
import path from 'node:path';
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

/**
 * Where keys are written. Overridable so this can be exercised without touching a real key:
 * running it against the live directory is how a working signing key gets destroyed.
 */
const KEYS = process.env.KEYS_DIR ?? 'keys';
const secretPath = path.join(KEYS, 'issuer.secret.json');
if (fs.existsSync(secretPath) && process.env.FORCE_KEY_OVERWRITE !== '1') {
  console.error(`${secretPath} already exists — refusing to overwrite a signing key.`);
  console.error('  CI starts from a clean checkout, so this should not happen there.');
  console.error('  To try this locally, set KEYS_DIR to a scratch directory.');
  process.exit(1);
}

const supplied = process.env.SSENTE_ISSUER_SECRET;
const hex = supplied ? normalise(supplied) : '';
const issuer = process.env.SSENTE_ISSUER ?? 'Ssente Zaffe';

/** Public keys are also 64 hex characters, so this mistake would otherwise pass silently. */
function isKnownPublicKey(candidate: string): boolean {
  const trustedPath = path.join(KEYS, 'trusted.json');
  if (!fs.existsSync(trustedPath)) return false;
  try {
    const t = JSON.parse(fs.readFileSync(trustedPath, 'utf8')) as Record<string, { publicKey?: string }>;
    return Object.values(t).some(v => v.publicKey?.toLowerCase() === candidate);
  } catch { return false; }
}

let secretKey: Uint8Array, ephemeral = false, reason = '';
if (hex && /^[0-9a-f]{64}$/.test(hex) && isKnownPublicKey(hex)) {
  reason = 'the value supplied is a public key from the trust list, not a secret key — copy the "secretKey" field, not "publicKey"';
  ({ secretKey } = generateKeypair());
  ephemeral = true;
} else if (hex && /^[0-9a-f]{64}$/.test(hex)) {
  secretKey = hexToBytes(hex);
} else if (supplied && supplied.trim()) {
  /**
   * A rejected secret degrades the build instead of blocking it.
   *
   * Hard-failing here protects cards already shared, but it also takes the whole published
   * site offline until a person fixes a secret — and the fallback is not silent: the issuer
   * reads "ephemeral preview key", the key id changes, and the reason is published in the
   * index. Availability of labelled data beats no data. Set STRICT_SIGNING_KEY=1 to fail
   * instead, which is the right choice once an institution's key is in use.
   */
  const shape = /^[0-9a-f]*$/.test(hex) ? `${hex.length} hex characters` : `${hex.length} characters, not all hexadecimal`;
  reason = `expected 64 hexadecimal characters, received ${shape}`
    + (hex.length === 16 ? ' — that length matches a keyId, so "keyId" may have been copied instead of "secretKey"' : '');
  if (process.env.STRICT_SIGNING_KEY === '1') throw new Error(`SSENTE_ISSUER_SECRET rejected: ${reason}`);
  ({ secretKey } = generateKeypair());
  ephemeral = true;
} else {
  ({ secretKey } = generateKeypair());
  ephemeral = true;
}
const publicKey = ed25519.getPublicKey(secretKey);
const id = keyId(publicKey);
const label = ephemeral ? `${issuer} (ephemeral preview key)` : issuer;

fs.mkdirSync(KEYS, { recursive: true });
fs.writeFileSync(secretPath, JSON.stringify({ keyId: id, issuer: label, secretKey: bytesToHex(secretKey) }), { mode: 0o600 });
fs.writeFileSync(path.join(KEYS, 'trusted.json'), JSON.stringify({ [id]: { issuer: label, publicKey: bytesToHex(publicKey) } }, null, 2));
// Published alongside the cards, so the key's provenance can be inspected from the site
// itself rather than only from a build log.
fs.writeFileSync(path.join(KEYS, 'key-status.json'), JSON.stringify({ stable: !ephemeral, keyId: id, issuer: label, reason: reason || null }, null, 2));

console.log(`${ephemeral ? '⚠ ephemeral' : 'stable'} signing key ${id} (${label})`);
if (reason) console.log(`  SSENTE_ISSUER_SECRET was rejected: ${reason}`);
if (ephemeral) console.log('  cards from this build will not verify against other builds — set SSENTE_ISSUER_SECRET for a stable key');
const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary && reason) {
  try { fs.appendFileSync(summary, `### Signing key rejected\n\n${reason}\n\nBuilt with an ephemeral preview key instead.\n`); } catch { /* best effort */ }
}

}
