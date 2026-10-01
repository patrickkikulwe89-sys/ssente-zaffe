# Demo video — shooting script

**Target: 2:50–3:00.** Three things must land, in this order of importance:

1. It keeps working with the network off.
2. A tampered figure is rejected, on the device, with no server.
3. It reaches a feature phone.

Everything else is context. If you run long, cut the context, never those three.

## Before you record

Open these and leave them open:

| Tab / device | What |
|---|---|
| Browser tab 1 | https://patrickkikulwe89-sys.github.io/ssente-zaffe/ |
| Browser tab 2 | The Ministry of Finance PDF, scrolled to **page 842** (Kasese) |
| Browser tab 3 | http://127.0.0.1:8788/ — the feature phone (`npm run ussd`) |
| Phone (optional) | The live site added to the home screen |

Record at 1080p. Screen recording is fine throughout; a phone clip for the
airplane-mode beat is stronger if you can get it. Speak slowly — the figures need a
second to read.

---

## 0:00–0:18 · The problem

> *"In Uganda, every district's budget is published. It is also 1,476 pages of PDF.
> So the information is public and unreadable at the same time — and that is before
> you account for the network dropping, data costing money, and millions of people
> on phones that will never run an app."*

**On screen:** tab 2, the raw PDF. Scroll fast through dense tables. Let it look as
unusable as it is.

## 0:18–0:42 · Find your district

> *"Ssente Zaffe turns those pages into something you can actually ask a question of.
> Type your district."*

**On screen:** tab 1. Type `kasese`. Open **Kasese District**. Let the card list land.

> *"Sixty-four budget lines for Kasese. Every one signed, and every signature checked
> on this device before anything is shown as a fact."*

## 0:42–1:12 · A real finding, and its receipt

**On screen:** filter to **health**. Open the facility-upgrades card.

> *"Kasese had four-point-seven billion shillings budgeted for health facility
> upgrades. The new draft budget allocates nothing."*

Click **Where this came from**.

> *"And here is the receipt — the document, the publisher, and page 842."*

**Cut to tab 2**, already on page 842. Point at the line.

> *"Page 842. The same number. Nobody has to take my word for it."*

## 1:12–1:42 · Turn the network off

**On screen:** turn on airplane mode — phone if you have it, otherwise DevTools →
Network → Offline, shown clearly.

> *"Now watch. Network off."*

Reload. Navigate to another district already visited. Open a card.

> *"Still here. Still verifying. There is no server in this picture — verification is
> mathematics, and mathematics does not need a connection."*

**Say the number:** *"Your whole district is twelve kilobytes."*

## 1:42–2:14 · Break a card on camera

Still offline. On any card, click **Share this card**. Scroll to **Check a card**,
paste, and press **Check it**.

> *"This is a card someone forwarded to me. It checks out — genuine, signed."*

Now edit **one digit** of the amount in the pasted text. Press **Check it** again.

> *"I'll change one digit. One."*

**On screen:** `✗ Do not trust this. signature does not match card contents`

> *"Rejected. Offline. That is the whole idea — you do not have to trust whoever
> passed you the figure. You verify the figure."*

## 2:14–2:40 · The feature phone

**Cut to tab 3.** Press **DIAL \*384#**.

> *"And none of this needs a smartphone."*

Press `1` → type `kasese` → `2` → `1` → `1`.

> *"Same data, same district, on a handset with no app and no data bundle. A hundred
> and eighty-two characters a screen, over the real USSD protocol."*

Let the "Did it reach you?" prompt show. Press `3`.

> *"And it asks the only question that matters — did the money reach you? No name, no
> phone number stored. Just the answer."*

## 2:40–2:58 · Close

> *"Three channels, one kind of proof. Any district office, NGO or radio station could
> publish signed cards tomorrow and reach people through channels they never built
> for. That is why this is infrastructure, not an app."*

**On screen:** tab 1, the district list.

---

## Notes

- **Do not** claim parish-level data, or that Kampala is covered. Kampala is KCCA,
  Vote 122, a central government vote — it is genuinely not in this document, and a
  judge who knows Ugandan budgets will know that.
- **Do not** say the figures are AI-generated. They are not: a deterministic parser
  produces them and they are reconciled against the document's own totals. If you
  mention AI at all, say it wrote code and may later translate text, never figures.
- If the live site shows *"Reporting is not available on this build"*, that is
  expected on static hosting — demonstrate reporting on the feature phone instead,
  or run `npm run reports` and rebuild with `VITE_REPORTS_URL` set.
