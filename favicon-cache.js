/**
 * Favicon cache module (popup-side)
 *
 * - Stores entries in chrome.storage.local under `faviconCacheV1`
 * - Uses `tab.favIconUrl` as a high-quality hint when available
 * - CORS-safe behavior:
 *   - If we can read bytes -> cache as data:
 *   - If fetch is blocked by CORS -> cache as URL (still displayable, avoids repeated fetch noise)
 *
 * Exposed API: window.FaviconCacheV1
 */

(function () {
  const STORAGE_KEY = 'faviconCacheV1';
  const MAX_ENTRIES = 200;
  const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  const NEGATIVE_TTL_MS = 60 * 60 * 1000; // 1 hour
  const MAX_ICON_BYTES = 60 * 1024;

  /** @type {Map<string, {dataUrl: string|null, ts: number, lastAccess: number, negative: boolean}>} */
  const mem = new Map();
  let loaded = false;
  let loadPromise = null;

  function now() {
    return Date.now();
  }

  function sanitizeHttpUrl(url) {
    if (!url || typeof url !== 'string') return null;
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.href;
    } catch {
      return null;
    }
  }

  function getOriginKey(pageUrl) {
    const u = sanitizeHttpUrl(pageUrl);
    if (!u) return null;
    try {
      return new URL(u).origin;
    } catch {
      return null;
    }
  }

  function isFresh(entry) {
    return !!(entry && !entry.negative && entry.dataUrl && (now() - entry.ts) <= TTL_MS);
  }

  function isNegativeFresh(entry) {
    return !!(entry && entry.negative && (now() - entry.ts) <= NEGATIVE_TTL_MS);
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  async function ensureLoaded() {
    if (loaded) return;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        const store = await chrome.storage.local.get(STORAGE_KEY);
        const obj = store?.[STORAGE_KEY];
        if (obj && typeof obj === 'object') {
          for (const [origin, entry] of Object.entries(obj)) {
            if (!entry || typeof entry !== 'object') continue;
            const dataUrl = typeof entry.dataUrl === 'string' ? entry.dataUrl : null;
            const ts = Number(entry.ts) || 0;
            const lastAccess = Number(entry.lastAccess) || ts;
            const negative = entry.negative === true;
            mem.set(origin, { dataUrl, ts, lastAccess, negative });
          }
        } else {
          // create key for observability
          try {
            await chrome.storage.local.set({ [STORAGE_KEY]: {} });
          } catch {}
        }
      } catch {
        // ignore
      } finally {
        loaded = true;
      }
    })();
    return loadPromise;
  }

  async function persist() {
    // LRU trim
    if (mem.size > MAX_ENTRIES) {
      const sorted = Array.from(mem.entries()).sort((a, b) => (a[1].lastAccess || 0) - (b[1].lastAccess || 0));
      const toDelete = sorted.slice(0, mem.size - MAX_ENTRIES);
      toDelete.forEach(([k]) => mem.delete(k));
    }

    const obj = {};
    for (const [origin, entry] of mem.entries()) {
      obj[origin] = {
        dataUrl: entry.dataUrl || null,
        ts: entry.ts,
        lastAccess: entry.lastAccess,
        negative: entry.negative === true
      };
    }

    await chrome.storage.local.set({ [STORAGE_KEY]: obj });
  }

  async function fetchIconAsDataUrl(iconUrl) {
    const url = sanitizeHttpUrl(iconUrl);
    if (!url) throw new Error('Invalid iconUrl');

    const resp = await fetch(url, { cache: 'force-cache', redirect: 'follow' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const buf = await resp.arrayBuffer();
    if (!buf || buf.byteLength === 0) throw new Error('Empty icon');
    if (buf.byteLength > MAX_ICON_BYTES) throw new Error('Icon too large');

    const contentType = resp.headers.get('content-type') || 'image/x-icon';
    const base64 = arrayBufferToBase64(buf);
    return `data:${contentType};base64,${base64}`;
  }

  async function getFaviconDataUrl(pageUrl, iconUrlHint = null) {
    await ensureLoaded();
    const origin = getOriginKey(pageUrl);
    if (!origin) return { dataUrl: null, source: 'none' };

    const existing = mem.get(origin);
    if (isFresh(existing)) {
      existing.lastAccess = now();
      return { dataUrl: existing.dataUrl, source: 'cache' };
    }
    if (isNegativeFresh(existing)) {
      existing.lastAccess = now();
      return { dataUrl: null, source: 'negative' };
    }

    // 1) prefer hint (tab.favIconUrl)
    if (iconUrlHint) {
      try {
        const hintedDataUrl = await fetchIconAsDataUrl(iconUrlHint);
        mem.set(origin, { dataUrl: hintedDataUrl, ts: now(), lastAccess: now(), negative: false });
        await persist();
        return { dataUrl: hintedDataUrl, source: 'hint_network' };
      } catch (e) {
        const msg = (e && typeof e.message === 'string') ? e.message : '';
        const isCorsLike = (e instanceof TypeError) || /CORS|Failed to fetch/i.test(msg);
        if (isCorsLike) {
          const hintedUrl = sanitizeHttpUrl(iconUrlHint);
          if (hintedUrl) {
            mem.set(origin, { dataUrl: hintedUrl, ts: now(), lastAccess: now(), negative: false });
            await persist();
            return { dataUrl: hintedUrl, source: 'hint_url_fallback' };
          }
        }
        // continue fallback below
      }
    }

    // 2) fallback: /favicon.ico
    try {
      const dataUrl = await fetchIconAsDataUrl(`${origin}/favicon.ico`);
      mem.set(origin, { dataUrl, ts: now(), lastAccess: now(), negative: false });
      await persist();
      return { dataUrl, source: 'network' };
    } catch (e) {
      const msg = (e && typeof e.message === 'string') ? e.message : '';
      const isCorsLike = (e instanceof TypeError) || /CORS|Failed to fetch/i.test(msg);
      if (isCorsLike) {
        const urlFallback = `${origin}/favicon.ico`;
        mem.set(origin, { dataUrl: urlFallback, ts: now(), lastAccess: now(), negative: false });
        await persist();
        return { dataUrl: urlFallback, source: 'url_fallback' };
      }

      mem.set(origin, { dataUrl: null, ts: now(), lastAccess: now(), negative: true });
      await persist();
      return { dataUrl: null, source: 'network_failed' };
    }
  }

  async function getCachedEntryForPageUrl(pageUrl) {
    await ensureLoaded();
    const origin = getOriginKey(pageUrl);
    if (!origin) return null;
    return mem.get(origin) || null;
  }

  window.FaviconCacheV1 = {
    STORAGE_KEY,
    TTL_MS,
    NEGATIVE_TTL_MS,
    ensureLoaded,
    getOriginKey,
    getCachedEntryForPageUrl,
    getFaviconDataUrl
  };
})();

