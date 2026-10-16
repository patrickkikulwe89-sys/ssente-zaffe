import fs from 'node:fs';
import path from 'node:path';

/**
 * The translation layer — the only place in this project where a language model contributes
 * anything, and it is confined to sentence *shapes*.
 *
 * A claim is rendered from a template holding named slots, never by translating a finished
 * sentence. The rule that makes this safe is mechanical rather than a matter of trust:
 *
 *   **a template may not contain a single digit.**
 *
 * Validated at load, that guarantees every digit in a published claim was substituted from
 * the parsed document. A translation can be clumsy or wrong about wording; it cannot move an
 * amount, change a fiscal year or invent a percentage, because it never holds one.
 *
 * Translations live in `content/i18n/<lang>.json`, are reviewed by a person, and carry a
 * `reviewed` flag. Git history is the review trail, exactly as it is for the card data.
 */

export type Lang = 'en' | 'lg';
export const LANGS: Lang[] = ['en', 'lg'];

export type Catalogue = {
  lang: Lang;
  name: string;
  reviewed: boolean;
  note?: string;
  claims: Record<string, string>;
  words: Record<string, string>;
  topics: Record<string, string>;
};

/** Every slot a claim template may use. Anything else is a typo and fails the load. */
export const SLOTS = ['place', 'org', 'item', 'programme', 'amountA', 'amountB', 'fyA', 'fyB', 'pct', 'draft'] as const;
export type Slot = typeof SLOTS[number];

const DIGIT = /[0-9]/;

/**
 * Figures written out as words.
 *
 * The digit rule is necessary but not sufficient. A reviewer translating
 * "goes down 4%, from UGX 2,978,149,000" naturally reaches for "ekendedde ebituundu bina ...
 * buwumbi bubiri n'obukadde lwenda nsaanvu mu munaana" — correct Luganda, no digits, and
 * fatal: the template renders every decreased budget line in the country, so that one card's
 * figure would be asserted on all of them. Spoken numerals have to be generated from the
 * parsed amount, never typed into a template, so a template containing a quantity word is
 * refused and the message explains why.
 */
const NUMERAL_WORDS = new RegExp(
  '\\b(' + [
    'obuwumbi', 'buwumbi', 'obukadde', 'bukadde', 'emitwalo', 'mitwalo', 'enkumi', 'nkumi',
    'kikumi', 'kinaana', 'lukaaga', 'lwenda', 'lunaana', 'nkaaga', 'nsaanvu', 'nsanvu',
    'kyenda', 'keenda', 'kakaaga', 'kasanvu', 'kanaana',
    'emu', 'bbiri', 'ssatu', 'satu', 'nnya', 'ttaano', 'taano', 'mukaaga', 'musanvu',
    'munaana', 'mwenda', 'kkumi', 'abiri', 'asatu', 'ana', 'ataano', 'ataani',
    'bibiri', 'bisatu', 'bina', 'bitaano', 'bubiri', 'busatu', 'buna', 'butaano',
    'ebitundu', 'ebituundu', 'ekitundu', 'ekituundu',
  ].join('|') + ')\\b', 'i');
const PLACEHOLDER = /\{([a-zA-Z]+)\}/g;

export function validateCatalogue(c: Catalogue, reference?: Catalogue): string[] {
  const problems: string[] = [];
  for (const [key, tpl] of Object.entries(c.claims)) {
    // The guard. A digit here could reach a citizen as a figure nobody parsed.
    if (DIGIT.test(tpl)) problems.push(`${c.lang}/${key}: contains a digit; figures must come from slots only`);
    const word = tpl.match(NUMERAL_WORDS);
    if (word) problems.push(
      `${c.lang}/${key}: contains the quantity word "${word[0]}". A template renders thousands of ` +
      `different cards, so a figure spelled out in words would be correct on one of them and wrong ` +
      `on the rest. Leave the slot to carry the number.`);
    for (const m of tpl.matchAll(PLACEHOLDER))
      if (!SLOTS.includes(m[1] as Slot)) problems.push(`${c.lang}/${key}: unknown slot {${m[1]}}`);
  }
  for (const [key, word] of Object.entries(c.words))
    if (DIGIT.test(word)) problems.push(`${c.lang}/words.${key}: contains a digit`);
  if (reference) {
    for (const key of Object.keys(reference.claims))
      if (!c.claims[key]) problems.push(`${c.lang}: missing template ${key}`);
    for (const key of Object.keys(c.claims))
      if (!reference.claims[key]) problems.push(`${c.lang}: template ${key} has no English counterpart`);
    // Slot parity: a translation that drops a slot silently drops a figure from the sentence.
    for (const [key, tpl] of Object.entries(c.claims)) {
      const ref = reference.claims[key];
      if (!ref) continue;
      const of = (s: string) => new Set([...s.matchAll(PLACEHOLDER)].map(m => m[1]));
      const mine = of(tpl), theirs = of(ref);
      for (const s of theirs) if (!mine.has(s)) problems.push(`${c.lang}/${key}: slot {${s}} is missing, so that figure would never be shown`);
      for (const s of mine) if (!theirs.has(s)) problems.push(`${c.lang}/${key}: slot {${s}} is not in the English template`);
    }
  }
  return problems;
}

export function loadCatalogues(dir = 'content/i18n'): Map<Lang, Catalogue> {
  const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8')) as Catalogue;
  const out = new Map<Lang, Catalogue>();
  const problems = validateCatalogue(en);
  for (const lang of LANGS) {
    if (lang === 'en') { out.set('en', en); continue; }
    const file = path.join(dir, `${lang}.json`);
    if (!fs.existsSync(file)) continue;
    const c = JSON.parse(fs.readFileSync(file, 'utf8')) as Catalogue;
    problems.push(...validateCatalogue(c, en));
    out.set(lang, c);
  }
  if (problems.length) throw new Error(`translation catalogues rejected:\n  ${problems.join('\n  ')}`);
  return out;
}

/** Substitute slots into a template. Unknown or missing slots are a programming error. */
export function render(c: Catalogue, key: string, slots: Partial<Record<Slot, string>>): string {
  const tpl = c.claims[key];
  if (!tpl) throw new Error(`${c.lang}: no template ${key}`);
  const out = tpl.replace(PLACEHOLDER, (_, name: string) => {
    const v = slots[name as Slot];
    if (v === undefined) throw new Error(`${c.lang}/${key}: no value supplied for {${name}}`);
    return v;
  });
  return out.replace(/\s{2,}/g, ' ').trim();
}
