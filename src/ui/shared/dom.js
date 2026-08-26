/**
 * Minimal DOM helpers. The extension has no build step and no framework, so
 * these two functions stand in for one: `el` builds elements declaratively and
 * always sets text through textContent, which keeps account labels and URLs from
 * ever being interpreted as markup.
 */

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? "" : value);
  }

  for (const child of [children].flat()) {
    if (child == null || child === false) continue;
    node.append(child);
  }
  return node;
}

export const qs = (selector, root = document) => root.querySelector(selector);

/** Replace a container's contents in one paint. */
export function render(container, children) {
  container.replaceChildren(...[children].flat().filter(Boolean));
}

/** First letter of a label, used for the avatar disc. */
export const initial = (account) => (account.label || account.email || "?").trim().charAt(0);
