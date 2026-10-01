import type { CgRow, CgTotal } from './cg-estimates.ts';

/**
 * The publication gate for Volume 1, with two independent checks.
 *
 * 1. Every department or division row in a programme must sum to the "Total for Programme"
 *    the document states for it.
 * 2. Every row must satisfy government funds + external financing = total, for both years.
 *
 * Both allow the document's own rounding — it publishes thousands of shillings, so a figure
 * may be out by up to UGX 1,000 per row. Anything beyond that is a defect, and its rows are
 * quarantined rather than signed.
 */
export type CgGroup = {
  key: string; vote: string; unit: string;
  rows: CgRow[];
  statedA: number; statedB: number; sumA: number; sumB: number;
  status: 'exact' | 'rounding' | 'quarantined';
};

const ROUND = 1000;

export function reconcileCg(rows: CgRow[], programmeTotals: CgTotal[]) {
  // Row-level funding identity first: a row that fails it is not publishable at all.
  const selfConsistent = (r: CgRow) =>
    Math.abs(r.gouA + r.extA - r.totA) <= ROUND && Math.abs(r.gouB + r.extB - r.totB) <= ROUND;
  const inconsistent = rows.filter(r => !selfConsistent(r));
  const usable = rows.filter(selfConsistent);

  const stated = new Map(programmeTotals.map(t => [`${t.vote}|${t.unit}`, t]));
  const buckets = new Map<string, CgRow[]>();
  for (const r of usable) {
    const k = `${r.vote}|${r.unit}`;
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(r);
  }

  const groups: CgGroup[] = [];
  for (const [key, group] of buckets) {
    const t = stated.get(key);
    if (!t) continue;
    const sumA = group.reduce((s, r) => s + r.totA, 0), sumB = group.reduce((s, r) => s + r.totB, 0);
    const statedA = (t.f[2] ?? 0) * 1000, statedB = (t.f[5] ?? 0) * 1000;
    const tol = group.length * ROUND;
    const dA = Math.abs(sumA - statedA), dB = Math.abs(sumB - statedB);
    const status: CgGroup['status'] = dA === 0 && dB === 0 ? 'exact' : dA <= tol && dB <= tol ? 'rounding' : 'quarantined';
    groups.push({ key, vote: group[0]!.vote, unit: group[0]!.unit, rows: group, statedA, statedB, sumA, sumB, status });
  }

  const summary = groups.reduce<Record<string, number>>((a, g) => ({ ...a, [g.status]: (a[g.status] ?? 0) + 1 }), {});
  return { groups, summary, inconsistent };
}
