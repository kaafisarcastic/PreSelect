/**
 * Toolbar popup.
 *
 * Two jobs: say which account the current Google page is open as, and let the
 * user move that page to a different account without going back to the address
 * bar. It reuses the same resolve path as the chooser, so a switch here also
 * updates what the tab remembers.
 */

import { findCatalogEntry, findCustomDomain, isEntryEnabled, isNeverIntercepted } from "../../common/domains.js";
import { readAccountHint, hintMatchesAccount } from "../../common/url.js";
import { el, qs, render, initial } from "../shared/dom.js";
import { getState, setState, discoverAccounts, resolveNavigation } from "../shared/messaging.js";

let state = null;
let tab = null;
let host = "";

function accountButton(account, current) {
  return el(
    "button",
    {
      class: "popup__account",
      type: "button",
      "aria-current": current ? "true" : null,
      onclick: () => switchTo(account),
    },
    [
      el("span", {
        class: "avatar",
        style: account.signedIn ? `background:${account.color}` : "",
        text: initial(account),
      }),
      el("span", { class: "popup__account-text" }, [
        el("span", { class: "popup__account-name", text: account.label }),
        el("span", { class: "popup__account-email", text: account.email }),
      ]),
      account.signedIn ? null : el("span", { class: "badge", text: "Sign in" }),
      current ? el("span", { class: "badge", text: "Current" }) : null,
    ],
  );
}

async function switchTo(account) {
  await resolveNavigation({ tabId: tab.id, url: tab.url, accountId: account.id, remember: "tab" });
  window.close();
}

function draw() {
  const hint = tab?.url ? readAccountHint(tab.url) : null;
  const current = state.accounts.find((account) => hintMatchesAccount(hint, account)) ?? null;

  qs("#site-host").textContent = host || "This page";
  qs("#site-account").textContent = current
    ? current.email
    : host
      ? "Account not identified"
      : "Not a Google page";

  const visible = state.behavior.showSignedOutAccounts
    ? state.accounts
    : state.accounts.filter((account) => account.signedIn);

  const switchable = Boolean(host) && visible.length > 0;
  qs("#switch-title").hidden = !switchable;
  render(qs("#account-list"), switchable ? visible.map((a) => accountButton(a, a.id === current?.id)) : []);

  const note = qs("#note");
  if (!host) note.textContent = "PreSelect only steps in on Google pages you have switched on.";
  else if (!visible.length) note.textContent = "No accounts configured yet. Open settings to add them.";
  else note.textContent = "";
}

/** The per-site switch mirrors the matching toggle on the settings page. */
function drawWatchToggle() {
  const entry = host ? findCatalogEntry(host) : null;
  const custom = host ? findCustomDomain(host, state.customDomains) : null;
  const wrap = qs("#watch-wrap");
  const input = qs("#watch-site");

  if (!entry && !custom) {
    wrap.hidden = true;
    return;
  }

  wrap.hidden = false;
  wrap.title = `Ask before opening ${entry ? entry.label : host}`;
  input.checked = custom ? true : isEntryEnabled(entry, state);

  input.onchange = async () => {
    if (entry) {
      state.domainOverrides[entry.id] = input.checked;
    } else if (!input.checked) {
      state.customDomains = state.customDomains.filter((pattern) => pattern !== custom);
    }
    await setState(state);
  };
}

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state = await getState();

  try {
    const parsed = new URL(tab?.url ?? "");
    const candidate = parsed.hostname.toLowerCase();
    // Only treat it as "a Google page" if we would ever act on it.
    if (!isNeverIntercepted(candidate) && (findCatalogEntry(candidate) || findCustomDomain(candidate, state.customDomains))) {
      host = candidate;
    }
  } catch {
    host = "";
  }

  draw();
  drawWatchToggle();

  qs("#settings").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  qs("#refresh").addEventListener("click", async () => {
    await discoverAccounts(true).catch(() => {});
    state = await getState();
    draw();
  });
}

init();
