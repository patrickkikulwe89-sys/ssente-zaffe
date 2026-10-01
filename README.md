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
npm run reports           # the anonymous reports service, http://127.0.0.1:8787
npm run ussd              # USSD gateway + simulated feature phone, http://127.0.0.1:8788
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

## Reporting back

A budget line is a promise. The loop closes when someone in the district can say whether the
money arrived — so each card carries four answers: *yes this happened · only partly · no, not
that I can see · not sure*.

**A report may only attach to a card that verifies.** The client sends the signed card, not a
bare id, so nobody can file reports against invented budget lines. **And a report stores
nothing about the person.** The entire row is:

```
card_id | vote | verdict | day        -- a UTC date, never a timestamp
```

No account, no phone number, no device id, no IP address, no user agent, and no free-text
field someone could be identified through. IP is used to rate-limit in memory and is never
written down. Reports queue locally when offline and send themselves when a connection
returns, because the people most worth hearing from have the worst connectivity.

**Reports are not facts, and the interface never lets them look like facts.** They render in
a separate dashed block labelled *unverified, not government figures*, and never carry the
✓ that a signed figure earns. That boundary is the reason the signed cards are worth anything.

The whole service is one file and one table, on `node:sqlite` — no database server, no ORM,
no dependencies. (`node:sqlite` is still flagged experimental in Node 22; a production
deployment would pin it or swap in Cloudflare D1, which the same schema fits.)

## The feature phone

The channel that needs no data bundle, no app and no smartphone. `npm run ussd` serves both a
gateway endpoint and a simulated handset — open it and dial `*384#`.

The endpoint speaks the **Africa's Talking contract**: form-encoded `sessionId`, `phoneNumber`
and `text`, answered with a body beginning `CON ` or `END `. Pointing a real shortcode at it is
a configuration change, not a rewrite. A shortcode needs a telco agreement, so it is exercised
through a simulated handset here; the protocol is the real one either way.

Three constraints shape the implementation, and each one produced a bug worth keeping in mind:

- **182 characters per screen.** A figure like `UGX 4,720,437,000` spends a tenth of the budget,
  so amounts shorten to `UGX 4.72bn`. A test crawls every reachable screen and fails if any
  one of them exceeds the limit — averages are no use here.
- **Labels must stay distinguishable.** Slicing the first 22 characters turned
  *PHC – Non Wage Recurrent (Government)*, *(PNFP)* and *(Results-based)* into three identical
  menu entries. Shortening now abbreviates known boilerplate and always preserves the
  parenthesised qualifier, because that is the only part telling them apart.
- **The gateway is stateless towards us.** It resends the whole accumulated string each step,
  so `render()` is a pure function of it — nothing to lose on restart. `9` pages forward; `0`
  is a real Back, implemented by deleting the selection it undoes.

Every card carries a six-character code, so a figure announced on radio can be dialled up and
checked: `*384#` → option 2 → `6e1316`.

**Honest limit:** a feature phone cannot check an Ed25519 signature. On this channel the
gateway verifies before rendering and the caller is trusting the gateway operator, not
mathematics. Every screen therefore names the source page so the claim can be checked against
the published PDF by anyone who can reach it. USSD reports land in the same table as web
reports, which still has nowhere to put a phone number — `phoneNumber` arrives on every
request and is deliberately never read.

## Submission

[`SUBMISSION.md`](SUBMISSION.md) is the written summary. [`docs/demo-video.md`](docs/demo-video.md)
is the shooting script for the demo video.

## Deploying

The reader is a static site with no backend, so it deploys as files. `.github/workflows/deploy.yml`
builds it on every push to `main` and publishes to GitHub Pages:

    npm ci → restore cached PDFs → prepare signing key → ingest (hash-verify, parse, audit, sign)
           → npm test → build with BASE_PATH → upload → deploy

Generated bundles are not committed. CI rebuilds them from documents whose SHA-256 is pinned in
`content/sources/sources.json`, which is stronger provenance than committing derived JSON: the
deployed figures are reproducible from the government's own files or the build fails.

**One repository setting is required**, once: *Settings → Pages → Build and deployment →
Source: **GitHub Actions***.

**One secret is strongly recommended**: `SSENTE_ISSUER_SECRET`, the 64-hex signing key from
`keys/issuer.secret.json`. Without it each build generates a fresh key, so a card someone
shared last week stops verifying — which would defeat the point of signing cards at all. With
it set, builds are reproducible and cards stay portable. The build labels itself an *ephemeral
preview* when the secret is absent, rather than pretending otherwise.

**Optional**: a repository variable `REPORTS_URL` pointing at a deployed reports service. Left
unset, the static site disables reporting and says so on each card; the budget figures still
verify offline, because verification never needed a server.

The reports service and USSD gateway are small Node processes with a SQLite file, so they need
a host that runs containers rather than static files. They are not required for the reader to
work.

## Status

Done: source registry with hash verification · deterministic parser (both fiscal years at
100% reconciliation) · reconciliation gate · card schema · Ed25519 per-card and manifest
signing · offline verifier CLI · 9 tamper tests · 176 signed bundles · offline reader PWA
with on-device verification, provenance view, card sharing and card checking · anonymous
confirm/dispute reporting with offline queue · USSD gateway and simulated feature phone ·
36 tests · typechecks clean.

Deployed: GitHub Pages workflow, subpath-safe build, reproducible from pinned source hashes.

Next: Luganda translation layer (reviewed text only, figures untouched) · hosting for the
reports service · demo video and pitch.
