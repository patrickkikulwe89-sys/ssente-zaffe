import type { Item, GrantTotal } from './lg-estimates.ts';

/**
 * The publication gate.
 *
 * The source document states a total for every grant line and then itemises it.
 * We re-add the items and compare. A group that does not balance is quarantined:
 * its cards are never signed, so a parsing error cannot reach a citizen as a fact.
 *
 * The document rounds to thousands of shillings, so a group of n items may legitimately
 * differ from its stated total by up to n * 1,000 UGX. Anything beyond that is a defect.
 */
export type Group = {
  key: string; vote: string; unit: string; grant: string;
  items: Item[];
  statedA: number; statedB: number; sumA: number; sumB: number;
  status: 'exact' | 'rounding' | 'quarantined';
};

export function reconcile(items: Item[], grantTotals: GrantTotal[]): { groups: Group[]; summary: Record<string, number> } {
  const stated = new Map(grantTotals.map(g => [`${g.vote}|${g.unit}|${g.grant}`, g]));
  const buckets = new Map<string, Item[]>();
  for (const it of items) {
    if (!it.grant) continue;
    const k = `${it.vote}|${it.unit}|${it.grant}`;
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(it);
  }
  const groups: Group[] = [];
  for (const [key, group] of buckets) {
    const t = stated.get(key);
    if (!t) continue;
    const sumA = group.reduce((s, i) => s + i.a, 0), sumB = group.reduce((s, i) => s + i.b, 0);
    const tol = group.length * 1000;
    const dA = Math.abs(sumA - t.a), dB = Math.abs(sumB - t.b);
    const status: Group['status'] = dA === 0 && dB === 0 ? 'exact' : dA <= tol && dB <= tol ? 'rounding' : 'quarantined';
    groups.push({ key, vote: t.vote, unit: t.unit, grant: t.grant, items: group, statedA: t.a, statedB: t.b, sumA, sumB, status });
  }
  const summary = groups.reduce<Record<string, number>>((acc, g) => ({ ...acc, [g.status]: (acc[g.status] ?? 0) + 1 }), {});
  return { groups, summary };
}
