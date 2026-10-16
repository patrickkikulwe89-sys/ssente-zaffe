import { cardId, type Card } from '../../core/src/card.ts';
import type { Item, Parsed } from './lg-estimates.ts';
import type { CgRow } from './cg-estimates.ts';
import { render, type Catalogue, type Slot } from './i18n.ts';

/**
 * Turn a reconciled line item into a citizen-readable card.
 *
 * The claim sentence is rendered from a reviewed template in `content/i18n/`, one card per
 * language. Templates cannot hold a figure (see `i18n.ts`); the figures are interpolated
 * from the parsed document and the signature covers the finished text, so a translation
 * that misstates an amount cannot be published silently.
 */

const TOPIC: [RegExp, Card['topic']][] = [
  [/health|hospital|hc\b/i, 'health'],
  [/education|school|skills/i, 'education'],
  [/water|sanitation|environment/i, 'water'],
  [/road|works|transport|bridge/i, 'roads'],
  [/administration|public sector|pension|gratuity/i, 'administration'],
  [/production|agric|marketing|trade|tourism/i, 'production'],
];
export const topicOf = (item: Item): Card['topic'] =>
  TOPIC.find(([re]) => re.test(`${item.unit} ${item.item}`))?.[1] ?? 'other';

const ugx = (n: number) => `UGX ${n.toLocaleString('en-US')}`;
/** A place that answers for its own budget reads better as the subject of the sentence. */
const isPlace = (name: string) => /\b(Division|City|Municipality|District|Region)\b/.test(name);
const pctChange = (a: number, b: number): number | null => (a === 0 ? null : Math.round(((b - a) / a) * 100));
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

type Claim = { key: string; slots: Partial<Record<Slot, string>> };

/** The shape of a year-on-year change, which picks the sentence. */
const shapeOf = (a: number, b: number) =>
  a > 0 && b === 0 ? 'cut' : a === 0 && b > 0 ? 'new' : a === b ? 'flat' : b > a ? 'up' : 'down';

const figures = (a: number, b: number, years: Parsed['years']) => ({
  amountA: ugx(a), amountB: ugx(b), fyA: years.a, fyB: years.b,
  pct: String(Math.abs(pctChange(a, b) ?? 0)),
});

/** Every slot value here comes from the parser; the catalogue supplies only the words around them. */
function sentence(c: Catalogue, { key, slots }: Claim, years: Parsed['years']): string {
  return render(c, key, { ...slots, draft: years.bKind === 'draft' ? c.words.draft : '' });
}

function localClaim(it: Item, years: Parsed['years']): Claim {
  return {
    key: `local.${shapeOf(it.a, it.b)}`,
    slots: { ...figures(it.a, it.b, years), place: it.voteName, item: clean(it.item) },
  };
}

function centralClaim(r: CgRow, years: Parsed['years']): Claim {
  const item = clean(r.item), programme = clean(r.unit), f = figures(r.totA, r.totB, years);
  if (isPlace(item)) return { key: `place.${shapeOf(r.totA, r.totB)}`, slots: { ...f, place: item, programme } };
  const key = r.totA === r.totB ? 'org.flat' : r.totA === 0 ? 'org.new' : 'org.changed';
  return { key, slots: { ...f, org: r.voteName, item, programme } };
}

/**
 * English templates were written by hand and carry no AI assistance. Other languages were
 * drafted with a model and corrected by a person, which the card says, as invariant 1 asks.
 */
const provenanceFor = (c: Catalogue, extractor: string): Card['provenance'] =>
  ({ extractor, reconciled: true, aiAssisted: c.lang === 'en' ? [] : ['translation'] });

/**
 * A card from Volume 1, where the unit is a government programme and the item is the
 * department — or, for Kampala, one of KCCA's five divisions, which is why this document
 * matters: the capital is Vote 122, not a local government, and it is the only place where
 * a Kawempe or Nakawa resident can see a figure for where they live.
 */
export function toCentralCard(
  r: CgRow,
  years: Parsed['years'],
  source: Card['source'],
  now: string,
  cat: Catalogue,
): Card {
  const { a: fyA, b: fyB } = years;

  return {
    v: 1,
    id: cardId({ voteCode: r.vote, unit: r.unit, item: r.item, fy: fyB, lang: cat.lang }),
    lang: cat.lang,
    scope: { country: 'UG', voteCode: r.vote, voteName: r.voteName, level: 'central' },
    topic: topicOf({ unit: `${r.unit} ${r.item}`, item: r.item } as Item),
    unit: r.unit,
    item: r.item,
    claim: sentence(cat, centralClaim(r, years), years),
    amounts: [{ fy: fyA, ugx: r.totA, kind: years.aKind }, { fy: fyB, ugx: r.totB, kind: years.bKind }],
    change: { from: fyA, to: fyB, pct: pctChange(r.totA, r.totB) },
    funding: { gou: r.gouB, external: r.extB },
    source: { ...source, page: r.page, table: 'V1' },
    provenance: provenanceFor(cat, 'cg-estimates-det-v1'),
    issued: now,
    expires: `${Number(fyB.slice(0, 4)) + 1}-06-30T00:00:00.000Z`,
  };
}

export function toCard(
  it: Item,
  years: Parsed['years'],
  source: Card['source'],
  now: string,
  cat: Catalogue,
): Card {
  return {
    v: 1,
    id: cardId({ voteCode: it.vote, unit: it.unit, item: it.item, fy: years.b, lang: cat.lang }),
    lang: cat.lang,
    scope: { country: 'UG', voteCode: it.vote, voteName: it.voteName, level: it.level },
    topic: topicOf(it),
    unit: it.unit,
    item: it.item,
    claim: sentence(cat, localClaim(it, years), years),
    amounts: [
      { fy: years.a, ugx: it.a, kind: years.aKind },
      { fy: years.b, ugx: it.b, kind: years.bKind },
    ],
    change: { from: years.a, to: years.b, pct: pctChange(it.a, it.b) },
    source: { ...source, page: it.page, table: 'V4' },
    provenance: provenanceFor(cat, 'lg-estimates-det-v1'),
    issued: now,
    expires: `${Number(years.b.slice(0, 4)) + 1}-06-30T00:00:00.000Z`,
  };
}
