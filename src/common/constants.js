/**
 * Shared constants. Everything that both the background worker and the UI pages
 * need to agree on lives here so there is exactly one source of truth.
 */

export const STORAGE_KEY = "preselect.state";
export const STATE_VERSION = 1;

/** Keys used inside chrome.storage.session (cleared when the browser closes). */
export const SESSION_KEYS = {
  /** Navigations we deliberately let through once, keyed by tab. */
  PASS: "pass",
  /** Per-tab, per-host account choices so we only ask once per site visit. */
  TAB_HOSTS: "tabHosts",
  /** Recent rewrite counts per tab, used to break redirect ping-pong. */
  ROUTES: "routes",
};

/** Message types exchanged between the extension pages and the service worker. */
export const MSG = {
  GET_STATE: "state:get",
  SET_STATE: "state:set",
  DISCOVER_ACCOUNTS: "accounts:discover",
  RESOLVE_NAVIGATION: "nav:resolve",
  CANCEL_NAVIGATION: "nav:cancel",
};

/**
 * Google resolves an account either by its session index (`/u/2/`, `authuser=2`)
 * or by the account's e-mail address (`authuser=me@example.com`). The index is
 * faster but shifts whenever the user signs in or out somewhere, so we always
 * carry the e-mail as the durable identifier and treat the index as a hint.
 */
export const AUTH_PARAM = "authuser";

/** Path segment Google uses for the multi-login index, e.g. /mail/u/1/#inbox. */
export const USER_INDEX_PATTERN = /\/u\/\d+(?=\/|$)/;

/** Where Google hands a signed-out user over to a sign-in flow. */
export const ACCOUNT_CHOOSER_URL = "https://accounts.google.com/AccountChooser";

/** Palette used to give each account a recognisable dot in the chooser. */
export const ACCOUNT_COLORS = [
  "#4f7cff",
  "#2fa87a",
  "#d4713a",
  "#9257d6",
  "#c2456b",
  "#2a9db0",
  "#7a8b3f",
  "#b3552f",
];

/**
 * How much a single answer covers, within one tab, until the tab closes.
 *
 * `app` is the sane default. It exists because a hostname is not an app:
 * docs.google.com serves Docs, Sheets, Slides and Forms, so remembering by host
 * would let one answer cover four separate products. `document` is for people
 * who move between accounts constantly and want each file asked about, and it
 * still avoids re-asking when you reload or navigate inside the one you are on.
 */
export const TAB_SCOPES = {
  APP: "app",
  DOCUMENT: "document",
};

export const DEFAULT_BEHAVIOR = {
  /** Show accounts that are configured but not currently signed in. */
  showSignedOutAccounts: true,
  /** Skip the prompt when the link already names an account (authuser=...). */
  skipWhenAccountPinned: true,
  /** Refresh the signed-in account list from Google in the background. */
  autoDiscover: true,
  /** How wide a single answer reaches. See TAB_SCOPES. */
  tabScope: TAB_SCOPES.APP,
};

/** Blank state used on first run and as the merge base for stored state. */
export const DEFAULT_STATE = Object.freeze({
  version: STATE_VERSION,
  accounts: [],
  /** Account used by the "Always use" shortcut; null means always ask. */
  defaultAccountId: null,
  /** Per-domain on/off overrides, keyed by catalog id. */
  domainOverrides: {},
  /** Extra hosts the user added by hand, e.g. a Workspace vanity domain. */
  customDomains: [],
  /** Persistent host -> accountId routes created via "Always use for this site". */
  siteRules: {},
  behavior: { ...DEFAULT_BEHAVIOR },
});
