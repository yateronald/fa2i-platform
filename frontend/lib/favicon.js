/**
 * Favicon (browser tab icon) utilities.
 *
 * The default tab icon is the FA2I logo. When an association user is connected,
 * the tab icon is swapped to that association's logo.
 *
 * IMPORTANT: we never remove the <link rel="icon"> tags that Next.js renders
 * from the route metadata — those are owned by React, and deleting them out
 * from under it crashes the page ("Cannot read properties of null (reading
 * 'removeChild')"). Instead we manage a single dedicated link element of our
 * own, identified by a stable id, and only ever update its href. Because the
 * browser uses the last icon link in document order, our appended element wins.
 */

export const DEFAULT_FAVICON = '/fa2i-logo.jpg';

const DYNAMIC_FAVICON_ID = 'fa2i-dynamic-favicon';

/**
 * Set the document's favicon (the icon shown in the browser tab / onglet).
 *
 * Updates a single link element that we own — it never touches the metadata
 * links managed by Next.js/React.
 *
 * @param {string} href Absolute or root-relative URL of the icon image.
 */
export function setFavicon(href) {
  if (typeof document === 'undefined' || !href) return;

  let link = document.getElementById(DYNAMIC_FAVICON_ID);
  if (!link) {
    link = document.createElement('link');
    link.id = DYNAMIC_FAVICON_ID;
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  if (link.getAttribute('href') !== href) {
    link.setAttribute('href', href);
  }
}

/**
 * Reset the tab icon back to the default FA2I logo.
 */
export function resetFavicon() {
  setFavicon(DEFAULT_FAVICON);
}
