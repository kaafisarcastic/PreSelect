/**
 * Thin, typed-by-convention wrapper around chrome.storage.
 *
 * Settings live in `sync` so an account list follows the user between machines.
 * Nothing secret is stored: only e-mail addresses, labels and toggles. Session
 * state (which tab already answered the prompt) lives in `session` and dies with
 * the browser, which is exactly the lifetime we want for it.
 */

import { STORAGE_KEY, DEFAULT_STATE, DEFAULT_BEHAVIOR, ACCOUNT_COLORS } from "./constants.js";

/**
 * Merge stored state over the defaults so new settings appear on upgrade.
 *
 * `tabScope` replaced an older `rememberPerTab` boolean, and that boolean is
 * deliberately not carried forward. Its false state meant "ask on every single
 * navigation", which re-asked even on a reload: a broken mode nobody chose as a
 * preference, only ever flipped while working out what the setting did. Mapping
 * it onto the stricter new scope would preserve an accident, so anyone upgrading
 * simply lands on the default and can opt into per-document deliberately.
 */
function hydrate(stored) {
  if (!stored || typeof stored !== "object") return structuredClone(DEFAULT_STATE);
  return {
    ...structuredClone(DEFAULT_STATE),
    ...stored,
    behavior: { ...DEFAULT_BEHAVIOR, ...(stored.behavior ?? {}) },
    accounts: Array.isArray(stored.accounts) ? stored.accounts : [],
  };
}

export async function loadState() {
  const bag = await chrome.storage.sync.get(STORAGE_KEY);
  return hydrate(bag[STORAGE_KEY]);
}

export async function saveState(state) {
  await chrome.storage.sync.set({ [STORAGE_KEY]: state });
  return state;
}

/**
 * Read-modify-write helper. Every mutation in the extension goes through here so
 * concurrent writers (popup and options page open at once) cannot drop fields.
 */
export async function updateState(mutator) {
  const state = await loadState();
  const next = (await mutator(state)) ?? state;
  return saveState(next);
}

/** Call `listener` whenever the stored settings change from anywhere. */
export function onStateChanged(listener) {
  const handler = (changes, area) => {
    if (area !== "sync" || !changes[STORAGE_KEY]) return;
    listener(hydrate(changes[STORAGE_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

/* ------------------------------------------------------------------ session */

export async function readSession(key, fallback = {}) {
  const bag = await chrome.storage.session.get(key);
  return bag[key] ?? fallback;
}

export async function writeSession(key, value) {
  await chrome.storage.session.set({ [key]: value });
}

/* ----------------------------------------------------------------- accounts */

/** A stable id derived from the e-mail, so re-adding an account is idempotent. */
export function accountId(email) {
  return `acc:${email.trim().toLowerCase()}`;
}

/** Normalise anything account-shaped into the record we persist. */
export function makeAccount({ email, label, index = null, signedIn = true, source = "manual" }, existingCount = 0) {
  const normalizedEmail = email.trim().toLowerCase();
  return {
    id: accountId(normalizedEmail),
    email: normalizedEmail,
    label: (label ?? "").trim() || normalizedEmail.split("@")[0],
    index: Number.isInteger(index) ? index : null,
    signedIn,
    source,
    color: ACCOUNT_COLORS[existingCount % ACCOUNT_COLORS.length],
  };
}

/**
 * Give every account a distinct colour, without moving one an account already
 * has. Colours are how a row is recognised at a glance, so stability matters
 * more than filling the palette in order.
 */
function assignColors(accounts) {
  const used = new Set();
  return accounts.map((account, position) => {
    if (account.color && !used.has(account.color)) {
      used.add(account.color);
      return account;
    }
    const free = ACCOUNT_COLORS.find((color) => !used.has(color)) ?? ACCOUNT_COLORS[position % ACCOUNT_COLORS.length];
    used.add(free);
    return { ...account, color: free };
  });
}

/**
 * Merge a freshly discovered account list into the stored one.
 *
 * Discovery is authoritative about who is signed in and about session indexes,
 * but it must never destroy accounts the user typed in by hand: those are the
 * signed-out accounts we still want to offer. So stored accounts survive, and
 * anything Google no longer reports is simply marked as signed out.
 */
export function mergeDiscoveredAccounts(stored, discovered) {
  const byId = new Map(stored.map((account) => [account.id, { ...account, signedIn: false, index: null }]));

  for (const raw of discovered) {
    const id = accountId(raw.email);
    const existing = byId.get(id);
    const merged = makeAccount(
      {
        email: raw.email,
        // A label the user typed is theirs to keep; Google's is only a default.
        label: existing?.label ?? raw.label,
        index: raw.index,
        // Google reports expired sessions too, and those are signed out.
        signedIn: raw.signedIn !== false,
        source: existing?.source ?? "auto",
      },
      byId.size,
    );
    // Keep the colour an account was first given; it is how users recognise it.
    byId.set(id, { ...merged, color: existing?.color ?? merged.color });
  }

  // Signed-in accounts first, then by session index, then alphabetically.
  const ordered = [...byId.values()].sort((a, b) => {
    if (a.signedIn !== b.signedIn) return a.signedIn ? -1 : 1;
    if (a.index != null && b.index != null) return a.index - b.index;
    return a.email.localeCompare(b.email);
  });

  return assignColors(ordered);
}
