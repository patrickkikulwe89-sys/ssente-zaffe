# Ssente Zaffe — written summary

**Track:** Transparency & Accountability (with Stability & Social Cohesion).
**Live:** https://patrickkikulwe89-sys.github.io/ssente-zaffe/ — open it, then switch off your data.
**Code:** this repository. **Demo script:** [`docs/demo-video.md`](docs/demo-video.md).

## The problem

Uganda publishes every district's budget. It also publishes it as 1,476 pages of PDF, in
tables of thousands of shillings, organised by vote code and grant classification. The
information is simultaneously public and unreadable — so a health worker in Kasese cannot
find out that the four-point-seven billion shillings budgeted for facility upgrades last
year is now zero, and a councillor cannot cite the page that says so.

Transparency work usually stops there: build a dashboard over the data. That fails here for
reasons that have nothing to do with design. The connection drops. Bandwidth is paid for by
the megabyte. Platforms get blocked at the ISP — Facebook has been unreachable on Ugandan
networks since 2021. And millions of people carry handsets that will never run an app, in
precisely the districts where service delivery is worst.

## The intended users

- **A citizen or local leader** who wants to know what was budgeted for their district and
  whether it changed, in language they can read, on the phone they already have.
- **A journalist or civil society researcher** who needs a figure plus a citeable page
  number, not a screenshot of a dashboard.
- **A district health or education officer** who is accountable for a line item and is
  currently defending it from memory.
- **A radio presenter** who can read out a six-character code so listeners can dial it up
  and check the figure themselves.

## How it works

The unit is a **signed card**: a single claim under 8 KB, carrying its plain-language
sentence, both fiscal years' figures, the document and page it came from, and an Ed25519
signature over all of it. A card can arrive by any route — the web app, a forwarded
message, a file copied between phones, a USSD screen — and still be verified **on the
device, offline, with no server to ask**. You do not have to trust the courier; you verify
the letter.

Three properties make that claim real rather than rhetorical:

**No language model touches a figure.** A deterministic parser reads the Ministry of
Finance estimates. No model sits in the path of an amount; at most one may later phrase a
sentence or translate it, and the signature covers whatever is published.

**Arithmetic gates publication.** The source document states a total for every grant line
and then itemises it. Every group is re-added and compared. A group that does not balance
is quarantined and never signed, so a parsing bug cannot reach a citizen dressed as a fact.
Current run across both volumes: **4,552 groups, 100.00% reconciled, 0 quarantined** — and
the previous fiscal year's local-government document reconciles at 100.00% through the same
parser, unmodified. Volume 1 adds a second, independent check, because it publishes the
funding split: government funds plus external financing must equal the total on every row.

**One bundle per vote.** You download your own district, division or ministry — about 10 KB
compressed — not the country.

The loop closes with reporting. Each card asks *did it reach you?* with four answers.
Answers queue on the phone and send themselves when a connection returns. A report may only
attach to a card that verifies, so nobody can file against an invented budget line. The
entire stored record is `card_id | vote | verdict | day` — no account, no phone number, no
device id, no IP kept, no free-text field, and a date rather than a timestamp. Reports are
unsigned observations and the interface never lets them look like verified figures.

## Real-world conditions

| Condition | How it is addressed |
|---|---|
| Trust and verification | Ed25519 per card and a bundle manifest; a tampered card is refused offline, and the refusal says why |
| Low bandwidth | 33 KB app, 12 KB per district, text-first, no webfonts; only the 21 KB index is precached |
| Offline | Full function after one visit; cards verify with no network at any time |
| Accessibility | Large type, semantic markup, screen-reader-clean, system fonts, light and dark |
| Feature phones | USSD on the real gateway protocol, 182 characters a screen, every reachable screen length-tested |
| Privacy | No accounts, no analytics, nothing identifying stored; `phoneNumber` arrives at the gateway and is never read |
| Local relevance | 328 Ugandan votes — every district, city and municipality, plus central government and Kampala's five divisions — real documents, citeable page numbers |
| Multilingual | Card schema carries a language; English shipped, Luganda next, figures never re-typed |

## What the data already shows

Produced by the pipeline, each citing its page:

- **Hoima District** — *"Preparations for AFCON Buseruka HC IV"*, nothing to **UGX 6.55bn**.
- **Masindi District** — Masindi General Hospital rehabilitation, nothing to **UGX 58bn**.
- **Kasese District** — health facility upgrades, **UGX 4.72bn to nothing**.
- **Entebbe Municipal Council** — UGX 8.4bn of road obligations to nothing, with UGX 8.0bn
  appearing as "new" for the same roads.
- **131 health line items** unchanged across two years, **UGX 266.7bn** of frozen health budget.
- **Moroto Municipal Council** — **UGX 35.5m** of non-wage primary health care for a year.
- **Kampala**, via Vote 122: UGX 489.6bn for KCCA's Engineering and Technical services, of
  which **UGX 221.3bn is donor money** — 45% of a headline road figure is external financing.

## Honest limits

- **Central government is covered more coarsely than local government.** Volume 1's
  reconcilable table is a summary, so a ministry gets about four cards where a district gets
  fifty. Its item-level table — expenditure by staff training, travel, fuel, maintenance,
  some 3,000 rows — does not reconcile against the total the document states for each vote
  (rows sum to a median 83% of it, and arrears do not explain the gap), so it is withheld
  rather than published unverified.
- **Parish figures are not published** in either volume, only parish aggregates. District
  and division is the finest grain, and we do not imply otherwise.
- **A feature phone cannot verify a signature.** On USSD the gateway verifies and the caller
  trusts the operator. Every screen names the source page so the claim stays checkable.
- **This is a proof of concept.** Figures are reconciled and citeable, but the cards are
  signed by a development key, not by an accountable publishing institution.

## Why it is worth developing further

The deliverable is not an app but a content standard with reference clients. Any district
office, NGO or radio station could publish signed cards tomorrow and reach people through
channels nobody built for them — because the trust travels inside the content.

Volume 1 is now ingested, which brought in Kampala and every ministry — UGX 77.1tn of central
government beside UGX 6.8tn of local government. The next steps are finding a sound audit
anchor for Volume 1's item-level table, Luganda, publisher keys so institutions sign their own
cards, and the quarterly performance reports on the same portal, which would put **budgeted,
released and spent** side by side — each citing its page.
