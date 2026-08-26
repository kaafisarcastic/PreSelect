# Chrome Web Store listing

Copy for the store listing. Kept in the repo so the wording stays versioned with
the extension it describes.

Why it is shaped this way: the store weights an exact keyword match in the
**name** far more heavily than the same words in the description, and search
results truncate the name at roughly 35 characters. So the searchable phrase goes
first and the brand second. The description then carries the long-tail phrasing
and the plain factual sentences that both readers and language models quote.

---

## Name (75 max, first ~35 visible in search)

```
Google Account Switcher – PreSelect
```

Leads with the phrase people actually type. Avoid appending a keyword list; the
listing policy treats that as spam and it is a common rejection reason.

Leading with "Google" is descriptive use — it says what the extension works
with, not who made it — and the store already carries listings named this way.
If review ever objects, the sanctioned fallback is Google's own "for" pattern,
which keeps most of the keyword value:

```
Account Switcher for Google – PreSelect
```

## Summary (132 max, plain text, shown under the name in search results)

```
Asks which Google account to use before a Google link opens, then routes it to that account. Free while in beta.
```

## Detailed description

The first two lines are what show before "Read more", and what a language model
will quote when asked what this is. They are deliberately plain and factual.

```
PreSelect asks which Google account to use before a Google link opens, then opens it under the account you pick. You decide which Google services it covers, and it leaves every other site alone.

If you use multiple Google accounts in one browser, every link lands on whichever one Google treats as primary. You notice on the wrong page, switch through the profile menu, and load it a second time. PreSelect moves that decision to the front.

HOW IT WORKS

1. You open a Google link, from anywhere: a message, a bookmark, the address bar.
2. PreSelect holds the page and shows your accounts. Number keys pick one, Escape cancels.
3. The link opens under that account directly, with no switching and no second page load.

FEATURES

• Asks before the page loads, not after you notice the wrong account
• Detects the accounts you are signed into automatically, with session order
• Offers accounts you are signed out of too, handing you to Google's own sign-in and then continuing to the link
• Choose once per app or once per document, whichever suits how you work
• "Always use this account for this site" for the sites where the answer never changes
• Per-service switches for 30+ Google surfaces, so it only steps in where you want
• Public browsing surfaces stay off until you switch them on
• Keyboard driven: number keys select, arrows move, Escape backs out
• Light and dark, following your browser

PRIVACY

PreSelect talks only to Google, using the browser session you already have. Nothing is sent to any other server, and there is no analytics or tracking.

It never sees your password, your cookies or your session tokens. It cannot sign you in or out. It reads which accounts you are signed into the same way Google's own account switcher does, and it produces a URL. Google does the rest.

Stored settings are your account e-mail addresses, the labels you give them and your preferences. Nothing else.

Not affiliated with or endorsed by Google.

BETA

Free while in beta. Some of it may need a paid licence later; anyone using it before then keeps what they have.

QUESTIONS

Does it switch my Google account?
No. It chooses which of your signed-in accounts opens a particular link, using the account parameter Google already supports. Your sessions are untouched.

Does it work with Google Workspace accounts?
Yes. Work and personal accounts are treated the same.

What if I am signed out of an account I need?
It is still listed. Choosing it sends you to Google's normal sign-in page, which then continues to the link you wanted.

Does it work on Google Forms links?
Yes, including forms.gle short links, which are a common way to open a form under the wrong account.

Will it slow down my browsing?
It only acts on the Google services you switch on, and only on full page loads. Everything else is untouched.
```

---

## Screenshots

In `store/screenshots/`, all 1280x800, 24-bit RGB with no alpha, which is what
the store requires. Upload in this order — the first one is the thumbnail, so it
has to carry the whole idea on its own.

1. `01-chooser.png` — the chooser mid-decision. The product in one frame.
2. `02-signed-out-accounts.png` — a signed-out account being offered, on a
   forms.gle link. This is the thing competitors do not do.
3. `03-accounts-detected.png` — accounts found automatically, with the privacy
   claim in the caption where it will actually be read.
4. `04-where-to-ask.png` — per-service switches, answering "will this get in my
   way?" before it is asked.

They are rendered from the extension's own stylesheets, so they match the real
UI exactly, with sample accounts rather than real e-mail addresses. Once the
extension has run for a while, a genuine capture of the chooser over a real page
would be a stronger first image.

## Assets still needed

- 128x128 icon — `assets/icons/icon-128.png` (done)
- 440x280 small promo tile
- 1400x560 marquee tile (optional)

## What actually moves ranking

Copy earns the click; it does not earn the rank. The store weights active weekly
users, retention, ratings and click-through, so a new listing with no installs
will not outrank an established one however well it is written. What the wording
can do is win the click when someone does see it, and match the long-tail phrases
nobody else has bothered to write for.
