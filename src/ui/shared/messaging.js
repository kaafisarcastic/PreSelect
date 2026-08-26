/**
 * One place that knows the message envelope, so every page talks to the service
 * worker the same way and unwraps errors into real exceptions.
 */

import { MSG } from "../../common/constants.js";

export async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error ?? "The extension did not respond.");
  return response;
}

export const getState = () => send(MSG.GET_STATE).then((response) => response.state);
export const setState = (state) => send(MSG.SET_STATE, { state });
export const discoverAccounts = (force = false) => send(MSG.DISCOVER_ACCOUNTS, { force });
export const resolveNavigation = (payload) => send(MSG.RESOLVE_NAVIGATION, payload);
export const cancelNavigation = (tabId) => send(MSG.CANCEL_NAVIGATION, { tabId });
