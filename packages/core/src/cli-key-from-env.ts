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
const hex = process.env.SSENTE_ISSUER_SECRET?.trim();
const issuer = process.env.SSENTE_ISSUER ?? 'Ssente Zaffe';

let secretKey: Uint8Array, ephemeral = false;
if (hex && /^[0-9a-f]{64}$/.test(hex)) {
  secretKey = hexToBytes(hex);
} else {
  if (hex) throw new Error('SSENTE_ISSUER_SECRET must be 64 hex characters');
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
