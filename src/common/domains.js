/**
 * The catalogue of Google surfaces PreSelect knows about, plus the matching
 * logic that decides whether a given URL should trigger the account prompt.
 *
 * Adding support for a new Google property is a one-line change here: the
 * options page, the popup and the background worker all read from this list.
 */

import { TAB_SCOPES, USER_INDEX_PATTERN } from "./constants.js";

/**
 * Hosts we must never interrupt. accounts.google.com is where sign-in and
 * account switching actually happen, so intercepting it would trap the user in
 * a loop. The rest are asset or API hosts that occasionally load in a top frame.
 */
const NEVER_INTERCEPT = [
  "accounts.google.com",
  "accounts.youtube.com",
  "content.googleapis.com",
  "apis.google.com",
  "ogs.google.com",
  "googleusercontent.com",
];

/**
 * Landing hosts that exist only to bounce somewhere else, and the place they go.
 *
 * We resolve these ourselves rather than letting the redirect happen, because
 * the redirect is a fixed URL that **discards the query string**:
 *
 *   sheets.google.com/?authuser=me@example.com
 *     -> docs.google.com/spreadsheets?usp=direct_url      (account lost)
 *
 * Rewriting the entry URL would therefore prompt the user and then throw their
 * answer away. Resolving first means the account lands on the URL that survives.
 */
const HOST_ALIASES = {
  // gmail.com only redirects while the URL is bare. Append anything and it 404s
  // outright, so the account has to be applied to mail.google.com instead.
  "gmail.com": "https://mail.google.com/mail/",
  "www.gmail.com": "https://mail.google.com/mail/",
  "sheets.google.com": "https://docs.google.com/spreadsheets",
  "slides.google.com": "https://docs.google.com/presentation",
  "forms.google.com": "https://docs.google.com/forms",
  "accounts.google.com": "https://myaccount.google.com/",
  // Bare docs.google.com lands on Docs, so name the app rather than leaving a
  // key that matches nothing else on the host.
  "docs.google.com": "https://docs.google.com/document",
};

/**
 * Resolve an alias, but only for the bare landing page.
 *
 * Any deeper path is a real page rather than a signpost, and on
 * accounts.google.com specifically it is part of a sign-in or account-switching
 * flow that must be left alone. A query string means the same thing: something
 * is already in progress.
 */
function resolveAlias(parsed) {
  const target = HOST_ALIASES[parsed.hostname.toLowerCase()];
  if (!target || parsed.pathname !== "/" || parsed.search) return null;
  return new URL(target);
}

/**
 * Google Search runs on well over a hundred country domains (google.co.uk,
 * google.com.pk, ...). A pattern is far more maintainable than a host list.
 */
const SEARCH_HOST = /^(www\.)?google\.(com|[a-z]{2}|com?\.[a-z]{2}|co\.[a-z]{2})$/;

/**
 * Catalogue entries.
 *
 *   id            stable key used in stored settings, never rename it
 *   hosts         exact hostnames, or "*.example.com" to include subdomains
 *   test          optional predicate for hosts a literal list cannot express
 *   defaultOn     whether the entry is intercepted before the user touches it
 */
