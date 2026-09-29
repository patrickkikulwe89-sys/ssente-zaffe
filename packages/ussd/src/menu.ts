/**
 * USSD menu for feature phones — the channel that needs no data bundle at all.
 *
 * Three constraints shape every line of this file:
 *
 *  1. **182 characters per screen.** GSM-7, one screen, no scrolling. A figure like
 *     "UGX 4,720,437,000" eats a tenth of the budget on its own, so amounts are shortened
 *     and every screen is length-checked (see `screen`).
 *  2. **The gateway is stateless towards us.** Africa's Talking and most African gateways
 *     resend the whole accumulated input each step ("1*wak*2*1"), so `render` is a pure
 *     function of that string. No sessions, no memory, nothing to lose on restart.
 *  3. **Numeric keypad first.** Selections are digits. Text entry is used once, for the
 *     district name, because 176 local governments cannot be paged through eight at a time.
 *
 * Honest limit: a feature phone cannot check an Ed25519 signature. On this channel the
 * verification happens on the gateway before rendering and the citizen is trusting the
 * gateway operator, not mathematics. Every screen therefore names the document and page so
 * the claim can be checked against the published PDF by anyone who can reach it.
 */

export const SCREEN_LIMIT = 182;
export type Vote = { vote: string; name: string; level: string };
export type Line = { id: string; topic: string; item: string; a: number; b: number; page: number; claim: string };
export type Data = {
  years: { a: string; b: string };
  votes: Vote[];
  linesFor(vote: string): Line[];
  /** Records a citizen verdict; returns false if it could not be accepted. */
  report(cardId: string, vote: string, verdict: 'confirmed' | 'partly' | 'disputed'): boolean;
};
export type Reply = { text: string; end: boolean };

/** GSM-7 has no curly quotes, dashes or symbols we might slip in from the PDF. */
export const gsm7 = (s: string): string =>
  s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
   .replace(/[–—]/g, '-').replace(/…/g, '...')
   .replace(/[^\x0A\x0D\x20-\x5F\x61-\x7E]/g, '');

/** Shorten money hard: 182 characters does not allow "UGX 4,720,437,000". */
export function short(ugx: number): string {
  if (ugx === 0) return 'nothing';
  if (ugx >= 1e9) return `UGX ${(ugx / 1e9).toFixed(2).replace(/\.0+$/, '')}bn`;
  if (ugx >= 1e6) return `UGX ${(ugx / 1e6).toFixed(1).replace(/\.0$/, '')}m`;
  if (ugx >= 1e3) return `UGX ${Math.round(ugx / 1e3)}k`;
  return `UGX ${ugx}`;
}

/**
 * Shorten a budget label without destroying what distinguishes it.
 *
 * The naive approach — slice the first 22 characters — turns
 * "Primary Health Care - Non Wage Recurrent (Government)", "... (PNFP)" and
 * "... (Results-based)" into three identical menu entries, which is worse than useless on a
 * phone with no scrollback. So known boilerplate is abbreviated first, and any parenthesised
 * qualifier is preserved even when the middle has to go.
 */
const ABBREV: [RegExp, string][] = [
  [/Programme Conditional Grant\s*-?\s*/gi, ''],
  [/Conditional Grant/gi, 'CG'],
  [/Primary Health\s?Care/gi, 'PHC'],
  [/Primary Healthcare/gi, 'PHC'],
  [/Primary Education/gi, 'P.Educ'],
  [/Secondary Education/gi, 'S.Educ'],
  [/Skills Development/gi, 'Skills'],
  [/Non Wage Recurrent/gi, 'NonWage'],
  [/Non-?Wage/gi, 'NonWage'],
  [/Recurrent/gi, 'Rec'],
  [/Development/gi, 'Dev'],
  [/Rehabilitation( and)?/gi, 'Rehab'],
  [/Request for (Funds?|Funding|Financial Support)( towards| to| for)?/gi, 'Req'],
  [/Appeal for Support for/gi, 'Appeal:'],
  [/Government/gi, 'Govt'],
  [/Results-based/gi, 'ResBased'],
  [/Allocation/gi, 'Alloc'],
  [/Subgrant/gi, 'SubG'],
  [/Construction of/gi, 'Constr'],
  [/Administration/gi, 'Admin'],
  [/\s+-\s+/g, ' '],
  [/\s{2,}/g, ' '],
];

