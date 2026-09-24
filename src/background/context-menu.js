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

import { DOMAIN_CATALOG, isEntryEnabled, matchNavigation } from "../common/domains.js";
import { buildNavigationUrl } from "../common/url.js";

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
    contexts: ["link"],
    targetUrlPatterns,
  });

  for (const account of accounts) {
    chrome.contextMenus.create({
      id: ITEM_PREFIX + account.id,
      parentId: ROOT_ID,
      // The label alone is ambiguous once someone has two work accounts.
      title: account.label === account.email ? account.email : `${account.label} · ${account.email}`,
      contexts: ["link"],
      targetUrlPatterns,
    });
  }
}

/**
 * Open the clicked link under the chosen account.
 *
 * `grantPass` is what stops our own interceptor asking about a tab the user has
 * just answered for. It has to be in place before the tab navigates, so the tab
 * is opened blank and pointed at the target afterwards.
 */
export async function handleContextMenuClick({ info, tab, state, grantPass }) {
  if (!String(info.menuItemId).startsWith(ITEM_PREFIX)) return;

  const account = state.accounts.find((candidate) => ITEM_PREFIX + candidate.id === info.menuItemId);
  if (!account || !info.linkUrl) return;

  // Resolve signpost hosts first, so gmail.com becomes a URL that accepts an
  // account instead of one that 404s.
  const match = matchNavigation(info.linkUrl, state);
  const target = buildNavigationUrl(match.url ?? info.linkUrl, account);

  const opened = await chrome.tabs.create({
    url: "about:blank",
    index: tab ? tab.index + 1 : undefined,
    openerTabId: tab?.id,
  });

  await grantPass(opened.id, target);
  await chrome.tabs.update(opened.id, { url: target });
}
