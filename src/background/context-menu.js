/**
 * "Open link as ..." in the right-click menu.
 *
 * The chooser answers "which account?" when the user has not decided. This
 * answers it when they already have: right-click a Google link, pick an account,
 * and it opens there without the prompt ever appearing.
 *
 * Chrome hands us the clicked link in `info.linkUrl`, so none of this needs to
 * read the page.
 */

import { DOMAIN_CATALOG, isEntryEnabled } from "../common/domains.js";

const ROOT_ID = "preselect-open-as";
const ITEM_PREFIX = "preselect-account:";

/**
 * Where the menu is allowed to appear.
 *
 * Without this the item would show on every link on the web, which is the
 * fastest way to get an extension uninstalled. Built from the surfaces that are
 * switched on, so the menu appears exactly where PreSelect would have acted.
 */
function linkPatterns(state) {
  const hosts = new Set();

  for (const entry of DOMAIN_CATALOG) {
    if (!isEntryEnabled(entry, state)) continue;
    for (const host of entry.hosts) hosts.add(host);
  }
  for (const pattern of state.customDomains ?? []) hosts.add(pattern);

  return [...hosts].map((host) => `*://${host}/*`);
}

/** Rebuild from scratch; cheaper than diffing and impossible to get out of step. */
export async function buildContextMenu(state) {
  await chrome.contextMenus.removeAll();

  const accounts = state.behavior.showSignedOutAccounts
    ? state.accounts
    : state.accounts.filter((account) => account.signedIn);

  if (accounts.length === 0) return;

  const targetUrlPatterns = linkPatterns(state);
  if (targetUrlPatterns.length === 0) return;

  chrome.contextMenus.create({
    id: ROOT_ID,
    // Not "Open link as": Chrome uses that title itself for opening a link in
    // another browser profile. Naming ours after accounts keeps the two apart.
    title: "Open with Google account",
    contexts: ["link", "page"],
    targetUrlPatterns,
    documentUrlPatterns: targetUrlPatterns,
  });

  for (const account of accounts) {
    chrome.contextMenus.create({
      id: ITEM_PREFIX + account.id,
      parentId: ROOT_ID,
      // The label alone is ambiguous once someone has two work accounts.
      title: account.label === account.email ? account.email : `${account.label} · ${account.email}`,
      contexts: ["link", "page"],
      targetUrlPatterns,
      documentUrlPatterns: targetUrlPatterns,
    });
  }
}

/**
 * Which account and link a menu click meant, or null if the click was not ours.
 *
 * Opening is left to the caller so that this and the keyboard shortcuts go
 * through one path and cannot drift apart.
 */
export function resolveMenuClick(info, state) {
  if (!String(info.menuItemId).startsWith(ITEM_PREFIX)) return null;
  // A click on the page itself carries no linkUrl, so use the page instead.
  const url = info.linkUrl ?? info.pageUrl;
  if (!url) return null;

  const account = state.accounts.find((candidate) => ITEM_PREFIX + candidate.id === info.menuItemId);
  return account ? { account, url, fromLink: Boolean(info.linkUrl) } : null;
}