export function label(item: string, max: number): string {
  let t = item;
  for (const [re, to] of ABBREV) t = t.replace(re, to);
  t = t.trim();
  if (t.length <= max) return t;
  // Keep the trailing qualifier: it is usually the only thing telling two lines apart.
  const q = t.match(/\(([^)]{1,14})\)\s*$/);
  if (q && q[1]) {
    const tail = ` (${q[1]})`;
    const head = t.slice(0, Math.max(1, max - tail.length)).trimEnd();
    return head + tail;
  }
  return t.slice(0, max).trimEnd();
}

function screen(text: string, end = false): Reply {
  const t = gsm7(text).trimEnd();
  // Truncate rather than let a gateway silently cut mid-word.
  const out = t.length <= SCREEN_LIMIT ? t : t.slice(0, SCREEN_LIMIT - 3).trimEnd() + '...';
  return { text: `${end ? 'END' : 'CON'} ${out}`, end };
}

const MAX_PER_PAGE = 6;   // 9 is reserved for More, 0 for Back
const TOPICS = ['health', 'education', 'water', 'roads', 'other'] as const;

/**
 * Pack a list into pages that actually fit, rather than a fixed count that sometimes
 * overflows and loses the last option to truncation.
 */
function pagesOf(labels: string[], head: string): number[][] {
  const tail = '\n9. More\n0. Back';
  const pages: number[][] = [];
  let cur: number[] = [], len = head.length + tail.length;
  for (let i = 0; i < labels.length; i++) {
    const line = `\n${cur.length + 1}. ${labels[i]}`;
    if (cur.length && (cur.length >= MAX_PER_PAGE || len + line.length > SCREEN_LIMIT)) {
      pages.push(cur); cur = []; len = head.length + tail.length;
    }
    cur.push(i);
    len += `\n${cur.length}. ${labels[i]}`.length;
  }
  if (cur.length) pages.push(cur);
  return pages.length ? pages : [[]];
}

/**
 * Resolve one selection step. Leading 9s advance the page, so the digit that follows always
 * indexes the page the caller is actually looking at.
 */
function select<T>(digits: string[], items: T[], labels: string[], head: string):
  { chosen: T; rest: string[] } | { reply: Reply } {
  const pages = pagesOf(labels, head);
  let i = 0, page = 0;
  while (digits[i] === '9') { page = Math.min(page + 1, pages.length - 1); i++; }
  const idx = pages[page]!;
  const pick = digits[i];
  if (!pick) {
    const lines = idx.map((n, k) => `${k + 1}. ${labels[n]}`);
    const more = page + 1 < pages.length ? '\n9. More' : '';
    return { reply: screen(`${head}\n${lines.join('\n')}${more}\n0. Back`) };
  }
  const chosen = items[idx[Number(pick) - 1] ?? -1];
  if (chosen === undefined) return { reply: screen('Invalid choice. Please dial again.', true) };
  return { chosen, rest: digits.slice(i + 1) };
}

/**
 * Apply the 0 key as a real Back.
 *
 * The gateway resends the whole accumulated string, so a back-step is expressed by deleting
 * the selection it undoes. Doing it here keeps every screen below a pure function of the input.
 */
export function collapseBacks(parts: string[]): string[] {
  const out: string[] = [];
  for (const p of parts) { if (p === '0') out.pop(); else out.push(p); }
  return out;
}

/** Lines a citizen is most likely to care about first: biggest movements, then biggest sums. */
const rank = (l: Line) => Math.abs(l.b - l.a) * (l.a === 0 || l.b === 0 ? 2 : 1);

