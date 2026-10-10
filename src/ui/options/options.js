/**
 * Settings page.
 *
 * Keeps one working copy of the state, mutates it in place and pushes the whole
 * object back through the service worker on every change. The state is a few
 * kilobytes at most, so a full write is simpler and safer than patching, and it
 * gives the worker one place to invalidate its caches.
 */

import { DOMAIN_CATALOG, DOMAIN_GROUPS, isEntryEnabled } from "../../common/domains.js";
import { makeAccount, accountId } from "../../common/storage.js";
import { el, qs, render, initial } from "../shared/dom.js";
import { getState, setState, discoverAccounts } from "../shared/messaging.js";

let state = null;

/** Persist the working copy, then redraw whatever the change could affect. */
async function commit(redraw = drawAll) {
  await setState(state);
  redraw();
}

function setStatus(node, message, tone = "info") {
  node.textContent = message;
  node.dataset.tone = tone;
}

/* ------------------------------------------------------------------ accounts */

function accountRow(account) {
  return el("div", { class: "row" }, [
    el("span", {
      class: "avatar",
      style: account.signedIn ? `background:${account.color}` : "",
      text: initial(account),
    }),
    el("div", { class: "row__text" }, [
      el("div", { class: "row__title" }, [
        el("span", { text: account.label }),
        account.signedIn
          ? el("span", { class: "badge", text: account.index != null ? `Signed in · u/${account.index}` : "Signed in" })
          : el("span", { class: "badge", text: "Signed out" }),
      ]),
      el("div", { class: "row__sub", text: account.email }),
    ]),
    el("input", {
      class: "input row__label-input",
      type: "text",
      value: account.label,
      "aria-label": `Label for ${account.email}`,
      onchange: (event) => {
        account.label = event.target.value.trim() || account.email.split("@")[0];
        commit();
      },
    }),
    el("button", {
      class: "button button--danger",
      type: "button",
      text: "Remove",
      onclick: () => removeAccount(account),
    }),
  ]);
}

function removeAccount(account) {
  state.accounts = state.accounts.filter((candidate) => candidate.id !== account.id);
  if (state.defaultAccountId === account.id) state.defaultAccountId = null;
  // Rules pointing at a removed account would silently do nothing, so drop them.
  state.siteRules = Object.fromEntries(
    Object.entries(state.siteRules).filter(([, id]) => id !== account.id),
  );
  commit();
}

function drawAccounts() {
  render(qs("#account-list"), state.accounts.map(accountRow));
  qs("#account-empty").hidden = state.accounts.length > 0;
}

function drawDefaultAccount() {
  const select = qs("#default-account");
  render(select, [
    el("option", { value: "", text: "Always ask" }),
    ...state.accounts.map((account) =>
      el("option", { value: account.id, text: `${account.label} (${account.email})` }),
    ),
  ]);
  select.value = state.defaultAccountId ?? "";
}

/* ------------------------------------------------------------------- domains */

function domainToggle(entry) {
  return el("label", { class: "toggle" }, [
    el("input", {
      type: "checkbox",
      checked: isEntryEnabled(entry, state),
      onchange: (event) => {
        state.domainOverrides[entry.id] = event.target.checked;
        commit(() => {});
      },
    }),
    el("span", { text: entry.label }),
  ]);
}

function drawDomains() {
  const groups = DOMAIN_GROUPS.map((group) => {
    const entries = DOMAIN_CATALOG.filter((entry) => entry.group === group);
    if (!entries.length) return null;
    return el("div", { class: "group" }, [
      el("p", { class: "group__title", text: group }),
      el("div", { class: "group__items" }, entries.map(domainToggle)),
    ]);
  });

  render(qs("#domain-groups"), groups);
}

// Other hosts UI (1 of 3): hidden for now, see options.html.
// function drawCustomDomains() {
//   render(
//     qs("#custom-domains"),
//     state.customDomains.map((pattern) =>
//       el("span", { class: "chip" }, [
//         el("span", { text: pattern }),
//         el("button", {
//           type: "button",
//           text: "×",
//           "aria-label": `Remove ${pattern}`,
//           onclick: () => {
//             state.customDomains = state.customDomains.filter((candidate) => candidate !== pattern);
//             commit();
//           },
//         }),
//       ]),
//     ),
//   );
// }

/* --------------------------------------------------------------- site rules */

function drawRules() {
  const entries = Object.entries(state.siteRules ?? {});
  const rows = entries.map(([host, id]) => {
    const account = state.accounts.find((candidate) => candidate.id === id);
    return el("div", { class: "row" }, [
      el("div", { class: "row__text" }, [
        el("div", { class: "row__title" }, [el("span", { class: "mono", text: host })]),
        el("div", { class: "row__sub", text: account ? account.email : "Account no longer configured" }),
      ]),
      el("button", {
        class: "button button--danger",
        type: "button",
        text: "Remove",
        onclick: () => {
          delete state.siteRules[host];
          commit();
        },
      }),
    ]);
  });

  render(qs("#rule-list"), rows);
  qs("#rule-empty").hidden = entries.length > 0;
}

/* ------------------------------------------------------------------ wiring */

/**
 * What each choice actually does, in terms of what the user will see happen.
 * Shown for the selected option only: a description of the setting in general is
 * no use when what you want to know is what the thing you just picked will do.
 */
