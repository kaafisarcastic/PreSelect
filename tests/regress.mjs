/**
 * Regression checks. Run with `node tests/regress.mjs`.
 *
 * No framework and no dependencies: every module here is plain ESM that runs
 * outside a browser, so a bare Node run is enough. Anything needing a real
 * chrome API gets a small stub rather than a mocking library.
 *
 * Each block is a bug that actually happened. Adding to it is cheaper than
 * rediscovering any of them.
 */

import fs from "node:fs";

import { decide, scopeOf } from "../src/background/interceptor.js";
import { buildContextMenu, resolveMenuClick } from "../src/background/context-menu.js";
import { matchNavigation } from "../src/common/domains.js";
import { DEFAULT_STATE } from "../src/common/constants.js";
import { buildNavigationUrl } from "../src/common/url.js";

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got ${got}\n         want ${want}`}`);
};
const section = (title) => console.log(`\n${title}`);

const account = (email, index, signedIn = true) => ({
  id: `acc:${email}`, email, label: email.split("@")[0], index, signedIn, color: "#000",
});
const state = {
  ...structuredClone(DEFAULT_STATE),
  accounts: [account("a@x.com", 0), account("b@x.com", 1)],
};
const never = async () => null;

section("signpost hosts resolve to a URL that accepts an account");
for (const [url, want] of [
  // gmail.com 404s the moment a query string is appended.
  ["https://gmail.com/", "https://mail.google.com/mail/"],
  ["https://www.gmail.com/", "https://mail.google.com/mail/"],
  // These 301 to a fixed URL that discards the query string.
  ["https://sheets.google.com/", "https://docs.google.com/spreadsheets"],
  ["https://slides.google.com/", "https://docs.google.com/presentation"],
  ["https://forms.google.com/", "https://docs.google.com/forms"],
  ["https://docs.google.com/", "https://docs.google.com/document"],
  ["https://accounts.google.com/", "https://myaccount.google.com/"],
]) check(url, matchNavigation(url, state).url, want);

section("sign-in flows are never intercepted");
for (const url of [
  "https://accounts.google.com/ServiceLogin?continue=x",
  "https://accounts.google.com/AccountChooser?Email=a@x.com",
  "https://accounts.google.com/signin/v2/identifier",
]) check(url, matchNavigation(url, state).intercept, false);

section("these must still prompt");
for (const url of [
  "https://gmail.com/",
  "https://docs.google.com/document/u/0/",
  "https://docs.google.com/spreadsheets/u/0/",
  "https://mail.google.com/mail/u/0/#inbox",
]) check(url, (await decide({ url, state, lookupTabScope: never })).action, "ask");

section("an e-mail in the link is deliberate; a bare index is not");
check("?authuser=b@x.com", (await decide({
  url: "https://docs.google.com/spreadsheets/d/1/edit?authuser=b@x.com", state, lookupTabScope: never,
})).action, "allow");
check("?authuser=1", (await decide({
  url: "https://docs.google.com/spreadsheets/d/1/edit?authuser=1", state, lookupTabScope: never,
})).action, "ask");

section("every route into one app shares a scope key");
for (const url of ["https://gmail.com/", "https://www.gmail.com/", "https://mail.google.com/mail/u/1/"]) {
  const match = matchNavigation(url, state);
  check(url, scopeOf(match.url ?? url, match, state), "mail.google.com");
}
for (const url of ["https://sheets.google.com/", "https://docs.google.com/spreadsheets/d/X/edit"]) {
  const match = matchNavigation(url, state);
  check(url, scopeOf(match.url ?? url, match, state), "docs.google.com/spreadsheets");
}

section("switching accounts rewrites the /u/N/ in the path, not just the query");
check("gmail /u/0/ -> account 1",
  buildNavigationUrl("https://mail.google.com/mail/u/0/#inbox", state.accounts[1]),
  "https://mail.google.com/mail/u/1/?authuser=1#inbox");
check("drive /u/0/ -> account 1",
  buildNavigationUrl("https://drive.google.com/drive/u/0/my-drive", state.accounts[1]),
  "https://drive.google.com/drive/u/1/my-drive?authuser=1");

section("the context menu is scoped to Google links only");
{
  const created = [];
  globalThis.chrome = { contextMenus: { removeAll: async () => {}, create: (item) => created.push(item) } };
  await buildContextMenu(state);
  check("a parent plus one item per account", created.length, state.accounts.length + 1);
  // "page" is what makes it usable on Gmail, where there is no link to click.
  check("on links and on the page", JSON.stringify(created[0].contexts), '["link","page"]');
  check("no catch-all pattern", created[0].targetUrlPatterns.includes("*://*/*"), false);
  check("covers gmail.com", created[0].targetUrlPatterns.includes("*://gmail.com/*"), true);
  // Without this the page context would offer the menu on every site on the web.
  check("page context scoped to Google too", Array.isArray(created[0].documentUrlPatterns), true);
}

section("menu clicks resolve to the right account and URL");
check("foreign menu item ignored", resolveMenuClick({ menuItemId: "other", linkUrl: "https://x.com" }, state), null);
check("no link and no page ignored", resolveMenuClick({ menuItemId: "preselect-account:acc:a@x.com" }, state), null);
{
  const onLink = resolveMenuClick(
    { menuItemId: "preselect-account:acc:b@x.com", linkUrl: "https://docs.google.com/x", pageUrl: "https://mail.google.com/" },
    state);
  check("a link click uses the link", onLink.url, "https://docs.google.com/x");
  check("…and the chosen account", onLink.account.email, "b@x.com");
  // Right-clicking the page is how this works on Gmail, where there is no link.
  const onPage = resolveMenuClick(
    { menuItemId: "preselect-account:acc:b@x.com", pageUrl: "https://mail.google.com/mail/u/0/" }, state);
  check("a page click falls back to the page", onPage.url, "https://mail.google.com/mail/u/0/");
}

section("both shortcut families are declared, four of them bound");
{
  const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const names = Object.keys(manifest.commands ?? {});
  const suggested = names.filter((name) => manifest.commands[name].suggested_key);
  check("eight commands", names.length, 8);
  check("four suggested keys (Chrome's limit)", suggested.length, 4);
  check("the bound ones switch in place", suggested.every((name) => name.startsWith("switch-")), true);
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall green");
process.exit(failures ? 1 : 0);
