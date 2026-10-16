import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalogues, render, validateCatalogue, SLOTS, type Catalogue } from '../src/i18n.ts';
import { toCard, toCentralCard } from '../src/cards.ts';
import type { Item, Parsed } from '../src/lg-estimates.ts';
import type { CgRow } from '../src/cg-estimates.ts';
import type { Card } from '../../core/src/card.ts';

const cats = loadCatalogues();
const en = cats.get('en')!, lg = cats.get('lg')!;

const years: Parsed['years'] = { a: '2025/26', b: '2026/27', aKind: 'approved', bKind: 'draft' };
const source: Card['source'] = {
  docId: 'ug-mofped-cg-estimates-2026-27', title: 'Volume 1', publisher: 'MoFPED',
  page: 1, table: 'V1', sha256: '0'.repeat(64), retrieved: '2026-09-29T00:00:00.000Z',
};
const now = '2026-10-16T00:00:00.000Z';

// The real Kawempe row from Volume 1, Vote 122.
const kawempe: CgRow = {
  vote: '122', voteName: 'Kampala Capital City Authority (KCCA)', table: 'V1',
  unitCode: '06', unit: 'Natural Resources, Environment, Climate Change, Land and Water Management',
  itemCode: '04', item: 'Kawempe Division',
  gouA: 2_978_149_000, extA: 0, totA: 2_978_149_000, gouB: 2_858_415_000, extB: 0, totB: 2_858_415_000, page: 410,
};
const kasese: Item = {
  vote: '840', voteName: 'Kasese District', level: 'district',
  unit: 'Health Development', unitKind: 'project' as Item['unitKind'], unitCode: '1234',
  grantCode: null, grant: null, item: 'Health Development - Facility upgrades',
  a: 4_720_437_000, b: 0, page: 842,
};

const sample = Object.fromEntries(SLOTS.map(s => [s, `<${s}>`]));

test('both catalogues are reviewed and pass validation against English', () => {
  assert.ok(en.reviewed && lg.reviewed);
  assert.deepEqual(validateCatalogue(lg, en), []);
});

test('every Luganda template carries every slot, so no figure can go missing', () => {
  for (const key of Object.keys(en.claims)) {
    const out = render(lg, key, sample);
    for (const [slot, v] of Object.entries(sample))
      if (en.claims[key]!.includes(`{${slot}}`)) assert.ok(out.includes(v), `${key} dropped {${slot}}`);
  }
});

test('the validator refuses a digit, a spelled-out figure, a dropped slot and an unknown slot', () => {
  const bad = (claim: string): Catalogue => ({ ...lg, claims: { ...lg.claims, 'place.down': claim } });
  const problems = (claim: string) => validateCatalogue(bad(claim), en).join('\n');
  assert.match(problems(lg.claims['place.down']!.replace('{pct}%', '4%')), /contains a digit/);
  assert.match(problems(lg.claims['place.down']!.replace('{pct}%', 'ebituundu bina ({pct}%)')), /quantity word/);
  assert.match(problems(lg.claims['place.down']!.replace('{amountA}', '')), /slot \{amountA\} is missing/);
  assert.match(problems(lg.claims['place.down']! + ' {amount}'), /unknown slot \{amount\}/);
});

test('English cards render exactly the sentence that was signed before templates existed', () => {
  assert.equal(toCentralCard(kawempe, years, source, now, en).claim,
    "Kawempe Division's budget under Natural Resources, Environment, Climate Change, Land and Water Management goes down 4%, from UGX 2,978,149,000 in FY2025/26 to UGX 2,858,415,000 in the FY2026/27 draft budget.");
  assert.equal(toCard(kasese, years, { ...source, table: 'V4' }, now, en).claim,
    'Kasese District had UGX 4,720,437,000 budgeted for "Health Development - Facility upgrades" in FY2025/26. The FY2026/27 draft budget allocates nothing.');
});

test('a Luganda card carries the same figures, its own id, and says it was translated', () => {
  const e = toCentralCard(kawempe, years, source, now, en);
  const l = toCentralCard(kawempe, years, source, now, lg);
  assert.equal(l.lang, 'lg');
  assert.notEqual(l.id, e.id);
  assert.deepEqual(l.amounts, e.amounts);
  assert.deepEqual(l.change, e.change);
  assert.deepEqual(e.provenance.aiAssisted, []);
  assert.deepEqual(l.provenance.aiAssisted, ['translation']);
  for (const fig of ['UGX 2,978,149,000', 'UGX 2,858,415,000', '4%', '2025/26', '2026/27'])
    assert.ok(l.claim.includes(fig), `missing ${fig}: ${l.claim}`);
  assert.ok(l.claim.includes('enteekateeka'), 'a draft budget must be called a draft');
});

test('an approved budget drops the draft word in both languages', () => {
  const approved = { ...years, bKind: 'approved' as const };
  assert.doesNotMatch(toCentralCard(kawempe, approved, source, now, en).claim, /draft/);
  assert.doesNotMatch(toCentralCard(kawempe, approved, source, now, lg).claim, /enteekateeka/);
});
