import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha256';
import { canonicalize, utf8 } from './canonical.ts';
import { Card, cardHash, type Card as CardT } from './card.ts';
import { z } from 'zod';

export const SignedCard = z.object({
  card: Card,
  sig: z.object({
    alg: z.literal('ed25519'),
    keyId: z.string().regex(/^[0-9a-f]{16}$/),
    value: z.string().regex(/^[0-9a-f]{128}$/),
  }),
});
export type SignedCard = z.infer<typeof SignedCard>;

export const keyId = (publicKey: Uint8Array): string => bytesToHex(sha256(publicKey)).slice(0, 16);

export function generateKeypair() {
  const secretKey = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(secretKey);
  return { secretKey, publicKey, keyId: keyId(publicKey) };
}

/** Sign one card on its own, so a single card forwarded over any channel still verifies. */
export function signCard(card: CardT, secretKey: Uint8Array): SignedCard {
  const publicKey = ed25519.getPublicKey(secretKey);
  const msg = utf8(canonicalize(card));
  return {
    card,
    sig: { alg: 'ed25519', keyId: keyId(publicKey), value: bytesToHex(ed25519.sign(msg, secretKey)) },
  };
}

/**
 * Verify a card offline. Returns a reason on failure rather than throwing, because
 * the reader UI has to explain *why* something was rejected.
 */
export function verifyCard(
  signed: unknown,
  trustedKeys: Record<string, string>,   // keyId -> public key hex
): { ok: true; card: CardT } | { ok: false; reason: string } {
  const parsed = SignedCard.safeParse(signed);
  if (!parsed.success) return { ok: false, reason: `malformed: ${parsed.error.issues[0]?.message ?? 'invalid'}` };
  const { card, sig } = parsed.data;
  const pub = trustedKeys[sig.keyId];
  if (!pub) return { ok: false, reason: `unknown signing key ${sig.keyId}` };
  const good = ed25519.verify(hexToBytes(sig.value), utf8(canonicalize(card)), hexToBytes(pub));
  if (!good) return { ok: false, reason: 'signature does not match card contents' };
  if (!card.provenance.reconciled) return { ok: false, reason: 'figures did not reconcile with the source document' };
  return { ok: true, card };
}

export const Bundle = z.object({
  v: z.literal(1),
  bundleId: z.string().min(1),
  issuer: z.string().min(1),
  created: z.string().datetime(),
  cardHashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)),
  sig: z.object({ alg: z.literal('ed25519'), keyId: z.string(), value: z.string() }),
});

/** A manifest lets a reader detect cards withheld from a bundle, not just altered ones. */
export function signBundle(
  meta: { bundleId: string; issuer: string; created: string },
  cards: CardT[],
  secretKey: Uint8Array,
) {
  const publicKey = ed25519.getPublicKey(secretKey);
  const body = { v: 1 as const, ...meta, cardHashes: cards.map(cardHash).sort() };
  return { ...body, sig: { alg: 'ed25519' as const, keyId: keyId(publicKey), value: bytesToHex(ed25519.sign(utf8(canonicalize(body)), secretKey)) } };
}
