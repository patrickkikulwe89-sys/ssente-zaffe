import { z } from 'zod';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { canonicalize, utf8 } from './canonical.ts';

/** A cited figure, always in whole Uganda Shillings. */
export const Amount = z.object({
  fy: z.string().regex(/^\d{4}\/\d{2}$/),          // e.g. "2026/27"
  ugx: z.number().int().nonnegative(),
  kind: z.enum(['approved', 'draft', 'released', 'actual']),
});

/** Where the figure came from. A card is worthless without this. */
export const Source = z.object({
  docId: z.string().min(1),          // registry id, see content/sources/sources.json
  title: z.string().min(1),
  publisher: z.string().min(1),
  page: z.number().int().positive(), // PDF page, so a reader can check by hand
  table: z.string().min(1),          // e.g. "V4"
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  retrieved: z.string().datetime(),
});

/** How the figure was obtained and whether it survived the arithmetic audit. */
export const Provenance = z.object({
  extractor: z.string().min(1),      // deterministic parser version
  reconciled: z.boolean(),           // sub-items summed to the document's own stated total
  aiAssisted: z.array(z.enum(['wording', 'translation'])),  // never 'figures'
  reviewedBy: z.string().min(1).optional(),
  reviewedAt: z.string().datetime().optional(),
});

export const Card = z.object({
  v: z.literal(1),
  id: z.string().regex(/^[0-9a-f]{24}$/),
  lang: z.enum(['en', 'lg', 'sw']),
  scope: z.object({
    country: z.literal('UG'),
    voteCode: z.string().regex(/^\d{3}$/),
    voteName: z.string().min(1),
    level: z.enum(['district', 'city', 'municipality', 'central']),
  }),
  topic: z.enum(['health', 'education', 'water', 'roads', 'administration', 'production', 'other']),
  unit: z.string().min(1),            // department or project the money sits in
  item: z.string().min(1),            // the named service area / petition line
  claim: z.string().min(1).max(400),  // one plain-language sentence
  amounts: z.array(Amount).min(1),
  change: z.object({ from: z.string(), to: z.string(), pct: z.number().int().nullable() }).optional(),
  /**
   * Government funds versus external (donor) financing for the latest year. Volume 1 publishes
   * this split and it changes how a figure should be read — a road budget that is mostly donor
   * money is a different promise from one the treasury funds — so it is carried and signed.
   * Volume II does not publish it, so local government cards omit the field.
   */
  funding: z.object({ gou: z.number().int().nonnegative(), external: z.number().int().nonnegative() }).optional(),
  source: Source,
  provenance: Provenance,
  issued: z.string().datetime(),
  expires: z.string().datetime(),
});
export type Card = z.infer<typeof Card>;

/**
 * Identity is derived, not assigned: re-ingesting the same document yields the
 * same card id, so a card can be updated without orphaning links to it.
 */
export function cardId(parts: {
  voteCode: string; unit: string; item: string; fy: string; lang: string;
}): string {
  const key = canonicalize([parts.voteCode, parts.unit, parts.item, parts.fy, parts.lang]);
  return bytesToHex(sha256(utf8(key))).slice(0, 24);
}

export const cardHash = (card: Card): string => bytesToHex(sha256(utf8(canonicalize(card))));
