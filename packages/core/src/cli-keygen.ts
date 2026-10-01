import fs from 'node:fs';
import path from 'node:path';
import { bytesToHex } from '@noble/hashes/utils';
import { generateKeypair } from './sign.ts';

/** The secret key never leaves this machine; the public key is committed as the trust list. */
const dir = process.env.KEYS_DIR ?? 'keys';
const secretPath = path.join(dir, 'issuer.secret.json');
if (fs.existsSync(secretPath)) {
  console.error(`${secretPath} already exists — refusing to overwrite a signing key.`);
  process.exit(1);
}
const { secretKey, publicKey, keyId } = generateKeypair();
const issuer = process.argv[2] ?? 'Ssente Zaffe (development key)';
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(secretPath, JSON.stringify({ keyId, issuer, secretKey: bytesToHex(secretKey) }, null, 2), { mode: 0o600 });
fs.writeFileSync(path.join(dir, 'trusted.json'), JSON.stringify({ [keyId]: { issuer, publicKey: bytesToHex(publicKey) } }, null, 2));
console.log(`issuer   ${issuer}\nkeyId    ${keyId}\nsecret   ${secretPath} (gitignored)\ntrusted  keys/trusted.json (commit this)`);
