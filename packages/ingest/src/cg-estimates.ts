/**
 * Deterministic parser for Uganda MoFPED "Volume 1: Central Government Votes".
 *
 * This is a different document from Volume II with a different grammar, so it gets its own
 * parser rather than flags on the local-government one. It is what brings Kampala into the
 * project: the capital is not a local government but **Vote 122, Kampala Capital City
 * Authority**, and its budget is broken down by its five divisions — Kampala Central,
 * Kawempe, Lubaga, Makindye and Nakawa — which is finer than district level.
 *
 * Every row carries six figures rather than two: government funds, external (donor)
 * financing and their total, for each of two years. That yields two independent audits —
 * the stated group total, and the fact that GoU + External must equal Total on every row.
 *
 * Two of the seven tables per vote are worth cards:
 *
 *   Table V1  Programme: <nn> <programme name>          <- note the colon
 *               <dd> <department or division>   G E T G E T
 *               Total for Programme             G E T G E T    <- audit
 *               Total Excluding Arrears         G E T G E T    <- arrears removed, not an audit
 *
 *   Table V5  Items  GoU External Fin. Total ...
 *               <nnnnnn> <expenditure item>     G E T G E T
 *               Grand Total Vote <code>         G E T G E T    <- audit
 *
 * Table V2 looks deceptively similar and must not be mixed in: it writes `Programme` with no
 * colon, adds `Vote Function` headers, and numbers its rows with three digits instead of two.
 *
 * Region tracking is asymmetric because the captions sit differently in the text stream: V1's
 * caption appears *after* its first rows (it is the first table of the vote, so the region
 * simply opens at the vote boundary), while V5's appears before its rows.
 */

const N = String.raw`(?:-|\d[\d,]*)`;
const SIX = new RegExp(`^(.*?)\\s+(${N})\\s+(${N})\\s+(${N})\\s+(${N})\\s+(${N})\\s+(${N})\\s*$`);
const HEADER = /^(Vote Draft Budget Estimates|VOTE:|Thousand Uganda Shillings|GoU External Fin\. Total|Items GoU|Recurrent Budget Estimates|Development Budget Estimates|Wage NonWage|Draft Budget Estimates FY|\d{1,4}$|[ivxlc]+$)/;
const MAX_WRAP = 5;
const MAX_JOINED = 400;
const toNum = (s: string): number => (s === '-' ? 0 : Number(s.replace(/,/g, '')));

export type CgRow = {
  vote: string; voteName: string;
  table: 'V1' | 'V5';
  unitCode: string; unit: string;     // programme (V1), or the items table (V5)
  itemCode: string; item: string;     // department/division (V1), or expenditure item (V5)
  gouA: number; extA: number; totA: number;
  gouB: number; extB: number; totB: number;
  page: number;
};
export type CgTotal = { vote: string; unit: string | null; f: number[] };
export type CgParsed = {
  pageCount: number;
  years: { a: string; b: string; aKind: 'approved' | 'draft'; bKind: 'approved' | 'draft' };
  votes: { code: string; name: string }[];
  rows: CgRow[];
  programmeTotals: CgTotal[];   // Table V1, per programme
  voteTotals: CgTotal[];        // Table V5, per vote
};

function detectYears(txt: string): CgParsed['years'] {
  const seen: { fy: string; kind: 'approved' | 'draft' }[] = [];
  for (const m of txt.matchAll(/(\d{4}\/\d{2}) (Approved|Draft) Estimates/g)) {
    const fy = m[1]!, kind = m[2]!.toLowerCase() as 'approved' | 'draft';
    if (!seen.some(s => s.fy === fy)) seen.push({ fy, kind });
    if (seen.length === 2) break;
  }
  if (seen.length < 2) throw new Error('could not detect the two fiscal years from the Volume 1 header');
  const [a, b] = seen.sort((x, y) => (x.fy < y.fy ? -1 : 1)) as [typeof seen[0], typeof seen[0]];
  return { a: a.fy, b: b.fy, aKind: a.kind, bKind: b.kind };
}

