import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { hexToBytes } from '@noble/hashes/utils';
import { PDFParse } from 'pdf-parse';
import { parseLgEstimates } from './lg-estimates.ts';
import { parseCgEstimates } from './cg-estimates.ts';
import { reconcile } from './reconcile.ts';
import { reconcileCg } from './reconcile-cg.ts';
import { toCard, toCentralCard } from './cards.ts';
import { signCard, signBundle } from '../../core/src/sign.ts';
import type { Card } from '../../core/src/card.ts';

/**
 * Builds every bundle from the registered source documents.
 *
 * Two documents, two grammars, one gate. Volume II covers the 176 local governments (vote
 * codes 601-999); Volume 1 covers the 152 central government votes (001-538), which is the
 * only place Kampala appears — it is Vote 122, KCCA, broken down by its five divisions.
 * The code ranges are disjoint, so a bundle is still just `<vote>.json`.
 */
const OUT = process.env.BUNDLE_DIR ?? 'apps/reader/public/bundles';
const CACHE = '.cache';
const now = new Date().toISOString();

type SourceRec = {
  docId: string; title: string; publisher: string; url: string; cache: string;
  bytes: number; sha256: string; retrieved: string; volume?: 'local' | 'central';
};

async function ensureCached(s: SourceRec): Promise<string> {
  const pdf = path.join(CACHE, s.cache);
  fs.mkdirSync(CACHE, { recursive: true });
  if (!fs.existsSync(pdf)) {
    console.log(`  fetching ${s.url}`);
    const res = await fetch(s.url);
    if (!res.ok) throw new Error(`fetch failed ${res.status}`);
    fs.writeFileSync(pdf, Buffer.from(await res.arrayBuffer()));
  }
  const got = createHash('sha256').update(fs.readFileSync(pdf)).digest('hex');
  if (got !== s.sha256) throw new Error(`sha256 mismatch for ${s.cache}\n  expected ${s.sha256}\n  got      ${got}`);
  const txt = pdf.replace(/\.pdf$/, '.txt');
  if (!fs.existsSync(txt)) {
    const p = new PDFParse({ data: new Uint8Array(fs.readFileSync(pdf)) });
    fs.writeFileSync(txt, (await p.getText()).text ?? '');
    await p.destroy();
  }
  return txt;
}

const secret = JSON.parse(fs.readFileSync('keys/issuer.secret.json', 'utf8')) as { keyId: string; issuer: string; secretKey: string };
const secretKey = hexToBytes(secret.secretKey);
const { sources } = JSON.parse(fs.readFileSync('content/sources/sources.json', 'utf8')) as { sources: SourceRec[] };

const pick = (volume: 'local' | 'central') =>
  sources.filter(s => (s.volume ?? 'local') === volume).sort((a, b) => (a.docId < b.docId ? 1 : -1))[0];

const sourceOf = (s: SourceRec): Card['source'] => ({
  docId: s.docId, title: s.title, publisher: s.publisher,
  page: 1, table: 'V4', sha256: s.sha256, retrieved: s.retrieved,
});

const byVote = new Map<string, Card[]>();
const aliases = new Map<string, Set<string>>();
const quarantined: unknown[] = [];
let years: { a: string; b: string } | null = null;

// ---- Volume II: local governments -------------------------------------------------------
const lg = pick('local');
if (lg) {
  console.log(`source  ${lg.docId}`);
  const txt = await ensureCached(lg);
  console.log(`  verified sha256 ${lg.sha256.slice(0, 16)}…`);
  const parsed = parseLgEstimates(fs.readFileSync(txt, 'utf8'));
  years = { a: parsed.years.a, b: parsed.years.b };
  console.log(`  ${parsed.pageCount} pages · FY${parsed.years.a} vs FY${parsed.years.b} · ${parsed.items.length} line items`);
  const { groups, summary } = reconcile(parsed.items, parsed.grantTotals);
  const bad = groups.filter(g => g.status === 'quarantined');
  console.log(`  audit: exact ${summary.exact ?? 0} · within-rounding ${summary.rounding ?? 0} · QUARANTINED ${bad.length}`);
  quarantined.push(...bad);
  for (const it of groups.filter(g => g.status !== 'quarantined').flatMap(g => g.items)) {
    const card = toCard(it, parsed.years, sourceOf(lg), now);
    (byVote.get(it.vote) ?? byVote.set(it.vote, []).get(it.vote)!).push(card);
  }
}