export function render(raw: string, d: Data): Reply {
  const parts = collapseBacks((raw ?? '').split('*').filter(s => s !== ''));

  if (parts.length === 0)
    return screen(`Ssente Zaffe - our money\nFY${d.years.a} vs FY${d.years.b}\n1. My district budget\n2. Check a card code\n3. About`);

  // ---- 3: about -------------------------------------------------------------
  if (parts[0] === '3')
    return screen('Figures come from the Ministry of Finance local government budget estimates. Every figure is signed and reconciled with the published document. Free to use. Dial again any time.', true);

  // ---- 2: look up a card code heard on radio or passed on by a neighbour ----
  if (parts[0] === '2') {
    const code = parts[1];
    if (!code) return screen('Enter the 6-character card code:');
    for (const v of d.votes) {
      const hit = d.linesFor(v.vote).find(l => l.id.startsWith(code.toLowerCase()));
      if (hit) return detail(hit, v, d, ['2', code]);
    }
    return screen(`No card found for code ${code}. Check the code and dial again.`, true);
  }

  if (parts[0] !== '1') return screen('Unknown option. Please dial again.', true);

  // ---- 1: my district -------------------------------------------------------
  const query = parts[1];
  if (!query) return screen('Enter the first letters of your district, city or municipality:');
  if (/^\d+$/.test(query)) return screen('Please type letters, not numbers, for the district name. Dial again.', true);

  const matches = d.votes.filter(v => v.name.toLowerCase().startsWith(query.toLowerCase()));
  if (matches.length === 0) return screen(`No local government starts with "${query}". Dial again to retry.`, true);

  // Walk the remaining digits: district pick, sector pick, line pick, verdict.
  let digits = parts.slice(2);

  let chosen: Vote;
  if (matches.length === 1) chosen = matches[0]!;
  else {
    const r = select(digits, matches, matches.map(m => m.name), `${matches.length} matches:`);
    if ('reply' in r) return r.reply;
    chosen = r.chosen; digits = r.rest;
  }

  const lines = d.linesFor(chosen.vote);
  const present = TOPICS.filter(t => lines.some(l => l.topic === t));
  const rt = select(digits, present, present.map(t => t.charAt(0).toUpperCase() + t.slice(1)),
                    `${chosen.name}\n${lines.length} budget lines. Choose a sector:`);
  if ('reply' in rt) return rt.reply;
  const topic = rt.chosen; digits = rt.rest;

  const inTopic = lines.filter(l => l.topic === topic).sort((x, y) => rank(y) - rank(x));
  const head = `${chosen.name} - ${topic}`;
  const rl = select(digits, inTopic, inTopic.map(l => `${label(l.item, 24)}: ${short(l.b)}`), head);
  if ('reply' in rl) return rl.reply;
  const line = rl.chosen; digits = rl.rest;

  const verdictPick = digits[0];
  if (!verdictPick) return detail(line, chosen, d, parts);

  const verdict = ({ '1': 'confirmed', '2': 'partly', '3': 'disputed' } as const)[verdictPick];
  if (!verdict) return screen('Invalid choice. Please dial again.', true);
  const ok = d.report(line.id, chosen.vote, verdict);
  return screen(ok
    ? `Thank you. Your answer was recorded for ${chosen.name}. No name or number was stored. Code ${line.id.slice(0, 6)} - tell a neighbour to dial *384# option 2 to see it.`
    : 'Sorry, your answer could not be recorded. Please try again later.', true);
}

function detail(l: Line, v: Vote, d: Data, _parts: string[]): Reply {
  const move = l.b === 0 && l.a > 0 ? 'CUT TO NOTHING'
    : l.a === 0 && l.b > 0 ? 'NEW'
    : l.a === l.b ? 'UNCHANGED'
    : `${l.b > l.a ? '+' : '-'}${Math.abs(Math.round(((l.b - l.a) / l.a) * 100))}%`;
  return screen(
    `${v.name}\n${label(l.item, 44)}\nFY${d.years.a}: ${short(l.a)}\nFY${d.years.b}: ${short(l.b)} (${move})\nSource p.${l.page}. Code ${l.id.slice(0, 6)}\nDid it reach you?\n1.Yes 2.Partly 3.No`
  );
}