export function parseCgEstimates(txt: string): CgParsed {
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

  const rows: CgRow[] = [], programmeTotals: CgTotal[] = [], voteTotals: CgTotal[] = [];

  for (const v of votes.values()) {
    const lines = v.pages.flatMap(p => p.text.split('\n').map(l => [p.pdfPage, l.trim()] as [number, string]));
    let region: 'V1' | 'V5' | 'other' = 'V1';   // V1 is the first table of every vote
    let prog: { code: string; name: string } | null = null;
    let buf = '', bufPage = 0, wraps = 0;

    for (const [page, line] of lines) {
      if (!line) continue;

      const cap = line.match(/^Table (V\d):/);
      if (cap) {
        const t = cap[1];
        if (t === 'V5') region = 'V5';
        else if (t !== 'V1') { region = 'other'; prog = null; }
        buf = ''; wraps = 0; continue;
      }
      // Table V2's vocabulary. Seeing it means V1 is over, whatever the captions say.
      if (/^Programme\s+\d{2}\s/.test(line) || /^Vote Function\s/.test(line) || /^Total (Recurrent|for Vote Function)/.test(line)) {
        if (region === 'V1') { region = 'other'; prog = null; }
        buf = ''; wraps = 0; continue;
      }
      if (HEADER.test(line)) { buf = ''; wraps = 0; continue; }

      const pm = line.match(/^Programme:\s+(\d{2})\s+(.+)$/);
      if (pm && !SIX.test(line)) { prog = { code: pm[1]!, name: pm[2]!.trim() }; region = 'V1'; buf = ''; wraps = 0; continue; }

      const joined = buf ? `${buf} ${line}` : line;
      const m = joined.match(SIX);
      if (!m) {
        if (wraps < MAX_WRAP && joined.length <= MAX_JOINED) { if (!buf) bufPage = page; buf = joined; wraps++; }
        else { buf = ''; wraps = 0; }
        continue;
      }
      buf = ''; wraps = 0;
      const label = m[1]!.trim();
      const f = [toNum(m[2]!), toNum(m[3]!), toNum(m[4]!), toNum(m[5]!), toNum(m[6]!), toNum(m[7]!)];
      const at = bufPage || page;

      if (/^Total for Programme$/.test(label)) {
        if (region === 'V1' && prog) programmeTotals.push({ vote: v.code, unit: prog.name, f });
        continue;
      }
      if (/^Grand Total Vote\b/.test(label)) {
        if (region === 'V5') voteTotals.push({ vote: v.code, unit: null, f });
        continue;
      }
      if (/^Total\b/.test(label) || /^Grand Total\b/.test(label)) continue;

      if (region === 'V1' && prog) {
        const d = label.match(/^(\d{2})\s+(.+)$/);
        if (!d) continue;
        rows.push({
          vote: v.code, voteName: v.name, table: 'V1',
          unitCode: prog.code, unit: prog.name, itemCode: d[1]!, item: d[2]!.trim(),
          gouA: f[0]! * 1000, extA: f[1]! * 1000, totA: f[2]! * 1000,
          gouB: f[3]! * 1000, extB: f[4]! * 1000, totB: f[5]! * 1000, page: at,
        });
        continue;
      }
      if (region === 'V5') {
        const d = label.match(/^(\d{6})\s+(.+)$/);
        if (!d) continue;
        rows.push({
          vote: v.code, voteName: v.name, table: 'V5',
          unitCode: 'items', unit: 'Expenditure items', itemCode: d[1]!, item: d[2]!.trim(),
          gouA: f[0]! * 1000, extA: f[1]! * 1000, totA: f[2]! * 1000,
          gouB: f[3]! * 1000, extB: f[4]! * 1000, totB: f[5]! * 1000, page: at,
        });
      }
    }
  }

  return { pageCount: pages.length, years, votes: [...votes.values()].map(v => ({ code: v.code, name: v.name })), rows, programmeTotals, voteTotals };
}
