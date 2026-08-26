/**
 * The account chooser.
 *
 * It stands in for the page the user asked for, so it has to be fast to read and
 * fast to dismiss: number keys pick an account, Escape cancels, and the first
 * row is focused on load so Enter takes the most likely choice.
 */

import { describeUrl } from "../../common/url.js";
import { el, qs, render, initial } from "../shared/dom.js";
import { getState, discoverAccounts, resolveNavigation, cancelNavigation } from "../shared/messaging.js";

const params = new URLSearchParams(location.search);
const target = params.get("target") ?? "";
const tabId = Number(params.get("tabId"));
const host = params.get("host") ?? "";
const surfaceLabel = params.get("label") ?? "";

const list = qs("#account-list");
const status = qs("#status");
const rememberSite = qs("#remember-site");

/** Rows in display order, so number keys and arrow keys agree with the list. */
let rows = [];

function setStatus(message, isError = false) {
  status.textContent = message;
  status.style.color = isError ? "var(--danger)" : "";
}

function accountRow(account, position) {
  const row = el(
    "button",
    {
      class: `account${account.signedIn ? "" : " account--signed-out"}`,
      type: "button",
      role: "option",
      title: account.signedIn
        ? `Open as ${account.email}`
        : `${account.email} is signed out. Google will ask you to sign in, then continue to the link.`,
      onclick: () => choose(account),
    },
    [
      el("span", { class: "avatar", style: account.signedIn ? `background:${account.color}` : "", text: initial(account) }),
      el("span", { class: "account__text" }, [
        el("span", { class: "account__name", text: account.label }),
        el("span", { class: "account__email", text: account.email }),
      ]),
      account.signedIn ? null : el("span", { class: "badge", text: "Sign in" }),
      position < 9 ? el("span", { class: "account__key", text: String(position + 1) }) : null,
    ],
  );
  return row;
}

function draw(state) {
  const visible = state.behavior.showSignedOutAccounts
    ? state.accounts
    : state.accounts.filter((account) => account.signedIn);

  qs("#empty-state").hidden = visible.length > 0;

  const signedIn = visible.filter((account) => account.signedIn);
  const signedOut = visible.filter((account) => !account.signedIn);

  rows = [];
  const nodes = [];

  // Signed-in accounts need no heading; they are the expected case.
  for (const account of signedIn) {
    const row = accountRow(account, rows.length);
    rows.push(row);
    nodes.push(row);
  }

  // Signed-out accounts are offered too, but clearly set apart so nobody picks
  // one by accident: choosing one means a sign-in detour before the link opens.
  if (signedOut.length) {
    nodes.push(el("p", { class: "chooser__group", text: "Not signed in" }));
    for (const account of signedOut) {
      const row = accountRow(account, rows.length);
      rows.push(row);
      nodes.push(row);
    }
  }

  render(list, nodes);
  rows[0]?.focus();
}

async function choose(account) {
  setStatus(account.signedIn ? "Opening…" : "Sending you to Google to sign in…");
  try {
    await resolveNavigation({
      tabId,
      url: target,
      accountId: account.id,
      remember: rememberSite.checked ? "site" : "tab",
    });
  } catch (error) {
    setStatus(error.message, true);
  }
}

/** Number keys select, arrows move, Escape backs out. */
function onKeyDown(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key === "Escape") {
    event.preventDefault();
    cancelNavigation(tabId).catch(() => window.close());
    return;
  }

  const digit = Number(event.key);
  if (Number.isInteger(digit) && digit >= 1 && digit <= rows.length) {
    event.preventDefault();
    rows[digit - 1].click();
    return;
  }

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const current = rows.indexOf(document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = (current + step + rows.length) % rows.length;
    rows[next]?.focus();
  }
}

async function init() {
  // The visible line is trimmed by CSS to whatever fits, so the cap here only
  // guards against pathological URLs. The full link stays available on hover.
  const urlLine = qs("#target-url");
  urlLine.textContent = describeUrl(target, 200);
  urlLine.title = target;

  qs("#remember-host").textContent = host;
  if (surfaceLabel) {
    const badge = qs("#target-label");
    badge.textContent = surfaceLabel;
    badge.hidden = false;
  }

  draw(await getState());

  // Refresh in the background: session indexes go stale quietly, and a chooser
  // opening is the perfect moment to notice that someone signed in or out.
  discoverAccounts()
    .then(async ({ stale }) => {
      if (!stale) draw(await getState());
    })
    .catch(() => {
      /* Discovery is best effort; the stored list still works. */
    });

  qs("#cancel").addEventListener("click", () => cancelNavigation(tabId).catch(() => window.close()));
  qs("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
  qs("#refresh").addEventListener("click", async () => {
    setStatus("Checking Google for signed-in accounts…");
    try {
      await discoverAccounts(true);
      draw(await getState());
      setStatus("Account list updated.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  document.addEventListener("keydown", onKeyDown);
}

init();
