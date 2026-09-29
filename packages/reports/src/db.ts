import { DatabaseSync } from 'node:sqlite';

/**
 * Deliberately minimal storage.
 *
 * A report carries no identity of any kind: no account, no phone number, no device id,
 * no IP address, no user agent, and no free text a person could be identified by. Even
 * the time is coarsened to a UTC date, so reports cannot be correlated by arrival order.
 * What is left is the smallest thing that is still useful — "somebody with a genuine copy
 * of this card says the money did not arrive."
 */
export type Verdict = 'confirmed' | 'partly' | 'disputed' | 'unsure';
export const VERDICTS: Verdict[] = ['confirmed', 'partly', 'disputed', 'unsure'];

export function openDb(path = 'reports.db') {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS reports (
      card_id TEXT NOT NULL,
      vote    TEXT NOT NULL,
      verdict TEXT NOT NULL CHECK (verdict IN ('confirmed','partly','disputed','unsure')),
      day     TEXT NOT NULL           -- UTC date only, never a timestamp
    );
    CREATE INDEX IF NOT EXISTS reports_vote ON reports (vote);
    CREATE INDEX IF NOT EXISTS reports_card ON reports (card_id);
  `);
  return {
    db,
    insert(cardId: string, vote: string, verdict: Verdict) {
      db.prepare('INSERT INTO reports (card_id, vote, verdict, day) VALUES (?, ?, ?, ?)')
        .run(cardId, vote, verdict, new Date().toISOString().slice(0, 10));
    },
    /** Counts only. There is nothing else in the table to return. */
    aggregate(vote: string) {
      const rows = db.prepare(
        'SELECT card_id, verdict, COUNT(*) AS n FROM reports WHERE vote = ? GROUP BY card_id, verdict'
      ).all(vote) as { card_id: string; verdict: Verdict; n: number }[];
      const out: Record<string, Record<string, number>> = {};
      for (const r of rows) (out[r.card_id] ??= {})[r.verdict] = r.n;
      return out;
    },
    close() { db.close(); },
  };
}
export type Store = ReturnType<typeof openDb>;