export const DOMAIN_CATALOG = [
  // Everyday surfaces where picking the wrong account costs the most time.
  { id: "gmail", label: "Gmail", group: "Core", hosts: ["mail.google.com", "gmail.com", "www.gmail.com"], defaultOn: true },
  { id: "drive", label: "Drive", group: "Core", hosts: ["drive.google.com"], defaultOn: true },
  // sheets/slides/forms.google.com are real hosts that 301 to docs.google.com.
  // The redirect is server-side, so it never produces a second navigation event:
  // if we do not catch the entry host, there is no second chance to catch it.
  //
  // `appScope` marks a host that serves several distinct products under its
  // first path segment (/document, /spreadsheets, /presentation, /forms). Only
  // such hosts get the finer treatment: on the Cloud console, for instance,
  // /compute and /home are sections of one product, not separate products, so it
  // stays host-scoped.
  {
    id: "docs",
    label: "Docs, Sheets, Slides, Forms",
    group: "Core",
    hosts: ["docs.google.com", "sheets.google.com", "slides.google.com", "forms.google.com"],
    appScope: true,
    defaultOn: true,
  },
  { id: "forms-short", label: "Form short links (forms.gle)", group: "Core", hosts: ["forms.gle"], defaultOn: true },
  { id: "calendar", label: "Calendar", group: "Core", hosts: ["calendar.google.com"], defaultOn: true },
  { id: "keep", label: "Keep", group: "Core", hosts: ["keep.google.com"], defaultOn: true },
  { id: "contacts", label: "Contacts", group: "Core", hosts: ["contacts.google.com"], defaultOn: true },
  { id: "photos", label: "Photos", group: "Core", hosts: ["photos.google.com"], defaultOn: true },

  // Collaboration and administration.
  { id: "meet", label: "Meet", group: "Workspace", hosts: ["meet.google.com"], defaultOn: true },
  { id: "chat", label: "Chat", group: "Workspace", hosts: ["chat.google.com"], defaultOn: true },
  { id: "groups", label: "Groups", group: "Workspace", hosts: ["groups.google.com"], defaultOn: true },
  { id: "classroom", label: "Classroom", group: "Workspace", hosts: ["classroom.google.com"], defaultOn: true },
  { id: "sites", label: "Sites", group: "Workspace", hosts: ["sites.google.com"], defaultOn: true },
  { id: "admin", label: "Admin console", group: "Workspace", hosts: ["admin.google.com"], defaultOn: true },
  { id: "myaccount", label: "Account settings", group: "Workspace", hosts: ["myaccount.google.com"], defaultOn: true },
  { id: "voice", label: "Voice", group: "Workspace", hosts: ["voice.google.com"], defaultOn: true },
  { id: "messages", label: "Messages", group: "Workspace", hosts: ["messages.google.com"], defaultOn: true },
  { id: "one", label: "One and Takeout", group: "Workspace", hosts: ["one.google.com", "takeout.google.com"], defaultOn: true },
  { id: "pay", label: "Pay", group: "Workspace", hosts: ["pay.google.com"], defaultOn: true },

  // Developer and business consoles, all of which are strictly per-account.
  { id: "cloud", label: "Cloud console", group: "Developer", hosts: ["console.cloud.google.com", "console.developers.google.com"], defaultOn: true },
  { id: "script", label: "Apps Script", group: "Developer", hosts: ["script.google.com"], defaultOn: true },
  { id: "analytics", label: "Analytics", group: "Developer", hosts: ["analytics.google.com"], defaultOn: true },
  { id: "search-console", label: "Search Console", group: "Developer", hosts: ["search.google.com"], defaultOn: true },
  { id: "ads", label: "Ads and AdSense", group: "Developer", hosts: ["ads.google.com", "adsense.google.com"], defaultOn: true },
  { id: "firebase", label: "Firebase", group: "Developer", hosts: ["console.firebase.google.com"], defaultOn: true },
  { id: "tagmanager", label: "Tag Manager", group: "Developer", hosts: ["tagmanager.google.com"], defaultOn: true },
  { id: "looker", label: "Looker Studio", group: "Developer", hosts: ["lookerstudio.google.com", "datastudio.google.com"], defaultOn: true },
  { id: "colab", label: "Colab", group: "Developer", hosts: ["colab.research.google.com"], defaultOn: true },
  { id: "aistudio", label: "AI Studio", group: "Developer", hosts: ["aistudio.google.com"], defaultOn: true },
  { id: "gemini", label: "Gemini and NotebookLM", group: "Developer", hosts: ["gemini.google.com", "notebooklm.google.com", "notebook.google.com"], defaultOn: true },

  // Public-facing surfaces. These are usually browsed signed-in-agnostic, so
  // they stay off until the user opts in. "Google Search" is the toggle people
  // most often want, which is why it sits first in the group.
  { id: "search", label: "Google Search (google.com)", group: "General", hosts: [], test: SEARCH_HOST, defaultOn: false },
  { id: "youtube", label: "YouTube", group: "General", hosts: ["*.youtube.com", "youtube.com", "youtu.be"], defaultOn: false },
  { id: "maps", label: "Maps", group: "General", hosts: ["maps.google.com"], defaultOn: false },
  { id: "news", label: "News", group: "General", hosts: ["news.google.com"], defaultOn: false },
  { id: "play", label: "Play", group: "General", hosts: ["play.google.com"], defaultOn: false },

  // Safety net for the surfaces Google keeps adding. It must stay last: the
  // first matching entry wins, so every named surface above keeps its own
  // toggle and only genuinely unknown google.com hosts land here.
  {
    id: "other-google",
    label: "Any other google.com page",
    group: "General",
    hosts: [],
    test: /(^|\.)google\.com$/,
    defaultOn: false,
  },
];

