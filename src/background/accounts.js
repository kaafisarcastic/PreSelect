/**
 * Discovery of the Google accounts the browser is currently signed into.
 *
 * Chrome gives extensions no API for "which Google accounts does this profile
 * have?", so we ask Google the same way its own products do: ListAccounts, the
 * endpoint the account switcher itself is built on. It answers with the multi
 * login session for whatever cookies the browser already holds.
 *
 * This is an internal endpoint, so every part of the parse is defensive and a
 * failure here is never fatal: the user can always add accounts by hand, and a
 * failed refresh leaves the previously known list intact.
 */

/**
 * Two things about this endpoint are easy to get wrong:
 *
 *   - It only answers POST. A GET is rejected with 400.
 *   - It allowlists the Origin header and answers 403 to anything unfamiliar,
 *     including `chrome-extension://`, which our fetch would otherwise send.
 *     `ensureOriginRule` below rewrites that one header for this one URL.
 *
 * The empty body is deliberate; the browser's own cookies carry everything
 * Google needs to answer.
 */
const LIST_ACCOUNTS_URL =
  "https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Google occasionally prefixes JSON with an anti-hijacking guard. */
function stripJsonGuard(text) {
  const start = text.indexOf("[");
  return start === -1 ? text : text.slice(start);
}

/**
 * Field positions in an account row, as Chromium's own parser reads them.
 * Useful because position 9 carries the piece nothing else reveals: whether the
 * session is still valid. Google lists accounts whose session has expired, which
 * is precisely the "known but signed out" case we want to offer.
 */
const ROW_MARKER = "gaia.l.a";
const ROW = { label: 2, email: 3, valid: 9 };

/** Read a row by position, but only when it really looks like an account row. */
function readByPosition(row) {
  if (row[0] !== ROW_MARKER) return null;
  const email = row[ROW.email];
  if (typeof email !== "string" || !EMAIL_PATTERN.test(email)) return null;

  return {
    email: email.toLowerCase(),
    label: typeof row[ROW.label] === "string" ? row[ROW.label] : "",
    // Anything other than an explicit zero is treated as a live session.
    signedIn: row[ROW.valid] !== 0,
  };
}

/**
 * Fallback for a payload whose shape has shifted: find the e-mail anywhere in
 * the row and take the string before it as the display name. Validity cannot be
 * located this way, so such accounts are assumed to be signed in.
 */
function readByScan(row) {
  const emailAt = row.findIndex((value) => typeof value === "string" && EMAIL_PATTERN.test(value));
  if (emailAt === -1) return null;

  const previous = row[emailAt - 1];
  return {
    email: row[emailAt].toLowerCase(),
    label: typeof previous === "string" && !EMAIL_PATTERN.test(previous) ? previous : "",
    signedIn: true,
  };
}

/**
 * Pull the account list out of the deeply nested ListAccounts payload.
 *
 * The session index Google uses in `/u/<n>/` is the row's absolute position, so
 * expired rows still occupy a slot and the count must not skip them. They get no
 * index of their own though: an expired session cannot be opened by number, it
 * has to go through sign-in first.
 */
function extractAccounts(payload) {
  const found = [];
  const seen = new Set();

  const walk = (node) => {
    if (!Array.isArray(node)) return;

    const account = readByPosition(node) ?? readByScan(node);
    if (!account) {
      node.forEach(walk);
      return;
    }
    if (seen.has(account.email)) return;

    seen.add(account.email);
    found.push({ ...account, index: account.signedIn ? found.length : null });
  };

  walk(payload);
  return found;
}

/**
 * Rule id for the Origin rewrite. Session-scoped, so it lives no longer than the
 * browser session and never persists to disk.
 */
const ORIGIN_RULE_ID = 1;

/**
 * Install the Origin rewrite, narrowed to requests that come from no tab at all.
 *
 * That condition is the important part. Without it the rule would also rewrite
 * the Origin of a request made by any website to this endpoint, handing pages an
 * origin Google trusts. `tabIds: [-1]` matches only requests with no originating
 * tab, which is what a service worker fetch is and what a page's fetch can never
 * be. Session rules are the only kind that can express it.
 */
async function ensureOriginRule() {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ORIGIN_RULE_ID],
    addRules: [
      {
        id: ORIGIN_RULE_ID,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "origin", operation: "set", value: "https://accounts.google.com" }],
        },
        condition: {
          urlFilter: "||accounts.google.com/ListAccounts",
          tabIds: [-1],
          resourceTypes: ["xmlhttprequest", "other"],
        },
      },
    ],
  });
}

/** Ask ListAccounts. The precise source: ordering, and expired sessions. */
async function viaListAccounts() {
  await ensureOriginRule();

  const response = await fetch(LIST_ACCOUNTS_URL, {
    method: "POST",
    body: "",
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`Google returned ${response.status} while listing accounts.`);

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(stripJsonGuard(text));
  } catch {
    throw new Error("Google's account list could not be read.");
  }

  return extractAccounts(payload);
}

/**
 * Fallback: the sign-out page, whose entire job is to list the accounts you are
 * signed into. It is an ordinary HTML page rather than an allowlisted XHR
 * endpoint, so it answers requests the strict endpoint refuses.
 *
 * Only e-mail addresses can be recovered this way. There is no session index and
 * no validity flag, which is fine: without an index PreSelect addresses accounts
 * by e-mail anyway, and a signed-out account would not be listed here at all.
 */
const SIGN_OUT_OPTIONS_URL = "https://accounts.google.com/SignOutOptions?hl=en";

/** Addresses Google's own pages mention that are nobody's account. */
const NOT_AN_ACCOUNT = /^(no-?reply|postmaster|abuse|support|info)@/;

async function viaSignOutOptions() {
  const response = await fetch(SIGN_OUT_OPTIONS_URL, { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error(`Google returned ${response.status} for the sign-out page.`);

  const html = await response.text();
  const emails = new Set(
    (html.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [])
      .map((email) => email.toLowerCase())
      .filter((email) => !NOT_AN_ACCOUNT.test(email)),
  );

  return [...emails].map((email) => ({ email, label: "", index: null, signedIn: true }));
}

/**
 * Ask Google who is signed in.
 *
 * Resolves to an array, which is legitimately empty when the browser is signed
 * out of everything. Throws only when both sources fail, with a message the UI
 * can show verbatim.
 */
export async function discoverSignedInAccounts() {
  try {
    return await viaListAccounts();
  } catch (error) {
    // Losing the precise source costs ordering, not the feature. Only report the
    // original failure if the simpler page cannot tell us anything either.
    const fallback = await viaSignOutOptions().catch(() => null);
    if (fallback?.length) return fallback;

    throw new Error(
      error instanceof TypeError
        ? "Could not reach accounts.google.com. Check your connection."
        : `${error.message} You can add accounts by hand below.`,
    );
  }
}
