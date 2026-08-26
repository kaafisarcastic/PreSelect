/**
 * PreSelect service worker.
 *
 * Watches top-frame navigations, and for anything that resolves to a Google
 * surface it either lets the navigation continue, rewrites it for an account the
 * user has already settled on, or replaces it with the chooser page.
 *
 * Chrome can stop and restart this worker at any time, so nothing important is
 * held in module scope beyond a settings cache that is safe to lose.
 */

import { MSG } from "../common/constants.js";
import { matchNavigation } from "../common/domains.js";
import { loadState, saveState, mergeDiscoveredAccounts, onStateChanged } from "../common/storage.js";
import { buildNavigationUrl } from "../common/url.js";
import { discoverSignedInAccounts } from "./accounts.js";
import { ACTION, decide, chooserUrlFor, scopeOf } from "./interceptor.js";
import {
  grantPass,
  consumePass,
  rememberTabScope,
  recallTabScope,
  noteRoute,
  wasRecentlyRouted,
  forgetTab,
  clearAllTabScopes,
} from "./session.js";

/* ------------------------------------------------------------ settings cache */

/**
 * Every navigation needs the settings, and chrome.storage.sync reads are the one
 * cost we can trivially remove from the hot path. The cache is dropped whenever
 * settings change, from this worker or from any open extension page.
 */
let cachedState = null;

async function getState() {
  cachedState ??= await loadState();
  return cachedState;
}

onStateChanged((next) => {
  cachedState = next;
});

/* ------------------------------------------------------------ account refresh */

const DISCOVERY_INTERVAL_MS = 5 * 60 * 1000;
let lastDiscoveryAt = 0;
let inFlightDiscovery = null;

/**
 * Refresh the signed-in account list. Concurrent callers share one request, and
 * `force` bypasses the throttle for user-initiated refreshes.
 */
async function refreshAccounts({ force = false } = {}) {
  const current = await getState();

  // Background refreshes are both throttled and opt-out; an explicit click by
  // the user is neither.
  if (!force && (!current.behavior.autoDiscover || Date.now() - lastDiscoveryAt < DISCOVERY_INTERVAL_MS)) {
    return { accounts: current.accounts, stale: true };
  }
  inFlightDiscovery ??= (async () => {
    try {
      const discovered = await discoverSignedInAccounts();
      const state = await getState();
      const accounts = mergeDiscoveredAccounts(state.accounts, discovered);
      const next = { ...state, accounts };
      cachedState = next;
      await saveState(next);
      lastDiscoveryAt = Date.now();
      return { accounts, stale: false };
    } finally {
      inFlightDiscovery = null;
    }
  })();
  return inFlightDiscovery;
}

/* -------------------------------------------------------------- interception */

/** Send a tab somewhere, tolerating tabs that closed while we were deciding. */
async function navigate(tabId, url) {
  try {
    await chrome.tabs.update(tabId, { url });
  } catch {
    // The tab is gone; nothing to recover from.
  }
}

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  // Only real top-level page loads in real tabs are worth inspecting.
  if (details.frameId !== 0 || details.tabId < 0) return;

  const state = await getState();

  // Cheap, pure check first so non-Google browsing costs nothing but a match.
  if (!matchNavigation(details.url, state).intercept) return;

  // A navigation we started ourselves must not be inspected a second time.
  if (await consumePass(details.tabId, details.url)) return;

  const outcome = await decide({
    url: details.url,
    state,
    lookupTabScope: (scope) => recallTabScope(details.tabId, scope),
    recentlyRouted: await wasRecentlyRouted(details.tabId),
  });

  if (outcome.action === ACTION.ALLOW) return;

  if (outcome.action === ACTION.ROUTE) {
    // Stop rewriting if we appear to be ping-ponging with a Google redirect.
    if (!(await noteRoute(details.tabId))) return;
    await grantPass(details.tabId, outcome.target);
    await navigate(details.tabId, outcome.target);
    return;
  }

  const chooser = chooserUrlFor({
    // The resolved destination, so a signpost host does not reach the chooser.
    url: outcome.match.url ?? details.url,
    tabId: details.tabId,
    host: outcome.match.host,
    label: outcome.match.label,
  });
  await navigate(details.tabId, chooser);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  forgetTab(tabId);
});

/* ------------------------------------------------------------------ messages */

/**
 * Handlers return a plain object that is sent straight back to the caller.
 * Anything that throws is converted into `{ ok: false, error }` so no caller
 * ever hangs waiting on a rejected promise.
 */
const handlers = {
  async [MSG.GET_STATE]() {
    return { state: await getState() };
  },

  async [MSG.SET_STATE]({ state }) {
    cachedState = state;
    await saveState(state);
    // Account, rule or scope changes invalidate what tabs previously settled on.
    await clearAllTabScopes();
    return { state };
  },

  async [MSG.DISCOVER_ACCOUNTS]({ force }) {
    return refreshAccounts({ force });
  },

  /** The chooser tells us which account won; we rewrite and continue. */
  async [MSG.RESOLVE_NAVIGATION]({ tabId, url, accountId, remember }) {
    const state = await getState();
    const account = state.accounts.find((candidate) => candidate.id === accountId);
    if (!account) throw new Error("That account is no longer configured.");

    const target = buildNavigationUrl(url, account);
    const host = new URL(url).hostname.toLowerCase();

    if (remember === "site") {
      // A persistent rule belongs to the whole site, not one app inside it: it is
      // the deliberate "stop asking me about this host" escape hatch.
      const next = { ...state, siteRules: { ...state.siteRules, [host]: account.id } };
      cachedState = next;
      await saveState(next);
    } else {
      // `url` is already the resolved destination, so this is the same key the
      // next navigation to this app will look up, however it is reached.
      await rememberTabScope(tabId, scopeOf(url, matchNavigation(url, state), state), account.id);
    }

    // Sending someone through sign-in changes who is signed in, so let the next
    // opportunistic refresh actually run instead of hitting the throttle.
    if (!account.signedIn) lastDiscoveryAt = 0;

    // Counts as a rewrite, so the redirect Google answers with is expected.
    await noteRoute(tabId);
    await grantPass(tabId, target);
    await navigate(tabId, target);
    return { target };
  },

  /** Back out of a held navigation: return where we came from, or close the tab. */
  async [MSG.CANCEL_NAVIGATION]({ tabId }) {
    try {
      await chrome.tabs.goBack(tabId);
    } catch {
      await chrome.tabs.remove(tabId).catch(() => {});
    }
    return { cancelled: true };
  },
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) return false;

  handler(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true; // Keep the message channel open for the async response.
});

/* ------------------------------------------------------------------ lifecycle */

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await refreshAccounts({ force: true }).catch(() => {});
  // A first run with no accounts configured would silently do nothing, so send
  // the user straight to the place where they can set it up.
  if (reason === "install") chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(() => {
  refreshAccounts({ force: true }).catch(() => {});
});
