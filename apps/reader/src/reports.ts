import type { Verdict } from '../../../packages/reports/src/db.ts';

/**
 * Reporting from the reader.
 *
 * Reports queue locally first and are sent when a connection appears, because the people
 * most worth hearing from are the ones with the worst connectivity. Nothing about the
 * person is attached — the payload is the signed card plus one of four verdicts.
 */
/**
 * Where reports go. A static-only deployment (GitHub Pages, an offline copy on a memory card)
 * has no service to send them to, so reporting is switched off and says so rather than
 * queueing answers that will never leave the phone.
 */
const configured = (import.meta as { env?: Record<string, string> }).env?.VITE_REPORTS_URL;
const API = configured === undefined ? 'http://127.0.0.1:8787' : configured;
export const REPORTING_ENABLED = API !== '';
const QUEUE = 'ssente.queue.v1';
const MINE = 'ssente.mine.v1';

export type Queued = { signed: unknown; verdict: Verdict; cardId: string };
export const VERDICT_LABEL: Record<Verdict, string> = {
  confirmed: 'Yes, this happened',
  partly: 'Only partly',
  disputed: 'No, not that I can see',
  unsure: 'Not sure',
};

const read = <T,>(k: string, fallback: T): T => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; }
};
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

/** Which cards this device has already reported on — kept locally so the UI can say so. */
export const myVerdicts = (): Record<string, Verdict> => read(MINE, {});

export function queueReport(cardId: string, signed: unknown, verdict: Verdict) {
  write(MINE, { ...myVerdicts(), [cardId]: verdict });
  write(QUEUE, [...read<Queued[]>(QUEUE, []).filter(q => q.cardId !== cardId), { cardId, signed, verdict }]);
}

/** Returns how many queued reports were delivered. Failures stay queued for the next try. */
export async function flushQueue(): Promise<number> {
  const queue = read<Queued[]>(QUEUE, []);
  if (!queue.length) return 0;
  const left: Queued[] = [];
  let sent = 0;
  for (const q of queue) {
    try {
      const res = await fetch(`${API}/reports`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signed: q.signed, verdict: q.verdict }),
      });
      if (res.ok) sent++;
      else if (res.status >= 500 || res.status === 429) left.push(q);   // retry later
      // a 400 means the card itself was refused; retrying cannot help, so drop it
    } catch { left.push(q); }
  }
  write(QUEUE, left);
  return sent;
}

export const pendingCount = () => read<Queued[]>(QUEUE, []).length;

export type Counts = Record<string, Partial<Record<Verdict, number>>>;

export async function fetchCounts(vote: string): Promise<Counts> {
  try {
    const res = await fetch(`${API}/aggregate?vote=${vote}`);
    if (!res.ok) return {};
    return ((await res.json()) as { counts: Counts }).counts ?? {};
  } catch { return {}; }
}
