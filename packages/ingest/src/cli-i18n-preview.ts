import fs from 'node:fs';
import path from 'node:path';

/**
 * Show real cards side by side in every published language, one example of each sentence.
 *
 *   npm run i18n:preview -- [vote] [lang]      e.g. 122 lg  (Kampala, Luganda)
 *
 * Reads the bundles `npm run ingest` wrote, so what you see is exactly what will be signed and
 * served. After changing a template, re-run ingest and then this.
 */
const OUT = process.env.BUNDLE_DIR ?? 'apps/reader/public/bundles';
const [vote = '122', lang = 'lg'] = process.argv.slice(2);

type Card = { claim: string; unit: string; item: string; scope: { level: string }; amounts: { ugx: number }[] };
type Bundle = { cards: { card: Card }[] };
const read = (file: string): Bundle => {
  if (!fs.existsSync(file)) { console.error(`no bundle at ${file} — run \`npm run ingest\` first`); process.exit(1); }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
const en = read(path.join(OUT, `${vote}.json`)).cards.map(c => c.card);
const other = read(path.join(OUT, lang, `${vote}.json`)).cards.map(c => c.card);

// Both bundles are written from the same rows in the same order; check rather than assume.
if (en.length !== other.length || en.some((c, i) => c.unit !== other[i]!.unit || c.item !== other[i]!.item)) {
  console.error(`${lang}/${vote}.json does not line up with ${vote}.json — re-run \`npm run ingest\``);
  process.exit(1);
}

// One example per sentence shape, classified the way cards.ts picks a template.
const shapeOf = (c: Card) => {
  const [a, b] = c.amounts.map(x => x.ugx) as [number, number];
  const move = a > 0 && b === 0 ? 'cut' : a === 0 && b > 0 ? 'new' : a === b ? 'flat' : b > a ? 'up' : 'down';
  if (c.scope.level !== 'central') return `local.${move}`;
  if (/\b(Division|City|Municipality|District|Region)\b/.test(c.item)) return `place.${move}`;
  return a === b ? 'org.flat' : a === 0 ? 'org.new' : 'org.changed';
};
const seen = new Set<string>();
for (let i = 0; i < en.length; i++) {
  const shape = shapeOf(en[i]!);
  if (seen.has(shape)) continue;
  seen.add(shape);
  console.log(`[${shape}]\nEN  ${en[i]!.claim}\n${lang.toUpperCase()}  ${other[i]!.claim}\n`);
}
console.log(`${en.length} cards in vote ${vote}; ${seen.size} sentence shapes shown.`);
