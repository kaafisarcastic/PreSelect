/**
 * Short-lived bookkeeping for the interception loop.
 *
 * Two things need remembering only until the browser closes:
 *
 *   pass      a one-shot permission to let the next navigation of a tab through,
 *             so the URL we ourselves just chose is not intercepted again
 *   tabHosts  which account a tab already settled on for a scope, so clicking
 *             around inside one app does not re-prompt on every page load
 *
 * Both live in chrome.storage.session because a service worker can be torn down
 * between two navigations and in-memory state would not survive that. Writes are
 * serialised through a promise chain so overlapping navigations cannot clobber
 * each other's read-modify-write.
 */

import { SESSION_KEYS } from "../common/constants.js";
import { readSession, writeSession } from "../common/storage.js";

/** A pass is only valid for the navigation that immediately follows it. */
const PASS_TTL_MS = 15_000;

let queue = Promise.resolve();

function serialise(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

/* --------------------------------------------------------------- one-shot pass */

export function grantPass(tabId, url) {
  return serialise(async () => {
    const passes = await readSession(SESSION_KEYS.PASS);
    passes[tabId] = { url, expiresAt: Date.now() + PASS_TTL_MS };
    await writeSession(SESSION_KEYS.PASS, passes);
  });
}

/**
 * Consume a pass for this exact navigation. Returns true when the navigation
 * was pre-approved and should be left alone.
 */
export function consumePass(tabId, url) {
  return serialise(async () => {
    const passes = await readSession(SESSION_KEYS.PASS);
    const pass = passes[tabId];
    if (!pass) return false;

    const valid = pass.url === url && pass.expiresAt > Date.now();
    // Whether it matched or expired, the pass has done its job either way.
    delete passes[tabId];
    await writeSession(SESSION_KEYS.PASS, passes);
    return valid;
  });
}

/* ------------------------------------------------------------ per-tab choices */

/** Record a choice against one scope or several; duplicates and blanks are fine. */
export function rememberTabScope(tabId, scopes, accountId) {
  const entries = [...new Set([scopes].flat().filter(Boolean))];
  return serialise(async () => {
    const tabs = await readSession(SESSION_KEYS.TAB_HOSTS);
    tabs[tabId] = { ...(tabs[tabId] ?? {}), ...Object.fromEntries(entries.map((scope) => [scope, accountId])) };
    await writeSession(SESSION_KEYS.TAB_HOSTS, tabs);
  });
}

export async function recallTabScope(tabId, scope) {
  const tabs = await readSession(SESSION_KEYS.TAB_HOSTS);
  return tabs[tabId]?.[scope] ?? null;
}

/** Drop everything we know about a tab once it is gone. */
export function forgetTab(tabId) {
  return serialise(async () => {
    const [passes, tabs, routes] = await Promise.all([
      readSession(SESSION_KEYS.PASS),
      readSession(SESSION_KEYS.TAB_HOSTS),
      readSession(SESSION_KEYS.ROUTES),
    ]);
    delete passes[tabId];
    delete tabs[tabId];
    delete routes[tabId];
    await Promise.all([
      writeSession(SESSION_KEYS.PASS, passes),
      writeSession(SESSION_KEYS.TAB_HOSTS, tabs),
      writeSession(SESSION_KEYS.ROUTES, routes),
    ]);
  });
}

/* ----------------------------------------------------------- loop protection */

/** How many rewrites of one tab we tolerate before assuming we are fighting. */
const ROUTE_LIMIT = 3;
const ROUTE_WINDOW_MS = 10_000;

/**
 * Count how many times we have rewritten this tab's navigation recently.
 *
 * Google sometimes answers a rewritten URL with a redirect back to a canonical
 * form, and if our idea of the account disagrees with that form we could rewrite
 * it straight back, forever. Rather than trying to predict every canonical URL
 * Google might produce, we simply stop rewriting after a few rounds and let the
 * page load, which fails safe: worst case the user lands on the wrong account
 * once, exactly as they would without the extension.
 */
export function noteRoute(tabId) {
  return serialise(async () => {
    const routes = await readSession(SESSION_KEYS.ROUTES);
    const record = routes[tabId];
    const fresh = !record || record.until < Date.now();
    const count = fresh ? 1 : record.count + 1;

    routes[tabId] = { count, until: fresh ? Date.now() + ROUTE_WINDOW_MS : record.until };
    await writeSession(SESSION_KEYS.ROUTES, routes);
    return count <= ROUTE_LIMIT;
  });
}

/** True while a rewrite of this tab is recent enough to still be settling. */
export async function wasRecentlyRouted(tabId) {
  const routes = await readSession(SESSION_KEYS.ROUTES);
  return (routes[tabId]?.until ?? 0) > Date.now();
}

/** Forget per-tab choices, e.g. when the user changes the account list. */
export function clearAllTabScopes() {
  return serialise(() => writeSession(SESSION_KEYS.TAB_HOSTS, {}));
}
