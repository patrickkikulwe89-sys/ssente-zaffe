import { verifyCard } from '@core/sign.ts';
import type { Card } from '@core/card.ts';

export type VoteRef = { vote: string; name: string; level: string; cards: number; bytes: number };
export type Index = {
  issuer: string; keyId: string; created: string;
  source: { docId: string; title: string; publisher: string; url: string; sha256: string };
  years: { a: string; b: string; aKind: string; bKind: string };
  votes: VoteRef[];
};

/** keyId -> public key hex, compiled into the bundle so verification needs no network. */
export const TRUSTED: Record<string, string> =
  Object.fromEntries(Object.entries(__TRUSTED__).map(([k, v]) => [k, v.publicKey]));
export const ISSUERS: Record<string, string> =
  Object.fromEntries(Object.entries(__TRUSTED__).map(([k, v]) => [k, v.issuer]));

export type Checked =
  | { ok: true; card: Card; signed: unknown }
  | { ok: false; reason: string; card?: Card; signed: unknown };

export const fetchIndex = (): Promise<Index> =>
  fetch('bundles/index.json').then(r => { if (!r.ok) throw new Error('index unavailable'); return r.json(); });

/**
 * Load a district and verify every card locally. Nothing is displayed as fact unless
 * its signature checks out, so a tampered or substituted bundle cannot mislead a reader.
 */
export async function loadVote(vote: string): Promise<{ checked: Checked[]; verified: number; rejected: number }> {
  const res = await fetch(`bundles/${vote}.json`);
  if (!res.ok) throw new Error(`could not load district ${vote}`);
  const body = await res.json() as { cards: unknown[] };
  const checked: Checked[] = body.cards.map(c => {
    const r = verifyCard(c, TRUSTED);
    return r.ok ? { ok: true as const, card: r.card, signed: c } : { ok: false as const, reason: r.reason, card: (c as { card?: Card }).card, signed: c };
  });
  return {
    checked,
    verified: checked.filter(c => c.ok).length,
    rejected: checked.filter(c => !c.ok).length,
  };
}

/** Verify a single card handed over by any means: pasted, forwarded, copied from a phone. */
export function checkPasted(text: string): Checked {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { ok: false, reason: 'that is not valid card data' }; }
  const r = verifyCard(parsed, TRUSTED);
  return r.ok ? { ok: true, card: r.card, signed: parsed } : { ok: false, reason: r.reason, card: (parsed as { card?: Card }).card, signed: parsed };
}

export const ugx = (n: number) => 'UGX ' + n.toLocaleString('en-US');
export const TOPICS = ['health', 'education', 'water', 'roads', 'administration', 'production', 'other'] as const;
