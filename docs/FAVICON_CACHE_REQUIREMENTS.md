# Favicon Cache (Optional Permission)

## Goal
Make favicons more stable in the popup, especially when `tab.favIconUrl` is missing or fails (e.g. 403/502).

## Design (minimal)
- **Background** (`background.js`) downloads `https://<origin>/favicon.ico`, converts it to a `data:` URL, and caches it in `chrome.storage.local`.
- Cache strategy:
  - **TTL**: 7 days for successful entries
  - **Negative cache**: 1 hour for failures (avoid retry spam)
  - **LRU max entries**: 200
  - **Max icon size**: 60KB (avoid storage bloat)
- **Popup** (`popup.js`) renders immediately using `tab.favIconUrl` (or placeholder), then asynchronously asks background for cached favicon and replaces the icon if available.

## Permission
The download needs optional host permissions:
- `http://*/*`
- `https://*/*`

Users can grant this from the Options page.

## Verification
- Without granting host permissions:
  - Popup should still work; icons fall back to `tab.favIconUrl` / placeholder.
- After granting host permissions:
  - Favicons should become more stable over time as the cache warms up.

