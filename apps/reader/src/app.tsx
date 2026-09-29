import { useEffect, useMemo, useState } from 'preact/hooks';
import { fetchIndex, loadVote, checkPasted, ugx, ISSUERS, type Checked, type Index, type VoteRef } from './store.ts';
import type { Card } from '@core/card.ts';
import { VERDICT_LABEL, queueReport, flushQueue, fetchCounts, myVerdicts, pendingCount, REPORTING_ENABLED, type Counts } from './reports.ts';
import type { Verdict } from '../../../packages/reports/src/db.ts';

const useOnline = () => {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const f = () => setOn(navigator.onLine);
    addEventListener('online', f); addEventListener('offline', f);
    return () => { removeEventListener('online', f); removeEventListener('offline', f); };
  }, []);
  return on;
};

function Change({ card }: { card: Card }) {
  const [a, b] = card.amounts;
  if (!a || !b) return null;
  if (b.ugx === 0 && a.ugx > 0) return <span class="badge cut">cut to nothing</span>;
  if (a.ugx === 0 && b.ugx > 0) return <span class="badge new">new money</span>;
  if (a.ugx === b.ugx) return <span class="badge flat">unchanged</span>;
  const pct = card.change?.pct ?? 0;
  return <span class={`badge ${pct > 0 ? 'up' : 'down'}`}>{pct > 0 ? '+' : ''}{pct}%</span>;
}

/**
 * Citizen reports are unsigned. They are rendered in a distinct, explicitly labelled block
 * so they can never borrow the authority of a verified figure — that boundary is the whole
 * reason the signed cards are worth anything.
 */
function Reports({ card, signed, counts, onReport }: {
  card: Card; signed: unknown; counts: Partial<Record<Verdict, number>>; onReport: (v: Verdict) => void;
}) {
  const mine = myVerdicts()[card.id];
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  return (
    <section class="reports" aria-label="Citizen reports">
      <p class="rlabel">Citizen reports · <em>unverified, not government figures</em></p>
      {total > 0 && (
        <ul class="rcounts">
          {(Object.keys(VERDICT_LABEL) as Verdict[]).filter(v => counts[v]).map(v => (
            <li key={v}><strong>{counts[v]}</strong> {VERDICT_LABEL[v].toLowerCase()}</li>
          ))}
        </ul>
      )}
      {!REPORTING_ENABLED
        ? <p class="rprivacy">Reporting is not available on this build — the budget figures above still verify offline.</p>
        : mine
        ? <p class="rmine">You reported: <strong>{VERDICT_LABEL[mine]}</strong></p>
        : <>
            <p class="hint">Did this reach your community?</p>
            <div class="rbuttons">
              {(Object.keys(VERDICT_LABEL) as Verdict[]).map(v => (
                <button key={v} onClick={() => onReport(v)}>{VERDICT_LABEL[v]}</button>
              ))}
            </div>
            <p class="rprivacy">No account, no phone number, no location. Only your answer is sent.</p>
          </>}
    </section>
  );
}

