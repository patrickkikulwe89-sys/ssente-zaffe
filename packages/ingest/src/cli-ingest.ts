import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { hexToBytes } from '@noble/hashes/utils';
import { PDFParse } from 'pdf-parse';
import { parseLgEstimates } from './lg-estimates.ts';
import { reconcile } from './reconcile.ts';
import { toCard } from './cards.ts';
import { signCard, signBundle } from '../../core/src/sign.ts';
import type { Card } from '../../core/src/card.ts';

const OUT = process.env.BUNDLE_DIR ?? 'apps/reader/public/bundles';
const CACHE = '.cache';
const now = new Date().toISOString();

type SourceRec = { docId: string; title: string; publisher: string; url: string; cache: string; bytes: number; sha256: string; retrieved: string };

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

// Newest document wins: it carries the current draft plus the previous approved year.
const chosen = sources[0]!;
console.log(`source  ${chosen.docId}`);
const txtPath = await ensureCached(chosen);
console.log(`  verified sha256 ${chosen.sha256.slice(0, 16)}…`);

const parsed = parseLgEstimates(fs.readFileSync(txtPath, 'utf8'));
console.log(`parsed  ${parsed.pageCount} pages · FY${parsed.years.a} (${parsed.years.aKind}) vs FY${parsed.years.b} (${parsed.years.bKind}) · ${parsed.items.length} line items`);

const { groups, summary } = reconcile(parsed.items, parsed.grantTotals);
const quarantined = groups.filter(g => g.status === 'quarantined');
console.log(`audit   exact ${summary.exact ?? 0} · within-rounding ${summary.rounding ?? 0} · QUARANTINED ${quarantined.length}`);
for (const q of quarantined.slice(0, 10)) console.log(`  ! ${q.key}  sum ${q.sumA}/${q.sumB} vs stated ${q.statedA}/${q.statedB}`);
if (quarantined.length) fs.writeFileSync('content/cards/quarantine.json', JSON.stringify(quarantined, null, 2));

const publishable = groups.filter(g => g.status !== 'quarantined').flatMap(g => g.items);
const source: Card['source'] = {
  docId: chosen.docId, title: chosen.title, publisher: chosen.publisher,
  page: 1, table: 'V4', sha256: chosen.sha256, retrieved: chosen.retrieved,
};

// One bundle per vote: a citizen downloads their own district, not the whole country.
const byVote = new Map<string, Card[]>();
for (const it of publishable) {
  const card = toCard(it, parsed.years, source, now);
  (byVote.get(it.vote) ?? byVote.set(it.vote, []).get(it.vote)!).push(card);
}

fs.mkdirSync(OUT, { recursive: true });
const index: { vote: string; name: string; level: string; cards: number; bytes: number }[] = [];
for (const [vote, cards] of [...byVote].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const signedCards = cards.map(c => signCard(c, secretKey));
  const manifest = signBundle({ bundleId: `${chosen.docId}/${vote}`, issuer: secret.issuer, created: now }, cards, secretKey);
  const body = JSON.stringify({ v: 1, manifest, cards: signedCards });
  const file = path.join(OUT, `${vote}.json`);
  fs.writeFileSync(file, body);
  index.push({ vote, name: cards[0]!.scope.voteName, level: cards[0]!.scope.level, cards: cards.length, bytes: Buffer.byteLength(body) });
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({
  v: 1, issuer: secret.issuer, keyId: secret.keyId, created: now,
  source: { docId: chosen.docId, title: chosen.title, publisher: chosen.publisher, url: chosen.url, sha256: chosen.sha256 },
  years: parsed.years, votes: index,
}, null, 1));

const total = index.reduce((s, v) => s + v.bytes, 0);
const sizes = index.map(v => v.bytes).sort((a, b) => a - b);
console.log(`signed  ${index.reduce((s, v) => s + v.cards, 0)} cards into ${index.length} per-vote bundles`);
console.log(`size    total ${(total / 1e6).toFixed(2)} MB · median bundle ${(sizes[Math.floor(sizes.length / 2)]! / 1024).toFixed(1)} KB · largest ${(sizes.at(-1)! / 1024).toFixed(1)} KB`);
console.log(`out     ${OUT}/`);
