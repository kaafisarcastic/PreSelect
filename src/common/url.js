/**
 * URL rewriting: turning "open this Google link" into "open this Google link as
 * a specific account".
 *
 * Google exposes two levers and they must not contradict each other:
 *
 *   1. the `/u/<index>/` path segment, used by Gmail, Drive, Calendar and friends
 *   2. the `authuser` query parameter, understood by essentially every surface
 *
 * `authuser` accepts either a session index or a full e-mail address. The index
 * is unstable, it changes whenever the user signs in or out of anything, so we
 * prefer the e-mail and only use the index when we have a fresh one from Google.
 * Whenever we cannot be sure of the index we strip the `/u/<n>/` segment so the
 * stale number in the link cannot override our choice.
 */

import { AUTH_PARAM, USER_INDEX_PATTERN, ACCOUNT_CHOOSER_URL } from "./constants.js";

/** Query parameters Google uses to name an account, all of which we replace. */
const ACCOUNT_PARAMS = [AUTH_PARAM, "authUser", "Email", "user"];

/**
 * Read the account hint present in a URL, as `{ value, source, portable }`.
 *
 * The distinction that matters is `portable`. Only an e-mail address identifies
 * an account outside the browser that produced the link. A session index does
 * not: `/u/1/` is a different person in a different browser, and `/u/0/` is not
 * a choice at all, it is simply whoever Google considers primary. Treating an
 * index as a decision is what makes a prompt fail to appear on exactly the pages
 * where it is needed most.
 */
export function readAccountHint(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const param = parsed.searchParams.get(AUTH_PARAM) ?? parsed.searchParams.get("authUser");
  if (param) return { value: param, source: "param", portable: param.includes("@") };

  const match = parsed.pathname.match(USER_INDEX_PATTERN);
  return match ? { value: match[0].slice(3), source: "path", portable: false } : null;
}

/** True when the hint in the URL already points at the given account. */
export function hintMatchesAccount(hint, account) {
  if (!hint || !account) return false;
  const value = String(hint.value).toLowerCase();
  if (value === account.email?.toLowerCase()) return true;
  return account.index != null && value === String(account.index);
}

/**
 * Rewrite `rawUrl` so Google opens it under `account`.
 * Returns the original URL untouched if it cannot be parsed.
 */
export function applyAccountToUrl(rawUrl, account) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  const hasIndex = Number.isInteger(account.index) && account.index >= 0;

  // Align the path segment with our choice, or remove it when we cannot.
  if (USER_INDEX_PATTERN.test(parsed.pathname)) {
    parsed.pathname = hasIndex
      ? parsed.pathname.replace(USER_INDEX_PATTERN, `/u/${account.index}`)
      : parsed.pathname.replace(USER_INDEX_PATTERN, "");
  }

  for (const param of ACCOUNT_PARAMS) parsed.searchParams.delete(param);
  parsed.searchParams.set(AUTH_PARAM, hasIndex ? String(account.index) : account.email);

  return parsed.toString();
}

/**
 * Build the URL to actually navigate to for a chosen account.
 *
 * For a signed-in account this is just the rewritten link. For an account the
 * browser is not signed into, we hand the whole thing to Google's account
 * chooser: it runs the normal sign-in flow and then forwards to `continue`.
 * That keeps every credential prompt inside Google, which is where it belongs.
 */
export function buildNavigationUrl(rawUrl, account) {
  const target = applyAccountToUrl(rawUrl, account);
  if (account.signedIn !== false) return target;

  const chooser = new URL(ACCOUNT_CHOOSER_URL);
  chooser.searchParams.set("Email", account.email);
  chooser.searchParams.set("continue", target);
  return chooser.toString();
}

/** Compact form of a URL for display, e.g. "docs.google.com/forms/d/e/...". */
export function describeUrl(rawUrl, maxLength = 72) {
  try {
    const parsed = new URL(rawUrl);
    const text = `${parsed.hostname}${parsed.pathname}${parsed.search}`.replace(/\/$/, "");
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  } catch {
    return rawUrl;
  }
}
