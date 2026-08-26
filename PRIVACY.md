# Privacy Policy — PreSelect

**Last updated: 26 August 2026**

PreSelect is a browser extension that asks which Google account should open a
Google link, then opens it under the account you pick.

This policy describes every piece of data the extension touches. It is short
because the extension does very little with data, by design.

## The short version

- There is no PreSelect server. No data is sent to us, because there is nowhere
  to send it.
- There is no analytics, telemetry, tracking, advertising or profiling.
- Nothing is sold, shared or disclosed to anyone.
- The extension never sees your password, your cookies or your session tokens,
  and cannot sign you in or out of anything.

## What is stored

Stored locally by the browser, in extension storage:

| Data | Why |
| --- | --- |
| Google account e-mail addresses | To list your accounts and to build the link that opens under the right one |
| Labels you give those accounts | So the list is readable |
| Google session index (`u/0`, `u/1`, …) | To address an account faster when it is known |
| Which Google services you switched on | Your settings |
| Per-site rules you create | So a site you settled stops asking |

These are kept in Chrome's `storage.sync` area. If you have Chrome Sync turned
on, Chrome replicates them across your signed-in Chrome profile in the same way
it syncs bookmarks. That transfer is between you and Google; PreSelect neither
performs nor receives it.

## What is not stored

Page content, form data, keystrokes, cookies, passwords and authentication tokens
are never read or stored. The extension has no content scripts and cannot see the
contents of the pages you visit.

## What is inspected, and what is kept from it

To decide whether to ask, the extension looks at the address of each page you
navigate to. That inspection happens in memory, no browsing history is compiled,
and nothing is transmitted. Two things derived from it are retained:

- The hostname of any site you create a rule for. That is a setting you chose.
- For the current browser session only, which account each tab settled on for a
  site, so the same question is not repeated as you move around that site. This
  is held in `storage.session` and the browser discards it when it closes.

## Network requests

PreSelect makes requests to exactly two addresses, both belonging to Google, both
using the browser session you already have:

- `POST https://accounts.google.com/ListAccounts` — asks Google which accounts
  this browser is signed into. This is the same endpoint Google's own account
  switcher uses.
- `GET https://accounts.google.com/SignOutOptions` — a fallback used only if the
  first request fails, to read the same list from an ordinary Google page.

No other host is contacted. Rewritten links are opened by your browser as normal
navigation, exactly as if you had clicked them yourself.

## Permissions

| Permission | Used for |
| --- | --- |
| `storage` | Saving your accounts and settings |
| `tabs` | Sending a tab to the account you chose, and going back if you cancel |
| `webNavigation` | Noticing a Google page is about to open, so the question can be asked first |
| `declarativeNetRequestWithHostAccess` | Correcting one header on the account-list request above, which Google rejects otherwise |
| `https://accounts.google.com/*` | The two requests listed above |

There is no permission to read page content, and the extension contains no
content scripts. It cannot see the pages you visit.

## Children

PreSelect is a productivity tool for browser users and is not directed at
children.

## Changes

If this policy changes, the date at the top changes with it, and the revised
version is published at the same address.

## Contact

Questions about this policy: **saadsiddiqui468.1@gmail.com**

PreSelect is not affiliated with, endorsed by, or sponsored by Google LLC.
Google, Gmail, Google Drive, Google Docs and Google Forms are trademarks of
Google LLC.
