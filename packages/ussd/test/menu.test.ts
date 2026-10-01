import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, short, gsm7, label, SCREEN_LIMIT, type Data, type Line } from '../src/menu.ts';

const line = (id: string, topic: string, item: string, a: number, b: number, page: number): Line =>
  ({ id, topic, item, a, b, page, claim: `${item} ${a} -> ${b}` });

const lines: Record<string, Line[]> = {
  '933': [
    line('aaaa111111111111aaaa1111', 'health', 'Primary Health Care - Non Wage Recurrent (Government)', 1_889_472_000, 1_981_498_000, 1442),
    line('bbbb222222222222bbbb2222', 'education', 'Primary Education - Wage', 12_457_345_000, 17_319_546_000, 1443),
    line('cccc333333333333cccc3333', 'roads', 'Request for Financial Support towards rehabilitation and Reinstatement of Various Road bridges devastated by heavy rains', 8_396_000_000, 0, 1444),
    line('dddd444444444444dddd4444', 'water', 'Piped Water Subgrant', 0, 169_716_000, 1445),
    line('eeee555555555555eeee5555', 'administration', 'Pension and Gratuity Arrears', 0, 389_776_000, 1446),
  ],
  '856': [line('ffff666666666666ffff6666', 'health', 'Health Development - Facility upgrades', 4_720_437_000, 0, 842)],
};

const filed: { cardId: string; vote: string; verdict: string }[] = [];
const data: Data = {
  years: { a: '2025/26', b: '2026/27' },
  votes: [
    { vote: '933', name: 'Wakiso District', level: 'district' },
    { vote: '856', name: 'Kasese District', level: 'district' },
    { vote: '722', name: 'Moroto Municipal Council', level: 'municipality' },
  ],
  linesFor: v => lines[v] ?? [],
  report: (cardId, vote, verdict) => { filed.push({ cardId, vote, verdict }); return true; },
};

/** Walk every reachable screen: the 182-character limit must hold everywhere, not on average. */
function crawl(): { input: string; text: string }[] {
  const seen: { input: string; text: string }[] = [];
  const tokens = ['1', '2', '3', '4', '5', '6', '9', '0'];
  const queue: string[] = ['', '1', '2', '3', '1*wak', '1*ka', '1*m', '1*zzz', '2*aaaa11', '2*nope'];
  const visited = new Set<string>();
  while (queue.length) {
    const input = queue.shift()!;
    if (visited.has(input) || visited.size > 4000) continue;
    visited.add(input);
    const r = render(input, data);
    seen.push({ input, text: r.text });
    if (r.end) continue;
    if (input.split('*').filter(Boolean).length >= 6) continue;
    for (const t of tokens) queue.push(input ? `${input}*${t}` : t);
  }
  return seen;
}

const screens = crawl();

test('every reachable screen fits a USSD screen', () => {
  assert.ok(screens.length > 200, `expected a broad crawl, walked ${screens.length}`);
  for (const s of screens) {
    const payload = s.text.replace(/^(CON|END) /, '');
    assert.ok(payload.length <= SCREEN_LIMIT,
      `input "${s.input}" produced ${payload.length} chars (limit ${SCREEN_LIMIT}):\n${payload}`);
  }
});

test('every screen is GSM-7 safe and correctly prefixed', () => {
  for (const s of screens) {
    assert.match(s.text, /^(CON|END) /, `input "${s.input}" missing CON/END`);
    assert.equal(s.text, gsm7(s.text), `input "${s.input}" contains characters a feature phone cannot render`);
  }
});

test('the menu is stateless: identical input always yields identical output', () => {
  for (const s of screens.slice(0, 50)) assert.equal(render(s.input, data).text, s.text);
});

test('the root menu offers the three options', () => {
  const r = render('', data);
  assert.match(r.text, /1\. My district budget/);
  assert.match(r.text, /2\. Check a card code/);
  assert.equal(r.end, false);
});

test('a single district match skips the disambiguation screen', () => {
  assert.match(render('1*wakiso', data).text, /Wakiso District[\s\S]*Choose a sector/);
});

test('an ambiguous prefix lists the matches', () => {
  const r = render('1*m', data);
  assert.match(r.text, /Moroto Municipal Council/);
});

test('an unknown district ends the session with an explanation', () => {
  const r = render('1*zzz', data);
  assert.equal(r.end, true);
  assert.match(r.text, /No local government starts with/);
});

