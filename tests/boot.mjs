/**
 * Boot check: load the service worker against a stubbed chrome API.
 *
 * The worker registers every listener at module scope, so simply importing it
 * catches a missing import, a typo in an API name, or an API used without the
 * manifest granting it — all of which otherwise surface as a blank "Unknown"
 * error in chrome://extensions with no stack to read.
 *
 * Run with `node tests/boot.mjs`.
 */

import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const granted = new Set(manifest.permissions);
const registered = [];

const event = (name) => ({ addListener: () => registered.push(name) });
const storageArea = () => ({ get: async () => ({}), set: async () => {}, remove: async () => {} });

const api = {
  runtime: {
    onMessage: event("runtime.onMessage"),
    onInstalled: event("runtime.onInstalled"),
    onStartup: event("runtime.onStartup"),
    getURL: (path) => `chrome-extension://stub/${path}`,
    openOptionsPage() {},
    lastError: null,
  },
  storage: { sync: storageArea(), session: storageArea(), local: storageArea(), onChanged: event("storage.onChanged") },
  tabs: {
    onRemoved: event("tabs.onRemoved"),
    query: async () => [],
    create: async () => ({ id: 1 }),
    update: async () => {},
    goBack: async () => {},
    remove: async () => {},
  },
  webNavigation: {
    onBeforeNavigate: event("webNavigation.onBeforeNavigate"),
    onCommitted: event("webNavigation.onCommitted"),
    onCreatedNavigationTarget: event("webNavigation.onCreatedNavigationTarget"),
  },
  contextMenus: { onClicked: event("contextMenus.onClicked"), removeAll: async () => {}, create: () => {} },
  commands: { onCommand: event("commands.onCommand"), getAll: async () => [] },
  declarativeNetRequest: { updateSessionRules: async () => {}, getSessionRules: async () => [] },
  alarms: { create: () => {}, onAlarm: event("alarms.onAlarm") },
};

globalThis.chrome = new Proxy(api, {
  get(target, prop) {
    if (!(prop in target)) throw new Error(`chrome.${String(prop)} is used but this stub does not provide it`);
    if (prop === "contextMenus" && !granted.has("contextMenus")) {
      throw new Error("chrome.contextMenus used, but the permission is missing from manifest.json");
    }
    if (prop === "commands" && !manifest.commands) {
      throw new Error("chrome.commands used, but manifest.json has no commands block");
    }
    return target[prop];
  },
});

await import("../src/background/service-worker.js");

console.log("service worker booted, listeners registered:");
for (const name of registered) console.log("  " + name);
console.log(`\ncommands declared: ${Object.keys(manifest.commands ?? {}).join(", ") || "none"}`);
