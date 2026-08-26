# PreSelect

A Chrome extension that asks **which Google account** should open a link, before
the link opens.

Without it, a Gmail, Drive, Docs or Forms link always lands on whichever account
happens to be primary, and you fix it afterwards through the profile menu.
PreSelect moves that decision to the front: the navigation is held, you pick an
account, and the link is rewritten so Google opens it under that account
directly.

> **Beta.** Free while in beta. Some of it may need a paid licence later; anyone
> using it before then keeps what they have.

## Installing

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** and select this folder

On first run the settings page opens and PreSelect asks Google which accounts
the browser is signed into.

## How it works

```
navigation  ->  does this host matter?  ->  is the account already decided?  ->  act
              (settings + catalogue)      (site rule / tab memory / URL hint)
```

1. **Watch.** A `webNavigation` listener sees every top-frame navigation. Hosts
   are matched against a catalogue of Google surfaces plus any hosts you added
   yourself. `accounts.google.com` is never touched, since that is where sign-in
   and switching actually happen.
2. **Decide.** If a site rule, a per-tab choice, or an account already named in
   the URL settles the question, the navigation continues untouched. Otherwise
   the tab is sent to the chooser.
3. **Rewrite.** Google identifies an account through the `/u/<index>/` path
   segment and the `authuser` query parameter. PreSelect sets `authuser` and
   keeps the path segment consistent with it. The session index is unstable, so
   the account's e-mail address is used whenever a fresh index is not known, and
   a stale `/u/<n>/` in the original link is stripped rather than trusted.

Choices are remembered at three levels, most specific first:

| Scope | Set from | Lifetime |
| --- | --- | --- |
| Per tab, per app | any choice in the chooser | until the tab closes |
| Per site | "Always use this account for …" | until removed in settings |
| Everywhere | "Account to use" in settings | until changed |

The unit of an answer is the **app**, not the hostname, because a hostname is not
an app: `docs.google.com` serves Docs, Sheets, Slides and Forms. Answering for a
spreadsheet does not answer for a document. Hosts that behave this way say so in
the catalogue (`appScope`), so places like the Cloud console — where `/compute`
and `/home` are sections of one product, not separate products — stay
host-scoped.

The key always comes from where a navigation **ends up**, never from how it was
reached. `sheets.google.com` and `docs.google.com/spreadsheets` are the same app,
so both produce `docs.google.com/spreadsheets` and are one question, in either
order. Telling Sheets apart from Docs is the app scope's job, so the entry host
needs no key of its own.

## Accounts, and the signed-out ones

**You do not add accounts by hand.** Chrome exposes no API for "which Google
accounts is this profile signed into", so PreSelect asks Google directly through
`ListAccounts` — the same endpoint the Google account switcher is built on. It
runs on your existing cookies, sends nothing anywhere, and returns the accounts
with their session order.

Usefully, that list includes accounts whose session has **expired** — ones Google
still remembers but that you are no longer signed into. PreSelect reads the
validity flag on each row and marks those as signed out, so in most cases the
"logged out but known" accounts appear on their own without any typing.

Manual adding stays available for the one case discovery cannot cover: an account
this browser profile has never signed into, so Google has nothing to report.

### Recommendation: show signed-out accounts, clearly separated

If you have four accounts signed in and two more that you use occasionally but
are signed out of, PreSelect **lists all six** — the signed-out two under a
separate "Not signed in" heading, with a hollow avatar and a *Sign in* badge.

Picking a signed-out account does not attempt anything clever. The link is
rewritten for that account and then handed to Google's own account chooser:

```
https://accounts.google.com/AccountChooser?Email=<account>&continue=<rewritten link>
```

Google runs its normal sign-in flow and forwards to the destination afterwards.

This is the right trade-off for three reasons:

- **The alternative is worse.** Hiding signed-out accounts means the moment you
  need one, PreSelect is not just unhelpful but actively in the way: you dismiss
  the prompt, sign in manually, find the link again, and re-open it.
- **No credentials ever touch the extension.** Every password, 2FA prompt and
  consent screen stays on Google's own pages. PreSelect only ever produces a
  URL.
- **The distinction is visible before you click.** The separate group, the
  hollow avatar and the badge make it obvious that choosing this row means a
  sign-in detour, so nobody picks one by accident.

Discovery never deletes a manually added account, it only flips it to signed-in
once Google reports a live session for it. And if you would rather not see the
group at all, **Offer signed-out accounts** turns it off.

## Settings

