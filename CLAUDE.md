# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ssente Zaffe turns Uganda's Ministry of Finance local-government budget estimates into
small, individually signed "cards" that verify **offline, on the device, with no server**.
The product claim is a cryptographic property, not a feature list, so most of the rules
below exist to stop that property being quietly broken.

## Commands

```bash
npm install
npm run keygen            # create keys/issuer.secret.json + keys/trusted.json (refuses to overwrite)
npm run ingest            # fetch + hash-verify PDFs -> parse -> audit -> sign -> per-vote bundles (~40s)
npm run verify <bundle>   # verify a bundle exactly as the reader does, then tamper one card and show refusal
npm test                  # all tests
npm run dev               # reader on :5173
npm run build             # static site into apps/reader/dist/
npm run reports           # anonymous reports service on :8787
npm run ussd              # USSD gateway + simulated feature phone on :8788
npx tsc --noEmit -p tsconfig.json   # typecheck (there is no lint step)
```

Run one test file, or one test by name:

```bash
node --import tsx --test packages/ussd/test/menu.test.ts
node --import tsx --test --test-name-pattern "tampered" packages/core/test/tamper.test.ts
```

`npm run ingest` must run before `npm run dev`, `build`, `verify` or `ussd` — bundles are
generated and deliberately not committed. `node:sqlite` prints an experimental warning on
every run; it is expected.

## Architecture

Four workspace packages plus one app. The dependency direction is one-way: everything
depends on `core`, `core` depends on nothing in the repo.

- **`packages/core`** — the card schema (zod), canonical JSON, Ed25519 sign/verify, and CLIs.
  `canonicalize()` is the linchpin: signatures only mean anything if two machines serialise a
  card to identical bytes, so it sorts keys recursively, emits no incidental whitespace, and
  throws on fractional numbers. Money is whole UGX integers everywhere.
- **`packages/ingest`** — `lg-estimates.ts` parses the MoFPED "Volume II: Local Government
  Votes" PDF text; `reconcile.ts` is the publication gate; `cards.ts` renders claim sentences
  from templates; `cli-ingest.ts` wires it together and writes one signed bundle per vote.
- **`packages/reports`** — one HTTP file and one SQLite table for anonymous citizen verdicts.
- **`packages/ussd`** — `menu.ts` is a **pure function** of the gateway's accumulated input
  string; `server.ts` speaks the Africa's Talking contract and serves a simulated handset
  from `phone.ts`.
- **`apps/reader`** — Preact + Vite PWA. The trust list is compiled in at build time via a
  Vite `define`, because verification must work with no network.

Data flow: pinned PDF → deterministic parse → reconciliation gate → per-card Ed25519
signature + bundle manifest → static JSON → verified in the browser or at the USSD gateway.

## Invariants — breaking these breaks the product

1. **No language model may produce or alter a figure.** Amounts come only from the parser.
   A model may phrase or translate `claim`, and the signature covers the published text.
   `provenance.aiAssisted` may contain `wording` or `translation` — never figures.
2. **Reconciliation gates publication.** Every grant group is re-added and compared against
   the total the source document states for it. Tolerance is the document's own rounding:
   `group.length * 1000` UGX. A group that does not balance is quarantined and never signed.
   `verifyCard` also refuses a card whose `provenance.reconciled` is false, even when the
   signature is valid.
3. **Cards are signed individually *and* listed in a bundle manifest.** Per-card signatures
   let one forwarded card stand alone; the manifest is the only way a reader can detect cards
   *withheld* from a bundle rather than altered. Keep both.
4. **Card ids are derived**, from `(voteCode, unit, item, fy, lang)`. Re-ingesting the same
   document must stay idempotent and must not orphan links to a card.
5. **The reports table stores nothing identifying.** Its four columns are `card_id`, `vote`,
   `verdict`, `day` — a date, never a timestamp. A test asserts the schema and fails if a
   column like `ip` or `note` appears. `phoneNumber` arrives on every USSD request and must
   stay unread.
6. **Unsigned citizen reports must never render like verified figures.** They live in a
   separate dashed block labelled *unverified*, with no ✓.
7. **A card that fails verification renders as a refusal, not as information** — and the
   refusal says why. Do not silently hide it.
8. **Source text is preserved verbatim**, typos included (e.g. `"cf Ground Floor"` is in the
   government document). Cite, do not quietly edit.
