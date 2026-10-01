import { cardId, type Card } from '../../core/src/card.ts';
import type { Item, Parsed } from './lg-estimates.ts';
import type { CgRow } from './cg-estimates.ts';

/**
 * Turn a reconciled line item into a citizen-readable card.
 *
 * The claim sentence is generated from a template, not by a language model. A model
 * may later rewrite `claim` for readability or translate it, but the figures are
 * interpolated from the parsed document and the signature covers the finished text,
 * so a rewrite that misstates an amount cannot be published silently.
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

function claimFor(it: Item, years: Parsed['years']): string {
  const where = it.voteName, what = it.item.replace(/\s+/g, ' ').trim();
  const { a: fyA, b: fyB, bKind } = years;
  const draft = bKind === 'draft' ? 'draft ' : '';
  if (it.a > 0 && it.b === 0)
    return `${where} had ${ugx(it.a)} budgeted for "${what}" in FY${fyA}. The FY${fyB} ${draft}budget allocates nothing.`;
  if (it.a === 0 && it.b > 0)
    return `${where} is allocated ${ugx(it.b)} for "${what}" in the FY${fyB} ${draft}budget, having had nothing in FY${fyA}.`;
  if (it.a === it.b)
    return `${where}'s budget for "${what}" is unchanged at ${ugx(it.b)} for a second year (FY${fyA} and FY${fyB}).`;
  const pct = pctChange(it.a, it.b)!;
  const dir = it.b > it.a ? 'up' : 'down';
  return `${where}'s budget for "${what}" goes ${dir} ${Math.abs(pct)}%, from ${ugx(it.a)} in FY${fyA} to ${ugx(it.b)} in the FY${fyB} ${draft}budget.`;
}

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
): Card {
  const { a: fyA, b: fyB, bKind } = years;
  const draft = bKind === 'draft' ? 'draft ' : '';
  const what = r.item.replace(/\s+/g, ' ').trim();
  const programme = r.unit.replace(/\s+/g, ' ').trim();

  const claim = isPlace(what)
    ? (r.totA === 0 && r.totB > 0
        ? `${what} is allocated ${ugx(r.totB)} under ${programme} in the FY${fyB} ${draft}budget, having had nothing in FY${fyA}.`
        : r.totB === 0 && r.totA > 0
        ? `${what} had ${ugx(r.totA)} under ${programme} in FY${fyA}. The FY${fyB} ${draft}budget allocates nothing.`
        : r.totA === r.totB
        ? `${what}'s budget under ${programme} is unchanged at ${ugx(r.totB)} for a second year (FY${fyA} and FY${fyB}).`
        : `${what}'s budget under ${programme} goes ${r.totB > r.totA ? 'up' : 'down'} ${Math.abs(pctChange(r.totA, r.totB)!)}%, from ${ugx(r.totA)} in FY${fyA} to ${ugx(r.totB)} in the FY${fyB} ${draft}budget.`)
    : `${r.voteName} is allocated ${ugx(r.totB)} for "${what}" under ${programme} in the FY${fyB} ${draft}budget${r.totA === r.totB ? ', unchanged from FY' + fyA : r.totA === 0 ? ', having had nothing in FY' + fyA : `, from ${ugx(r.totA)} in FY${fyA}`}.`;

  return {
    v: 1,
    id: cardId({ voteCode: r.vote, unit: r.unit, item: r.item, fy: fyB, lang: 'en' }),
    lang: 'en',
    scope: { country: 'UG', voteCode: r.vote, voteName: r.voteName, level: 'central' },
    topic: topicOf({ unit: `${r.unit} ${r.item}`, item: r.item } as Item),
    unit: r.unit,
    item: r.item,
    claim,
    amounts: [{ fy: fyA, ugx: r.totA, kind: years.aKind }, { fy: fyB, ugx: r.totB, kind: years.bKind }],
    change: { from: fyA, to: fyB, pct: pctChange(r.totA, r.totB) },
    funding: { gou: r.gouB, external: r.extB },
    source: { ...source, page: r.page, table: 'V1' },
    provenance: { extractor: 'cg-estimates-det-v1', reconciled: true, aiAssisted: [] },
    issued: now,
    expires: `${Number(fyB.slice(0, 4)) + 1}-06-30T00:00:00.000Z`,
  };
}

export function toCard(
  it: Item,
  years: Parsed['years'],
  source: Card['source'],
  now: string,
): Card {
  return {
    v: 1,
    id: cardId({ voteCode: it.vote, unit: it.unit, item: it.item, fy: years.b, lang: 'en' }),
    lang: 'en',
    scope: { country: 'UG', voteCode: it.vote, voteName: it.voteName, level: it.level },
    topic: topicOf(it),
    unit: it.unit,
    item: it.item,
    claim: claimFor(it, years),
    amounts: [
      { fy: years.a, ugx: it.a, kind: years.aKind },
      { fy: years.b, ugx: it.b, kind: years.bKind },
    ],
    change: { from: years.a, to: years.b, pct: pctChange(it.a, it.b) },
    source: { ...source, page: it.page, table: 'V4' },
    provenance: { extractor: 'lg-estimates-det-v1', reconciled: true, aiAssisted: [] },
    issued: now,
    expires: `${Number(years.b.slice(0, 4)) + 1}-06-30T00:00:00.000Z`,
  };
}