function CardView({ c, counts, onReport }: {
  c: Checked; counts: Partial<Record<Verdict, number>>; onReport: (card: Card, signed: unknown, v: Verdict) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!c.ok) {
    return (
      <article class="card rejected">
        <p class="reject">⚠ Not shown as fact — {c.reason}</p>
        {c.card && <p class="claim muted">{c.card.claim}</p>}
      </article>
    );
  }
  const card = c.card;
  const share = async () => {
    const text = JSON.stringify(c.signed);
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch {
      const blob = new Blob([text], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${card.id}.card.json`; a.click();
    }
  };
  return (
    <article class="card">
      <header class="cardhead">
        <span class={`topic t-${card.topic}`}>{card.topic}</span>
        <Change card={card} />
        <span class="badge verified" title="Signature checked on this device">✓ verified</span>
      </header>
      <p class="claim">{card.claim}</p>
      <dl class="amounts">
        {card.amounts.map(a => (
          <div key={a.fy}><dt>FY{a.fy} <small>{a.kind}</small></dt><dd>{ugx(a.ugx)}</dd></div>
        ))}
      </dl>
      <div class="actions">
        <button onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide source' : 'Where this came from'}</button>
        <button onClick={share}>{copied ? 'Copied ✓' : 'Share this card'}</button>
      </div>
      <Reports card={card} signed={c.signed} counts={counts} onReport={v => onReport(card, c.signed, v)} />
      {open && (
        <dl class="prov">
          <dt>Document</dt><dd>{card.source.title}</dd>
          <dt>Published by</dt><dd>{card.source.publisher}</dd>
          <dt>Page</dt><dd>p. {card.source.page}, table {card.source.table}</dd>
          <dt>Budget line</dt><dd>{card.unit} → {card.item}</dd>
          <dt>Document fingerprint</dt><dd class="mono">{card.source.sha256.slice(0, 32)}…</dd>
          <dt>Figures produced by</dt><dd>{card.provenance.extractor} (no language model)</dd>
          <dt>Arithmetic check</dt><dd>{card.provenance.reconciled ? 'reconciled against the document’s own stated total' : 'not reconciled'}</dd>
        </dl>
      )}
    </article>
  );
}

function CheckPanel() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<Checked | null>(null);
  return (
    <section class="panel">
      <h2>Check a card someone sent you</h2>
      <p class="hint">Paste card data forwarded over WhatsApp, SMS or copied from another phone. It is checked on this device — no internet needed.</p>
      <label class="sr" for="paste">Card data</label>
      <textarea id="paste" rows={4} value={text} onInput={e => setText((e.target as HTMLTextAreaElement).value)} placeholder='{"card":{…},"sig":{…}}' />
      <button class="primary" onClick={() => setResult(checkPasted(text))} disabled={!text.trim()}>Check it</button>
      {result && (result.ok
        ? <div class="verdict good"><strong>✓ Genuine.</strong> Signed by {ISSUERS[(result.signed as any).sig.keyId] ?? 'a trusted publisher'}.<p class="claim">{result.card.claim}</p></div>
        : <div class="verdict bad"><strong>✗ Do not trust this.</strong> {result.reason}</div>)}
    </section>
  );
}

export function App() {
  const online = useOnline();
  const [index, setIndex] = useState<Index | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [vote, setVote] = useState<VoteRef | null>(null);
  const [cards, setCards] = useState<Checked[] | null>(null);
  const [stats, setStats] = useState({ verified: 0, rejected: 0 });
  const [topic, setTopic] = useState('all');
  const [counts, setCounts] = useState<Counts>({});
  const [pending, setPending] = useState(pendingCount());

  useEffect(() => { fetchIndex().then(setIndex).catch(e => setErr(String(e.message ?? e))); }, []);

  // Send anything that was reported while offline, as soon as a connection returns.
  useEffect(() => {
    if (!online) return;
    flushQueue().then(sent => {
      setPending(pendingCount());
      if (sent && vote) fetchCounts(vote.vote).then(setCounts);
    });
  }, [online, vote?.vote]);

  const matches = useMemo(() => {
    if (!index) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return index.votes.filter(v => v.name.toLowerCase().includes(needle)).slice(0, 12);
  }, [index, q]);

  const open = async (v: VoteRef) => {
    setVote(v); setCards(null); setTopic('all');
    try {
      const r = await loadVote(v.vote);
      setCards(r.checked); setStats({ verified: r.verified, rejected: r.rejected });
      fetchCounts(v.vote).then(setCounts);
    }
    catch (e) { setErr(String((e as Error).message)); }
  };

  const report = (card: Card, signed: unknown, verdict: Verdict) => {
    queueReport(card.id, signed, verdict);
    setPending(pendingCount());
    setCounts(c => ({ ...c, [card.id]: { ...c[card.id], [verdict]: (c[card.id]?.[verdict] ?? 0) + 1 } }));
    if (online) flushQueue().then(() => setPending(pendingCount()));
  };

  const shown = useMemo(() => {
    if (!cards) return [];
    return topic === 'all' ? cards : cards.filter(c => c.ok && c.card.topic === topic);
  }, [cards, topic]);

  const topicsPresent = useMemo(() => {
    const s = new Set<string>();
    for (const c of cards ?? []) if (c.ok) s.add(c.card.topic);
    return [...s].sort();
  }, [cards]);

  return (
    <div class="wrap">
      <header class="top">
        <h1>Ssente Zaffe <small>our money</small></h1>
        <span class={online ? 'chip on' : 'chip off'}>{online ? 'online' : 'offline — still working'}</span>
      </header>

      {err && <p class="verdict bad">{err}</p>}

      {!vote && (
        <>
          <p class="lede">
            What was your district budgeted, and did it change? Every figure below is signed and
            checked on your own phone, so it works with no internet and cannot be quietly altered.
          </p>
          <label class="sr" for="q">Find your district, city or municipality</label>
          <input id="q" class="search" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)}
                 placeholder="Type your district — Wakiso, Kasese, Gulu…" autocomplete="off" />
          {index && !q && <p class="hint">{index.votes.length} local governments · FY{index.years.a} compared with FY{index.years.b}</p>}
          <ul class="hits">
            {matches.map(v => (
              <li key={v.vote}>
                <button onClick={() => open(v)}>
                  <strong>{v.name}</strong>
                  <span class="meta">{v.level} · {v.cards} budget lines · {Math.round(v.bytes / 1024)} KB</span>
                </button>
              </li>
            ))}
          </ul>
          {!index && !err && <p class="hint">Loading district list…</p>}
          <CheckPanel />
          {index && (
            <footer class="src">
              Source: {index.source.title} — {index.source.publisher}.
              {' '}Signed by {index.issuer}.
            </footer>
          )}
        </>
      )}

      {vote && (
        <>
          <button class="back" onClick={() => { setVote(null); setCards(null); }}>← all districts</button>
          <h2 class="district">{vote.name}</h2>
          {cards
            ? <p class="hint">{stats.verified} budget lines verified on this device{stats.rejected ? `, ${stats.rejected} rejected` : ''} · FY{index?.years.a} vs FY{index?.years.b}</p>
            : <p class="hint">Checking signatures…</p>}
          {topicsPresent.length > 1 && (
            <nav class="filters" aria-label="Filter by sector">
              <button class={topic === 'all' ? 'sel' : ''} onClick={() => setTopic('all')}>all</button>
              {topicsPresent.map(t => <button key={t} class={topic === t ? 'sel' : ''} onClick={() => setTopic(t)}>{t}</button>)}
            </nav>
          )}
          {pending > 0 && <p class="queued">{pending} report{pending > 1 ? 's' : ''} waiting to send — they will go automatically when you are back online.</p>}
          {shown.map((c, i) => <CardView key={c.ok ? c.card.id : i} c={c} counts={(c.ok && counts[c.card.id]) || {}} onReport={report} />)}
        </>
      )}
    </div>
  );
}