- **Accounts** — detected automatically on install and refreshed as you browse.
  Labels are editable and a label you type is never overwritten by a refresh.
  Manual adding is only for accounts this browser has never signed into.
- **Account to use** — pin one account and the prompt disappears entirely.
- **Offer signed-out accounts** — show or hide the "Not signed in" group.
- **Don't ask when the link already names an account** — links carrying
  `authuser=` or `/u/2/` for a known account open straight away.
- **How often to ask** — the trade is fewer interruptions against fewer documents
  opened under an account you did not pick for them. *Once per app* (default)
  suits working in one account at a time: choosing for Sheets covers every sheet
  in that tab, and Docs, Gmail and Drive each ask once of their own. *Once per
  document* suits documents from several accounts arriving mixed together, since
  a previous answer never carries over to the next file. Neither asks when you
  reload a document or move around inside it, and a tab forgets its answers when
  it closes. To stop being asked for an entire site, use the site rule.
- **Where to ask** — per-surface toggles, grouped. Gmail, Drive, Docs/Forms,
  Calendar and the consoles are on by default. **Google Search (google.com)**,
  YouTube, Maps, News and Play are off by default and can be switched on
  individually. Extra hosts, including Workspace vanity domains, can be added as
  `mail.mycompany.com` or `*.mycompany.com`.
- **Site rules** — the "always use this account here" rules you created, with a
  way to remove them.

The toolbar popup shows which account the current page is open as and moves it
to another account in one click.

## Layout

```
manifest.json
assets/
  logo.svg                  source of truth for the mark
  icons/                    generated PNGs, 16 / 32 / 48 / 128
src/
  common/                   shared by the worker and every page
    constants.js            storage keys, message types, defaults
    domains.js              Google surface catalogue and host matching
    url.js                  authuser / u-index rewriting
    storage.js              chrome.storage wrapper, account merging
  background/
    service-worker.js       navigation listener, messages, lifecycle
    interceptor.js          allow / route / ask decision, no Chrome APIs
    session.js              one-shot passes and per-tab memory
    accounts.js             signed-in account discovery
  ui/
    shared/                 design tokens, DOM helpers, messaging
    chooser/                the interstitial shown in place of the link
    options/                settings page
    popup/                  toolbar popup
tools/
  generate-icons.py         re-renders assets/icons from the same geometry
```

## Notes and limits

- `ListAccounts` is an internal Google endpoint with two traps: it is POST only,
  and it allowlists the `Origin` header, answering `403` to a
  `chrome-extension://` origin. `ensureOriginRule` rewrites that single header on
  that single URL, scoped with `tabIds: [-1]` so it can only ever apply to a
  request that comes from no tab — which a service worker fetch is and a web
  page's fetch can never be.
- Some Google hosts exist only to redirect, and the redirect **discards the query
  string**: `sheets.google.com/?authuser=…` becomes
  `docs.google.com/spreadsheets?usp=direct_url`, account and all. Those hosts are
  resolved before rewriting (`HOST_ALIASES` in `domains.js`), so the account is
  applied to the URL that actually survives. Only the bare landing page is
  treated this way; deeper paths are real pages, and on `accounts.google.com`
  they are sign-in flows that must not be touched.
- Discovery degrades in three steps rather than failing: `ListAccounts` for exact
  ordering and expired sessions, then the sign-out page for e-mail addresses
  alone, then manual entry. Losing a step costs precision, not the feature.
- The row parser tries Google's known field positions first and falls back to
  scanning the row, so a layout change costs the signed-out flag rather than
  everything.
- The chooser replaces the page rather than floating above it, because a content
  script cannot stop a navigation that has already started. Cancel goes back, or
  closes the tab when there is nowhere to go back to.
- Single-page navigations inside an already-open Google app are not
  re-intercepted; the account was decided when the app was loaded.
- Nothing leaves the browser. Settings hold e-mail addresses, labels and toggles,
  and sync through your Chrome profile.

## Regenerating the icons

```
python3 tools/generate-icons.py
```

The script and `assets/logo.svg` share one set of coordinates. Change the
geometry in both if the mark ever changes.

The mark is two account rings with a chevron in the front one: the chevron is the
"open this and choose" affordance every account menu uses, and the second ring
says there is more than one to choose from. It is deliberately not a Google G.
Imitating Google's own mark implies an affiliation that does not exist and is a
common cause of Web Store rejection — and at 16px a G-shaped mark collapses into
a plain G that conveys nothing about choosing anyway.
