/**
 * Deterministic parser for Uganda MoFPED "Volume II: Local Government Votes".
 *
 * Deliberately contains no language model. Every figure a citizen sees is produced
 * here and cross-checked against a total the source document states itself
 * (see reconcile.ts), so a wording model can never alter an amount.
 *
 * Grammar of Table V4, learned from FY2025/26 and FY2026/27:
 *   VOTE: <nnn> <name>
 *   Table V4: Detailed Estimates by Department, Service Area, and Item
 *     Department <nnn|M> <name>            <a> <b>     -- recurrent side
 *     Project    <nnnn>   <name>           <a> <b>     -- development side
 *       <nnnnnn> <grant name>              <a> <b>
 *         [o/w ]<service area or petition> <a> <b>
 *     Total For <Department|Project> ...   <a> <b>     -- ignored, used only to audit
 *
 * Wrinkles that cost real accuracy and are handled explicitly:
 *   - one department is coded `M` ("M MultiDepartment"), not three digits;
 *   - `Total Recurrent Budget Estimates` rows look exactly like item rows;
 *   - labels wrap over as many as six printed lines, and the longest of them are
 *     the named petition items ("...Road bridges ... washed away ... in Kinkizi East")
 *     which are the most locally useful rows in the document.
 */

const NUM = String.raw`(?:-|\d[\d,]*)`;
const TWO = new RegExp(`^(.*?)\\s+(${NUM})\\s+(${NUM})\\s*$`);
const HEADER = /^(Local Government|VOTE:\s|Thousand Uganda Shillings|\(Ushs\.'000\)|\d{4}\/\d{2} (Approved|Draft) Budget|Recurrent Budget Estimates|Development Budget Estimates|Table V\d|Wage NonWage|[ivxlc]+$|\d{1,4}$)/;
const MAX_WRAP = 6;

const toThousands = (s: string): number => (s === '-' ? 0 : Number(s.replace(/,/g, '')));

export type Unit = { kind: 'department' | 'project'; code: string; name: string };
export type Item = {
  vote: string; voteName: string; level: 'district' | 'city' | 'municipality';
  unit: string; unitKind: Unit['kind']; unitCode: string;
  grantCode: string | null; grant: string | null;
  item: string;
  /** whole Uganda Shillings, converted from the document's thousands */
  a: number; b: number;
  page: number;
};
export type GrantTotal = { vote: string; unit: string; grant: string; a: number; b: number; page: number };
export type Parsed = {
  pageCount: number;
  /** fiscal years as the document labels them, never hardcoded */
  years: { a: string; b: string; aKind: 'approved' | 'draft'; bKind: 'approved' | 'draft' };
  items: Item[];
  grantTotals: GrantTotal[];
};

export function levelOf(voteCode: string): Item['level'] {
  const d = voteCode[0];
  if (d === '6') return 'city';
  if (d === '7') return 'municipality';
  return 'district';
}

function detectYears(txt: string): Parsed['years'] {
  const re = /(\d{4}\/\d{2}) (Approved|Draft) Budget/g;
  const seen: { fy: string; kind: 'approved' | 'draft' }[] = [];
  for (const m of txt.matchAll(re)) {
    const fy = m[1]!, kind = m[2]!.toLowerCase() as 'approved' | 'draft';
    if (!seen.some(s => s.fy === fy)) seen.push({ fy, kind });
    if (seen.length === 2) break;
  }
  if (seen.length < 2) throw new Error('could not detect the two fiscal years from the document header');
  const [a, b] = seen.sort((x, y) => (x.fy < y.fy ? -1 : 1)) as [typeof seen[0], typeof seen[0]];
  return { a: a.fy, b: b.fy, aKind: a.kind, bKind: b.kind };
}

/** Rejoin labels that the PDF broke across lines; a logical row ends in two figures. */
function logicalRows(lines: [number, string][]) {
  const out: { page: number; label: string; a: number; b: number }[] = [];
  let buf = '', bufPage = 0, wraps = 0;
  for (const [page, line] of lines) {
    if (!line) continue;
    if (HEADER.test(line)) { buf = ''; wraps = 0; continue; }
    const joined = buf ? `${buf} ${line}` : line;
    const m = joined.match(TWO);
    if (m) { out.push({ page: buf ? bufPage : page, label: m[1]!.trim(), a: toThousands(m[2]!), b: toThousands(m[3]!) }); buf = ''; wraps = 0; }
    else if (wraps < MAX_WRAP) { if (!buf) bufPage = page; buf = joined; wraps++; }
    else { buf = ''; wraps = 0; }
  }
  return out;
}

export function parseLgEstimates(txt: string): Parsed {
  const years = detectYears(txt);
  const parts = txt.split(/^-- (\d+) of \d+ --$/m);
  const pages: { pdfPage: number; text: string }[] = [];
  for (let i = 1; i < parts.length; i += 2) pages.push({ pdfPage: Number(parts[i]), text: parts[i + 1] ?? '' });

  const votes = new Map<string, { code: string; name: string; pages: typeof pages }>();
  let cur: { code: string; name: string; pages: typeof pages } | null = null;
  for (const p of pages) {
    const m = p.text.match(/^VOTE:\s+(\d{3})\s+(.+?)\s*$/m);
    if (m) {
      const code = m[1]!;
      if (!votes.has(code)) votes.set(code, { code, name: m[2]!.trim(), pages: [] });
      cur = votes.get(code)!;
    }
    if (cur) cur.pages.push(p);
  }

  const items: Item[] = [], grantTotals: GrantTotal[] = [];
  for (const v of votes.values()) {
    const lines: [number, string][] = v.pages.flatMap(p => p.text.split('\n').map(l => [p.pdfPage, l.trim()] as [number, string]));
    const start = lines.findIndex(([, l]) => l.startsWith('Table V4: Detailed Estimates'));
    if (start < 0) continue;
    let unit: Unit | null = null, grant: { code: string; name: string } | null = null;
    for (const r of logicalRows(lines.slice(start + 1))) {
      let m: RegExpMatchArray | null;
      if ((m = r.label.match(/^Department\s+(\d{3}|M)\s+(.+)$/))) { unit = { kind: 'department', code: m[1]!, name: m[2]! }; grant = null; continue; }
      if ((m = r.label.match(/^Project\s+(\d{4})\s+(.+)$/)))      { unit = { kind: 'project',    code: m[1]!, name: m[2]! }; grant = null; continue; }
      if (/^Total\b/.test(r.label)) continue;
      if (!unit) continue;
      if ((m = r.label.match(/^(\d{6})\s+(.+)$/))) {
        grant = { code: m[1]!, name: m[2]! };
        grantTotals.push({ vote: v.code, unit: unit.name, grant: grant.name, a: r.a * 1000, b: r.b * 1000, page: r.page });
        continue;
      }
      const item = r.label.replace(/^o\/w\s+/, '').trim();
      if (!item) continue;
      items.push({
        vote: v.code, voteName: v.name, level: levelOf(v.code),
        unit: unit.name, unitKind: unit.kind, unitCode: unit.code,
        grantCode: grant?.code ?? null, grant: grant?.name ?? null,
        item, a: r.a * 1000, b: r.b * 1000, page: r.page,
      });
    }
  }
  return { pageCount: pages.length, years, items, grantTotals };
}
