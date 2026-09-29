import { cardId, type Card } from '../../core/src/card.ts';
import type { Item, Parsed } from './lg-estimates.ts';

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