/** Catalogue grouped for rendering, in the order the groups are declared. */
export const DOMAIN_GROUPS = ["Core", "Workspace", "Developer", "General"];

const catalogById = new Map(DOMAIN_CATALOG.map((entry) => [entry.id, entry]));

export function getDomainEntry(id) {
  return catalogById.get(id) ?? null;
}

/** True when `host` is the pattern host or a subdomain of it. */
function hostMatchesPattern(host, pattern) {
  if (pattern.startsWith("*.")) {
    const base = pattern.slice(2);
    return host === base || host.endsWith(`.${base}`);
  }
  return host === pattern;
}

export function isNeverIntercepted(host) {
  // Wrapping each entry as "*.host" covers the host itself and its subdomains.
  return NEVER_INTERCEPT.some((pattern) => hostMatchesPattern(host, `*.${pattern}`));
}

/**
 * The key a tab's answer is filed under: the unit of "I already answered this".
 *
 * In `app` mode that is the product — the host, plus its first path segment when
 * the host serves several products. In `document` mode it is the individual file,
 * identified by the id Google puts after /d/ (or /d/e/ for a published form).
 * Both deliberately ignore the /u/<n>/ segment, since that names the account we
 * are in the middle of deciding.
 */
export function scopeKey({ url, host, entry, mode = TAB_SCOPES.APP }) {
  let path;
  try {
    path = new URL(url).pathname.replace(USER_INDEX_PATTERN, "");
  } catch {
    return host;
  }

  if (mode === TAB_SCOPES.DOCUMENT) {
    const file = path.match(/\/d\/(?:e\/)?([^/]+)/);
    if (file) return `${host}/${file[1]}`;
    // No file in the URL, so the page itself is the unit.
    return `${host}${path.replace(/\/+$/, "")}`;
  }

  if (!entry?.appScope) return host;
  const [segment] = path.split("/").filter(Boolean);
  return segment ? `${host}/${segment}` : host;
}

/** The user-added pattern covering this host, or null. Wildcards allowed. */
export function findCustomDomain(host, customDomains = []) {
  return customDomains.find((pattern) => hostMatchesPattern(host, pattern)) ?? null;
}

/** Find the catalogue entry that claims this host, or null. */
export function findCatalogEntry(host) {
  for (const entry of DOMAIN_CATALOG) {
    if (entry.hosts.some((pattern) => hostMatchesPattern(host, pattern))) return entry;
    if (entry.test?.test(host)) return entry;
  }
  return null;
}

/** Whether the user has switched a catalogue entry on, honouring its default. */
export function isEntryEnabled(entry, state) {
  const override = state.domainOverrides?.[entry.id];
  return typeof override === "boolean" ? override : entry.defaultOn;
}

/**
 * The single question the background worker asks per navigation: should this URL
 * be held back for an account choice?
 *
 * Returns a small descriptor rather than a bare boolean so callers can explain
 * the decision in the UI ("matched: Drive") without re-running the match.
 */
export function matchNavigation(url, state) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { intercept: false, reason: "unparsable" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { intercept: false, reason: "scheme" };
  }

  // A signpost host stands in for where it points, and everything below judges
  // the destination rather than the signpost.
  const effective = resolveAlias(parsed) ?? parsed;
  const host = effective.hostname.toLowerCase();
  const resolvedUrl = effective.toString();

  if (isNeverIntercepted(host)) return { intercept: false, reason: "protected-host" };

  // User-declared hosts win over the catalogue: a Workspace vanity domain such
  // as mail.mycompany.com should be honoured even though it is not a *.google.com.
  const custom = findCustomDomain(host, state.customDomains);
  if (custom) return { intercept: true, host, url: resolvedUrl, source: "custom", label: custom };

  const entry = findCatalogEntry(host);
  if (!entry) return { intercept: false, reason: "not-google", host };
  if (!isEntryEnabled(entry, state)) return { intercept: false, reason: "disabled", host, entry };

  return { intercept: true, host, url: resolvedUrl, source: "catalog", entry, label: entry.label };
}