9. **The signing secret never enters the repo.** `keys/*.secret.json` is gitignored;
   `keys/trusted.json` holds only public keys and is committed.

## The source document's grammar, and defects already fixed

Each of these cost real accuracy and is covered by a test. Do not reintroduce them.

- **A department coded `M`**, not three digits (`Department M MultiDepartment`). A `\d{3}`
  pattern silently reattributed a multi-billion-shilling row to the previous department.
- **`Total Recurrent Budget Estimates` rows look exactly like item rows.** Skip any label
  starting `Total`, not just `Total For Department|Project`.
- **Labels wrap over as many as six printed lines.** An early 160-character cap dropped rows
  — and the longest labels are the *named petition items* ("…Road bridges … washed away … in
  Kinkizi East"), which are the most locally useful content in the document. Cap by line
  count, never by characters.
- **Table V4 has two halves**: `Department NNN` on the recurrent side and `Project NNNN` on
  the development side. Handling only departments attributed every development project to the
  last recurrent department.
- **Fiscal years are detected from the document header**, never hardcoded — that is why the
  FY2025/26 file parses unmodified.
- **Tables V1–V3 also contain six-digit grant codes.** Only parse inside the V4 region, or
  the audit reconciles against polluted totals.
- **USSD: slicing a label to 22 characters made menu entries identical.** `PHC NonWage
  (Government)`, `(PNFP)` and `(Results-based)` all became `Primary Health Care - `.
  `label()` abbreviates boilerplate and always preserves the parenthesised qualifier.
- **USSD: `9. More` and `0. Back` were printed but unwired.** Paging is greedy-fit (pack what
  fits; a fixed six overflowed and lost the last option to truncation), and `0` is a real
  Back implemented by `collapseBacks()` deleting the selection it undoes — which keeps
  `render()` pure over the accumulated input.
- **USSD screens are hard-limited to 182 characters.** A test crawls every reachable screen
  and fails if any one exceeds it; averages are useless here.

## Deployment

`.github/workflows/deploy.yml` publishes `apps/reader` to GitHub Pages on every push to
`main`. `actions/configure-pages` with `enablement: true` creates the Pages site, and
`BASE_PATH` comes from its `base_path` output rather than the repository name.

Set the repository secret `SSENTE_ISSUER_SECRET` (64 hex characters) so builds sign with a
stable key; without it `cli-key-from-env.ts` generates an ephemeral key and labels the build
an *ephemeral preview*, which is correct behaviour — a fresh key per deploy would stop
previously shared cards verifying. The optional repository variable `REPORTS_URL` points the
reader at a reports service; left unset, the reader disables reporting and says so.

## Security posture

[`docs/security.md`](docs/security.md) holds the OWASP review. When changing the services,
keep these in place:

- `ALLOWED_ORIGINS` (reports) and `USSD_ALLOW_IPS` (gateway) allowlists; both print at startup
  when running open, and that warning should not be removed.
- Request-body ceilings via `readBody` — answer `413` **before** `req.destroy()`, or the client
  sees a connection reset instead of a status.
- Rate limits keyed in memory only. Per-IP is wrong behind a real telco gateway; see the
  operational note in the security doc.
- The reader's CSP is generated at build time in `apps/reader/vite.config.ts`. The app has no
  inline scripts or inline styles — keep it that way rather than adding `'unsafe-inline'`.
- Secrets are written mode `0600`.
- Tests that must keep failing loudly: the reports schema test (no identifying columns), the
  injected-key test (unknown keys stripped before verification), and the USSD screen crawl.

Test isolation note: a test that deliberately exhausts a rate limiter must create its own
server, or every later test against the shared one gets `429`.

## Known limits — do not claim otherwise

- **Kampala is absent.** KCCA is Vote 122, a *central government* vote in Volume I; Volume II
  covers vote codes 601–999 only. Greater Kampala outside KCCA (Wakiso, Nansana, Kira,
  Makindye-Ssabagabo, Entebbe, Mukono) is covered. Ingesting Volume I is the clearest next
  step and needs a second parser behind the same gate.
- **Parish-level figures are not published** in this volume, only parish aggregates.
- **A feature phone cannot verify a signature.** On USSD the gateway verifies and the caller
  trusts the operator; every screen names the source page so the claim stays checkable.