test('a card detail screen shows both years, the movement and the source page', () => {
  const r = render('1*kasese*1*1', data);
  assert.match(r.text, /FY2025\/26: UGX 4\.72bn/);
  assert.match(r.text, /FY2026\/27: nothing \(CUT TO NOTHING\)/);
  assert.match(r.text, /Source p\.842/);
  assert.match(r.text, /1\.Yes 2\.Partly 3\.No/);
});

test('a verdict is recorded and the session ends without storing identity', () => {
  filed.length = 0;
  const r = render('1*kasese*1*1*3', data);
  assert.equal(r.end, true);
  assert.deepEqual(filed, [{ cardId: 'ffff666666666666ffff6666', vote: '856', verdict: 'disputed' }]);
  assert.match(r.text, /No name or number was stored/);
});

test('a card code heard on the radio resolves to the right card', () => {
  const r = render('2*ffff66', data);
  assert.match(r.text, /Kasese District/);
  assert.match(r.text, /Source p\.842/);
});

test('an unknown card code fails closed', () => {
  const r = render('2*999999', data);
  assert.equal(r.end, true);
  assert.match(r.text, /No card found/);
});

test('money is shortened to survive the character budget', () => {
  assert.equal(short(4_720_437_000), 'UGX 4.72bn');
  assert.equal(short(65_037_000), 'UGX 65m');
  assert.equal(short(35_499_000), 'UGX 35.5m');
  assert.equal(short(0), 'nothing');
});

test('a very long petition label cannot blow the screen budget', () => {
  const r = render('1*wakiso*4*1', data);
  assert.ok(r.text.replace(/^CON /, '').length <= SCREEN_LIMIT);
});

// ---- regressions found by walking the live gateway, not by the unit tests ----

test('menu entries stay distinguishable instead of truncating to identical text', () => {
  const r = render('1*wakiso*1', data);           // health sector for Wakiso
  const entries = r.text.split('\n').filter(l => /^\d\. /.test(l)).map(l => l.replace(/^\d\. /, ''));
  assert.equal(new Set(entries).size, entries.length, `duplicate menu entries:\n${entries.join('\n')}`);
});

test('a qualifier in brackets survives shortening, because it is the distinguishing part', () => {
  assert.match(label('Primary Health Care - Non Wage Recurrent (Government)', 24), /\(Govt\)$/);
  assert.match(label('Primary Health Care - Non Wage Recurrent (Results-based)', 24), /\(ResBased\)$/);
  assert.notEqual(
    label('Primary Health Care - Non Wage Recurrent (Government)', 24),
    label('Primary Health Care - Non Wage Recurrent (PNFP)', 24),
  );
});

test('every option offered on a screen is actually reachable, none lost to truncation', () => {
  for (const input of ['', '1*wakiso', '1*wakiso*1', '1*m']) {
    const r = render(input, data);
    const offered = r.text.split('\n').filter(l => /^\d\. /.test(l)).map(l => l[0]!);
    for (const digit of offered) {
      if (digit === '0' || digit === '9') continue;
      const next = render(input ? `${input}*${digit}` : digit, data);
      assert.doesNotMatch(next.text, /Invalid/, `option ${digit} on "${input}" was offered but rejected`);
    }
  }
});

test('9 pages forward and reveals options the first page could not fit', () => {
  const first = render('1*wakiso*5', data);        // "other" sector
  const second = render('1*wakiso*5*9', data);
  if (/9\. More/.test(first.text)) {
    assert.notEqual(second.text, first.text, 'More produced the same page');
    assert.doesNotMatch(second.text, /Invalid/);
  }
});

test('0 acts as Back by undoing the previous selection', () => {
  assert.equal(render('1*wakiso*1*0', data).text, render('1*wakiso', data).text);
  assert.equal(render('1*wakiso*1*2*0', data).text, render('1*wakiso*1', data).text);
});

test('digits typed where a district name is expected are rejected clearly', () => {
  const r = render('1*123', data);
  assert.equal(r.end, true);
  assert.match(r.text, /type letters, not numbers/);
});

test('a district whose bundle cannot be read says so instead of breaking', () => {
  const broken: Data = { ...data, linesFor: () => [] };
  const r = render('1*wakiso', broken);
  assert.equal(r.end, true);
  assert.match(r.text, /temporarily unavailable/);
  assert.ok(r.text.replace(/^END /, '').length <= SCREEN_LIMIT);
});
