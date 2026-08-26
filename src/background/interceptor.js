/**
 * The decision layer: for a given top-frame navigation, do we let it through,
 * silently route it to a known account, or stop and ask the user?
 *
 * The logic is kept free of Chrome API calls so it stays easy to reason about;
 * the service worker supplies the session lookups and performs the outcome.
 */

import { matchNavigation, scopeKey } from "../common/domains.js";
import { readAccountHint, hintMatchesAccount, buildNavigationUrl } from "../common/url.js";

/** Outcomes the service worker knows how to carry out. */
export const ACTION = {
  ALLOW: "allow",
  ROUTE: "route",
  ASK: "ask",
};

/**
 * The key a navigation is filed under, always taken from where it ends up.
 *
 * Using the destination is what makes `sheets.google.com` and
 * `docs.google.com/spreadsheets` one question instead of two: they are the same
 * app, so they must produce the same key regardless of which one you reached it
 * through. Distinguishing Sheets from Docs is already handled by the app scope
 * itself, so the entry host needs no key of its own.
 */
export function scopeOf(url, match, state) {
  return scopeKey({ url, host: match.host, entry: match.entry, mode: state.behavior.tabScope });
}

function findAccount(state, id) {
  return state.accounts.find((account) => account.id === id) ?? null;
}

function findAccountByHint(state, hint) {
  if (!hint) return null;
  return state.accounts.find((account) => hintMatchesAccount(hint, account)) ?? null;
}

/**
 * Is the account named in the URL good enough to leave the navigation alone?
 *
 * A plain match is the easy case. The subtle one happens immediately after we
 * rewrite a link: Google answers by redirecting to its canonical `/u/<n>/` form,
 * and if we hold no fresh session index for the account we chose, we would read
 * that as the wrong account and rewrite it straight back. So for a moment after
 * a rewrite we accept a bare index, unless it demonstrably belongs to a
 * different configured account.
 */
function hintSatisfies({ hint, account, state, recentlyRouted }) {
  if (hintMatchesAccount(hint, account)) return true;
  if (!recentlyRouted || !hint || !/^\d+$/.test(hint.value)) return false;

  return !state.accounts.some(
    (candidate) => candidate.id !== account.id && candidate.index === Number(hint.value),
  );
}

/**
 * Decide what should happen to `url` in `tabId`.
 *
 * `lookupTabScope` is injected so this function can be unit tested and so the
 * session read only happens when it is actually needed.
 */
export async function decide({ url, state, lookupTabScope, recentlyRouted = false }) {
  const match = matchNavigation(url, state);
  if (!match.intercept) return { action: ACTION.ALLOW, match };

  // Where the navigation really ends up, which differs from `url` when the link
  // is a signpost host whose redirect would discard our account parameter.
  const destination = match.url ?? url;
  const isSignpost = destination !== url;

  // A single account pinned for everything means the user never wants the prompt.
  const forced = findAccount(state, state.defaultAccountId);
  const siteRuleAccount = findAccount(state, state.siteRules?.[match.host]);
  const hint = readAccountHint(destination);

  /**
   * Either leave the navigation alone or send it to the account we settled on.
   * A signpost is always rewritten: letting it through would drop the account.
   */
  const settle = (account) =>
    !isSignpost && hintSatisfies({ hint, account, state, recentlyRouted })
      ? { action: ACTION.ALLOW, match, account }
      : { action: ACTION.ROUTE, match, account, target: buildNavigationUrl(destination, account) };

  // "Always use X here" beats the global default: it is the more specific rule.
  const rule = siteRuleAccount ?? forced;
  if (rule) return settle(rule);

  // The tab already answered for this app; keep browsing in that account.
  const remembered = findAccount(state, await lookupTabScope(scopeOf(destination, match, state)));
  if (remembered) return settle(remembered);

  // The link was shared with an account deliberately baked into it, so there is
  // nothing to disambiguate. Only an e-mail counts as deliberate: a bare `/u/0/`
  // is just Google's primary account, which is precisely the case the user
  // installed this to be asked about.
  const hinted = findAccountByHint(state, hint);
  if (state.behavior.skipWhenAccountPinned && hint?.portable && hinted) {
    return { action: ACTION.ALLOW, match, account: hinted };
  }

  // Nothing configured yet: prompting with an empty list would only annoy.
  if (state.accounts.length === 0) return { action: ACTION.ALLOW, match, reason: "no-accounts" };

  return { action: ACTION.ASK, match };
}

/** Build the chooser page URL for a held-back navigation. */
export function chooserUrlFor({ url, tabId, host, label }) {
  const chooser = new URL(chrome.runtime.getURL("src/ui/chooser/chooser.html"));
  // `url` is the resolved destination, which is also what the answer is filed
  // against, so the chooser needs to carry nothing about the entry host.
  chooser.searchParams.set("target", url);
  chooser.searchParams.set("tabId", String(tabId));
  chooser.searchParams.set("host", host);
  if (label) chooser.searchParams.set("label", label);
  return chooser.toString();
}