const TAB_SCOPE_HINTS = {
  app: "Best when you work in one account at a time. Choosing an account for Sheets covers every sheet you open in that tab, and Docs, Gmail and Drive each ask once of their own. Fewer interruptions, but a document belonging to another account opens under the one you already picked.",
  document: "Best when documents from several accounts arrive mixed together: a client link, then a work sheet, then a personal one. Each document asks, so a previous answer never carries over to the next. Reloading a document, or moving around inside it, still does not ask.",
};

function drawTabScope() {
  const select = qs("#tab-scope");
  select.value = state.behavior.tabScope;
  qs("#tab-scope-hint").textContent = TAB_SCOPE_HINTS[select.value] ?? "";
}

/**
 * Show which key reaches which account.
 *
 * The keys are bound to positions, not to accounts, so this is read from the
 * live list rather than stored anywhere. Chrome owns the actual bindings, which
 * is why the user is sent to its own shortcuts page to change them.
 */
async function drawShortcuts() {
  const wrap = qs("#shortcuts");
  const visible = state.behavior.showSignedOutAccounts
    ? state.accounts
    : state.accounts.filter((account) => account.signedIn);

  const commands = await chrome.commands.getAll();
  const bound = new Map(commands.map((command) => [command.name, command.shortcut]));

  const rows = visible.slice(0, 4).flatMap((account, position) => {
    const row = (command, verb) => {
      const key = bound.get(`${command}-account-${position + 1}`);
      return el("div", { class: "shortcuts__row" }, [
        el("kbd", { class: "shortcuts__key", text: key || "unassigned" }),
        el("span", { class: "shortcuts__name", text: `${verb} ${account.label}` }),
        el("span", { class: "shortcuts__email muted", text: account.email }),
      ]);
    };
    return [row("switch", "Switch to"), row("open", "New tab as")];
  });

  wrap.hidden = rows.length === 0;
  render(qs("#shortcut-list"), rows);
}

function drawBehavior() {
  // Only the boolean settings are rendered as switches; anything else in the
  // behaviour bag has its own control and is drawn below.
  for (const [key, value] of Object.entries(state.behavior)) {
    const input = qs(`#behavior-${key}`);
    if (input && typeof value === "boolean") input.checked = value;
  }
  drawTabScope();
}

function drawAll() {
  drawAccounts();
  drawShortcuts().catch(() => {});
  drawDefaultAccount();
  drawDomains();
  // Other hosts UI (2 of 3): hidden for now, see options.html.
  // drawCustomDomains();
  drawRules();
  drawBehavior();
}

function bindEvents() {
  qs("#add-account").addEventListener("submit", (event) => {
    event.preventDefault();
    const status = qs("#account-status");
    const email = qs("#new-email").value.trim().toLowerCase();
    const label = qs("#new-label").value;

    if (!email.includes("@")) {
      setStatus(status, "Enter a full e-mail address.", "error");
      return;
    }
    if (state.accounts.some((account) => account.id === accountId(email))) {
      setStatus(status, "That account is already on the list.", "error");
      return;
    }

    // Manually added accounts are assumed signed out until discovery says
    // otherwise; that is what makes them useful in the first place.
    state.accounts.push(makeAccount({ email, label, signedIn: false }, state.accounts.length));
    qs("#add-account").reset();
    setStatus(status, "Added.");
    commit();
  });

  qs("#refresh-accounts").addEventListener("click", async () => {
    const status = qs("#account-status");
    setStatus(status, "Checking Google for signed-in accounts…");
    try {
      await discoverAccounts(true);
      state = await getState();
      drawAll();
      const signedIn = state.accounts.filter((account) => account.signedIn).length;
      setStatus(status, `${signedIn} signed-in account${signedIn === 1 ? "" : "s"} found.`);
    } catch (error) {
      setStatus(status, error.message, "error");
    }
  });

  qs("#default-account").addEventListener("change", (event) => {
    state.defaultAccountId = event.target.value || null;
    commit(() => {});
  });

  // Chrome owns the bindings, so editing them happens on its own page.
  qs("#edit-shortcuts").addEventListener("click", () => {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  });

  qs("#tab-scope").addEventListener("change", (event) => {
    state.behavior.tabScope = event.target.value;
    // Redraw only the hint, so the description follows the selection immediately.
    commit(drawTabScope);
  });

  for (const [key, value] of Object.entries(state.behavior)) {
    if (typeof value !== "boolean") continue;
    qs(`#behavior-${key}`)?.addEventListener("change", (event) => {
      state.behavior[key] = event.target.checked;
      commit(() => {});
    });
  }

  qs("#domains-all").addEventListener("click", () => {
    for (const entry of DOMAIN_CATALOG) state.domainOverrides[entry.id] = true;
    commit();
  });

  qs("#domains-none").addEventListener("click", () => {
    for (const entry of DOMAIN_CATALOG) state.domainOverrides[entry.id] = false;
    commit();
  });

  // Other hosts UI (3 of 3): hidden for now, see options.html.
  // qs("#add-domain").addEventListener("submit", (event) => {
  //   event.preventDefault();
  //   const input = qs("#new-domain");
  //   const pattern = input.value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  //   if (!pattern || !pattern.includes(".")) return;
  //   if (!state.customDomains.includes(pattern)) state.customDomains.push(pattern);
  //   input.value = "";
  //   commit();
  // });
}

async function init() {
  state = await getState();
  drawAll();
  bindEvents();
}

init();