// ---- Volume 1: central government, including Kampala ------------------------------------
const cg = pick('central');
if (cg) {
  console.log(`source  ${cg.docId}`);
  const txt = await ensureCached(cg);
  console.log(`  verified sha256 ${cg.sha256.slice(0, 16)}…`);
  const parsed = parseCgEstimates(fs.readFileSync(txt, 'utf8'));
  const v1 = parsed.rows.filter(r => r.table === 'V1');
  console.log(`  ${parsed.pageCount} pages · FY${parsed.years.a} vs FY${parsed.years.b} · ${parsed.votes.length} votes · ${v1.length} programme rows`);
  const { groups, summary, inconsistent } = reconcileCg(v1, parsed.programmeTotals);
  const bad = groups.filter(g => g.status === 'quarantined');
  console.log(`  audit: exact ${summary.exact ?? 0} · within-rounding ${summary.rounding ?? 0} · QUARANTINED ${bad.length} · funding identity failed ${inconsistent.length}`);
  quarantined.push(...bad, ...inconsistent);
  for (const r of groups.filter(g => g.status !== 'quarantined').flatMap(g => g.rows)) {
    const card = toCentralCard(r, parsed.years, sourceOf(cg), now);
    (byVote.get(r.vote) ?? byVote.set(r.vote, []).get(r.vote)!).push(card);
    // A division or city named inside a central vote is how people search for it — "Kawempe"
    // must find KCCA, which nothing in the vote's own name would do.
    if (/\b(Division|City|Municipality|District|Region)\b/.test(r.item))
      (aliases.get(r.vote) ?? aliases.set(r.vote, new Set()).get(r.vote)!).add(r.item);
  }
  years ??= { a: parsed.years.a, b: parsed.years.b };
}

if (quarantined.length) {
  fs.writeFileSync('content/cards/quarantine.json', JSON.stringify(quarantined, null, 2));
  console.log(`quarantine written: ${quarantined.length} entries never signed`);
}

// ---- sign, one bundle per vote ----------------------------------------------------------
fs.mkdirSync(OUT, { recursive: true });
const index: { vote: string; name: string; level: string; cards: number; bytes: number; aliases?: string[] }[] = [];
for (const [vote, cards] of [...byVote].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const signedCards = cards.map(c => signCard(c, secretKey));
  const manifest = signBundle({ bundleId: `ssente/${vote}`, issuer: secret.issuer, created: now }, cards, secretKey);
  const body = JSON.stringify({ v: 1, manifest, cards: signedCards });
  fs.writeFileSync(path.join(OUT, `${vote}.json`), body);
  const alias = [...(aliases.get(vote) ?? [])].sort();
  index.push({ vote, name: cards[0]!.scope.voteName, level: cards[0]!.scope.level, cards: cards.length, bytes: Buffer.byteLength(body), ...(alias.length ? { aliases: alias } : {}) });
}
const keyStatusPath = 'keys/key-status.json';
const keyStatus = fs.existsSync(keyStatusPath)
  ? JSON.parse(fs.readFileSync(keyStatusPath, 'utf8')) as { stable: boolean; reason: string | null }
  : { stable: true, reason: null };
if (keyStatus.reason) console.log(`note    signing key was not the configured one: ${keyStatus.reason}`);

fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({
  v: 1, issuer: secret.issuer, keyId: secret.keyId, created: now, keyStatus,
  sources: sources.map(s => ({ docId: s.docId, title: s.title, publisher: s.publisher, url: s.url, sha256: s.sha256, volume: s.volume ?? 'local' })),
  years, votes: index,
}, null, 1));

const total = index.reduce((s, v) => s + v.bytes, 0);
const sizes = index.map(v => v.bytes).sort((a, b) => a - b);
const byLevel = index.reduce<Record<string, number>>((a, v) => ({ ...a, [v.level]: (a[v.level] ?? 0) + 1 }), {});
console.log(`signed  ${index.reduce((s, v) => s + v.cards, 0)} cards into ${index.length} bundles  ${JSON.stringify(byLevel)}`);
console.log(`size    total ${(total / 1e6).toFixed(2)} MB · median ${(sizes[Math.floor(sizes.length / 2)]! / 1024).toFixed(1)} KB · largest ${(sizes.at(-1)! / 1024).toFixed(1)} KB`);
console.log(`out     ${OUT}/`);
