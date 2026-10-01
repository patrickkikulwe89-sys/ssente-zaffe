# Security review — OWASP Top 10 (2021)

Reviewed: the whole application, not a diff. Findings below were fixed in this repository;
accepted risks are stated rather than quietly carried.

Attack surface is small by construction. The reader is static files with no backend and no
accounts. Two small Node services exist — the reports API and the USSD gateway — and neither
is required for the reader to work.

## Fixed in this pass

| # | Finding | Risk | Fix |
|---|---|---|---|
| 1 | `reports.db` was not gitignored | A citizen-report database could be committed. Nothing had leaked — history was checked — but the next `npm run reports` would have created one at the repo root | `*.db`, `*.db-wal`, `*.db-shm` excluded |
| 2 | USSD gateway read request bodies with no ceiling | Memory exhaustion from a single endless upload | 8 KB cap, `413` answered **before** the socket is closed |
| 3 | USSD gateway had no rate limiting and wrote verdicts directly | Report flooding on an unauthenticated endpoint | Navigation limited to 600/hour, writes to 30/hour, plus an optional `USSD_ALLOW_IPS` gateway allowlist |
| 4 | `access-control-allow-origin: *` on the reports service | Any website could make its visitors file reports on real cards | `ALLOWED_ORIGINS` allowlist, `vary: origin`, and a startup warning when left open |
| 5 | No CSP or security headers on the static site | No defence in depth against injected content | Build-time `Content-Security-Policy` meta tag, `referrer: no-referrer`; `nosniff`, `no-referrer`, `no-store` on API responses |
| 6 | `keys/issuer.secret.json` written mode `644` | World-readable signing key on a shared machine | Written `0600` by both key CLIs |
| 7 | Parser joined wrapped lines with no length bound | A malformed or hostile document could feed the lazy-quantifier regex an unbounded line | 600-character ceiling alongside the six-line rule (longest genuine label: 147 characters) |

| 8 | One missing or unreadable bundle file crashed the whole USSD process | Availability. A partly synced directory, a bad mount or a deleted file took the gateway down for every caller — and anyone reaching a vote with a missing file could trigger it deliberately | The read degrades to "no information for this district"; the request handler always returns a screen; storage faults in the reports service answer `503` instead of throwing. Found by running the container against deliberately incomplete data |

Also fixed while reviewing: `npm run sign` pointed at a file that never existed, and
`packages/core` and `packages/ingest` had no manifest so were never really workspaces.

## The ten

**A01 Broken Access Control.** There is no authorisation model because there is no private
data: every figure is already published by the Ministry of Finance. What needed control was
*writes* — fixed by #3 and #4. Vote codes are checked against `^\d{3}$` before being
interpolated into a file path, even though they only ever come from the generated index.

**A02 Cryptographic Failures.** Ed25519 via `@noble/curves`; no hand-rolled primitives.
Signatures are taken over RFC-8785-style canonical JSON, so a reserialising transport cannot
invalidate a card and key reordering cannot be used to smuggle a second meaning. The signing
secret is gitignored and now mode `0600`. *Accepted:* `keyId` is SHA-256 truncated to 64
bits. It identifies a key; verification uses the full public key, so a collision alone buys
an attacker nothing.

**A03 Injection.** SQLite is reached only through prepared statements — there is no string
concatenation anywhere near a query. No shell execution. No `innerHTML`, `eval`, or
`dangerouslySetInnerHTML` in the reader or the handset page; Preact escapes text and the
simulated phone uses `textContent`. Every external input is parsed by a zod schema before
use.

**A04 Insecure Design.** The deliberate choices are the security story:
reconciliation gates publication, so a parsing error cannot become a published fact; a report
may only attach to a card that verifies, so reports cannot be filed against invented budget
lines; the reports table has four columns and nowhere to put identifying data, enforced by a
test that fails if a column like `ip` appears; a card that fails verification renders as an
explicit refusal rather than being hidden. Unknown keys injected into a card are **stripped
before** the signature is checked, so an injected payload cannot ride along on a valid
signature — locked by a test.

**A05 Security Misconfiguration.** Fixed by #4 and #5. Both services now print at startup
whether they are running open, instead of defaulting quietly to permissive. *Accepted:* a
meta-tag CSP cannot set `frame-ancestors`; host behind a proxy that sends
`Content-Security-Policy: frame-ancestors 'none'` and HSTS if you need clickjacking cover.

**A06 Vulnerable and Outdated Components.** Four runtime dependencies
(`@noble/curves`, `@noble/hashes`, `pdf-parse`, `zod`). `npm audit --omit=dev`: **0
vulnerabilities**. The lockfile is committed and CI uses `npm ci`. *Accepted:* `node:sqlite`
is flagged experimental in Node 22; a production deployment should pin Node or move the schema
to Cloudflare D1, which it fits unchanged.

**A07 Identification and Authentication Failures.** There is no authentication anywhere, by
design — no accounts, no sessions, no tokens, no password reset, so none of this class
applies. *Accepted:* with no identity there is also no per-user abuse control. Anonymous
reports cannot be deduplicated, so ballot-stuffing is possible; the signature requirement and
rate limits raise its cost without eliminating it. Aggregates should be read as signal, never
as a count of people.

**A08 Software and Data Integrity Failures.** Source documents are pinned by SHA-256 and
ingest aborts on a mismatch. Generated bundles are not committed; CI rebuilds them from the
pinned documents, so deployed figures are reproducible from the government's own files or the
build fails. Cards are signed individually *and* listed in a signed manifest, which is the
only way a reader can detect cards withheld rather than altered. Card ids are derived, so
re-ingestion is idempotent. No third-party scripts, CDNs or webfonts are loaded, so there is
no supply-chain path into the page.

**A09 Security Logging and Monitoring Failures.** The reports service logs nothing about
requests. This is a deliberate trade against A09: an audit trail of who filed what is exactly
the record this project promises not to keep. *Accepted:* abuse is therefore visible only as
anomalies in aggregate counts. If monitoring becomes necessary, count events without
identifiers.

**A10 Server-Side Request Forgery.** One outbound request exists — ingest fetching a budget
PDF — and its URL comes from a committed registry, not from user input, with the response
hash-verified before use. No endpoint accepts a URL.

## Operational notes

Before exposing either service publicly: set `ALLOWED_ORIGINS` on the reports service and
`USSD_ALLOW_IPS` on the gateway, terminate TLS in front of both, and set
`SSENTE_ISSUER_SECRET` so builds sign with a stable key.

**Per-IP limiting is wrong behind a real telco gateway**, where every USSD request arrives
from the operator's own addresses and would throttle the whole country at once. There,
allowlist the gateway and rate-limit per subscriber using a keyed hash of the MSISDN held only
in memory — never the number itself.

This is a proof of concept. Cards are signed by a development key, not by an accountable
publishing institution; that substitution is the main thing standing between this and
production.
