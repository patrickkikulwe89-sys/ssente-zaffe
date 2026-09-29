# Ssente Zaffe — *our money*

District budget accountability for Uganda, built so that **trust lives in the content, not in the connection**.

Every figure a citizen sees is a **signed card**: a small, self-contained claim carrying the
amount, the document it came from, the page number, and an Ed25519 signature. A card can
arrive over any channel — a web app, a WhatsApp forward, a file copied between phones, an
SMS — and still be verified **offline**, with no server and no trust in whoever passed it along.

You do not have to trust the courier. You verify the letter.

---

## Why this shape

Civic information in Uganda fails in ways a normal web app ignores. Connections drop.
Bandwidth is metered. Platforms get blocked at the ISP. Many people are on feature phones.
So the design target is not "a site that loads" but "a fact that survives the trip".

Three consequences run through the whole codebase:

1. **No language model touches a money figure.** Amounts come from a deterministic parser
   that is audited against the source document's own stated totals. A model may later phrase
   or translate a sentence; it can never move a number.
2. **Arithmetic gates publication.** Every grant group is re-added and compared to the total
   the government document states for it. A group that does not balance is *quarantined* and
   its cards are never signed. Parsing bugs cannot reach a citizen dressed as a fact.
3. **One bundle per district.** You download your own district (~12 KB gzipped), not the country.

## Data

Source: **Ministry of Finance, Planning and Economic Development** — *Draft Estimates of
Revenue and Expenditure, Volume II: Local Government Votes*, FY2025/26 and FY2026/27.
Registered with URL and SHA-256 in [`content/sources/sources.json`](content/sources/sources.json);
ingest refuses to run if a document's hash does not match.

Current run, FY2026/27 (1,476 pages):

| | |
|---|---|
| Local government votes | **176** — 10 cities, 31 municipal councils, 135 districts |
| Line items extracted | **9,617** |
| Grant groups audited | 4,152 |
| Reconciliation | **100.00%** (3,272 exact, 880 within the document's own thousand-shilling rounding) |
| Quarantined | **0** |
| Signed cards | 9,617 across 176 bundles |
| Median bundle | 74.6 KB raw, **12 KB gzipped** |

The same parser reconciles the FY2025/26 document at 100.00% without modification.

Finest available granularity is **vote → department or project → grant → named service area**.
Parish-level line items are *not* published in these documents — only parish aggregates — so
this project makes district-level claims and does not imply parish figures it cannot cite.

## Quick start

```bash
npm install
npm run keygen            # one Ed25519 issuer key; the secret stays on your machine
npm run ingest            # fetch + hash-verify + parse + audit + sign  (~40s)
npm run verify apps/reader/public/bundles/840.json
npm test
npm run dev               # the offline reader, http://localhost:5173
npm run build             # static site in apps/reader/dist/
```

`npm run verify` does what the offline reader does — checks every signature, checks the
manifest for withheld or inserted cards, then deliberately alters one figure and shows it
being rejected.

## Layout

```
content/sources/    document registry: url, bytes, sha256, retrieval date
content/cards/      quarantine.json, written only when a group fails to reconcile
keys/               trusted.json (committed) · issuer.secret.json (never committed)
packages/core/      card schema, canonical JSON, Ed25519 sign/verify, CLIs
packages/ingest/    the MoFPED Volume II parser, reconciliation gate, card generation
apps/reader/        offline-first reader PWA (Preact + Vite, service worker)
```

## Design notes

**Canonical JSON.** Signatures are only meaningful if two machines serialise a card to the
same bytes, so `canonicalize()` sorts keys recursively, emits no incidental whitespace, and
refuses fractional money. Transport may reorder keys freely; verification survives it.

**Derived ids.** A card's id is a hash of `(vote, unit, item, fiscal year, language)`, so
re-ingesting the same document is idempotent and links to a card do not break on refresh.

**Per-card *and* manifest signatures.** Per-card signatures let a single forwarded card stand
alone. The bundle manifest lists card hashes, which is the only way a reader can detect cards
*withheld* from a bundle rather than merely altered.

**No blockchain.** Signatures already provide integrity and provenance. A chain would add
bandwidth cost and no property this project needs.

## The reader

A static, serverless PWA. It compiles the trust list in, fetches a district bundle, and
**verifies every signature on the device** before anything is shown as fact. A card that
fails is rendered as a refusal, not as information.

| | |
|---|---|
| App payload | 104 KB raw, **33 KB gzipped** JS · 1.5 KB CSS |
| Precached on first visit | shell + the 21 KB district index only |
| District bundles | fetched on demand, ~12 KB gzipped, cached for offline reuse |
| Runtime | Preact, chosen over React purely to keep the payload small |

It has no accounts, no analytics and no backend. *Share this card* exports a single signed
card; **Check a card** verifies one that arrived by any route — WhatsApp forward, SMS, a file
copied between phones — with the network switched off.

## Status

Done: source registry with hash verification · deterministic parser (both fiscal years at
100% reconciliation) · reconciliation gate · card schema · Ed25519 per-card and manifest
signing · offline verifier CLI · 9 tamper tests · 176 signed bundles · offline reader PWA
with on-device verification, provenance view, card sharing and card checking.

Next: Luganda translation layer (reviewed text only, figures untouched) · anonymous
confirm/dispute reporting · feature-phone USSD simulator.
