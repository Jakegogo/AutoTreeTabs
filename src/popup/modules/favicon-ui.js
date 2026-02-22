// ===================
// Favicon 显示逻辑（popup 端）
// ===================
import { state } from './state.js';

// 验证favicon URL是否安全可用
export function isValidFaviconUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }

  // 阻止chrome协议和扩展协议
  if (url.startsWith('chrome://') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('moz-extension://') ||
      url.startsWith('safari-extension://')) {
    return false;
  }

  // 只允许安全的协议
  if (url.startsWith('https://') ||
      url.startsWith('http://') ||
      url.startsWith('data:') ||
      url.startsWith('blob:')) {
    return true;
  }

  return false;
}

export function setIconPlaceholder(iconEl, enabled) {
  if (!iconEl) return;
  if (enabled) {
    iconEl.classList.add('icon-placeholder');
    // 重要：不要用 inline backgroundColor 覆盖占位样式（inline 优先级最高）
    iconEl.style.backgroundColor = '';
  } else {
    iconEl.classList.remove('icon-placeholder');
  }
}

export function applyIconBackground(iconEl, url, source, bgColor = 'transparent') {
  if (!iconEl) return;
  if (source) iconEl.dataset.faviconSource = source;

  // 未提供/非法 URL：保持占位
  if (!url || !isValidFaviconUrl(url)) {
    setIconPlaceholder(iconEl, true);
    iconEl.style.backgroundImage = '';
    return;
  }

  // 先展示占位（圆角矩形），待图片真正加载成功后再取消圆角/背景
  setIconPlaceholder(iconEl, true);

  const img = new Image();
  img.onload = () => {
    // 若 DOM 已被移除则跳过
    if (!iconEl.isConnected) return;
    iconEl.style.backgroundImage = `url("${url}")`;
    iconEl.style.backgroundColor = bgColor || 'transparent';
    setIconPlaceholder(iconEl, false);
  };
  img.onerror = () => {
    // 加载失败：保留占位
    if (!iconEl.isConnected) return;
    iconEl.style.backgroundImage = '';
    setIconPlaceholder(iconEl, true);
  };
  img.src = url;
}

async function hydrateIconsAfterFaviconCacheLoaded() {
  const cache = window.FaviconCacheV1;
  if (!cache) return;

  await cache.ensureLoaded();

  const nodes = document.querySelectorAll('.tree-node');
  for (const nodeEl of nodes) {
    const iconEl = nodeEl.querySelector('.tree-icon');
    if (!iconEl) continue;
    if (iconEl.dataset.faviconSource === 'filetype') continue;

    const tabUrl = nodeEl.dataset.tabUrl || '';
    const favIconUrl = nodeEl.dataset.favIconUrl || '';

    const entry = await cache.getCachedEntryForPageUrl(tabUrl);
    const hasFreshData = entry && !entry.negative && entry.dataUrl && entry.dataUrl.startsWith('data:') && ((Date.now() - (entry.ts || 0)) <= cache.TTL_MS);
    if (hasFreshData && isValidFaviconUrl(entry.dataUrl)) {
      applyIconBackground(iconEl, entry.dataUrl, 'storage_data');
      continue;
    }

    // fallback to show something (may trigger network), then try to refresh cache in background (within popup lifetime)
    if (favIconUrl && isValidFaviconUrl(favIconUrl)) {
      applyIconBackground(iconEl, favIconUrl, 'favIconUrl');
    } else {
      iconEl.dataset.faviconSource = iconEl.dataset.faviconSource || 'placeholder';
      // 保持占位背景
      iconEl.classList.add('icon-placeholder');
    }

    // Update cache (popup-side fetch + persist)
    iconEl.dataset.faviconSource = iconEl.dataset.faviconSource || 'requested';
    const result = await cache.getFaviconDataUrl(tabUrl, favIconUrl || null);
    iconEl.dataset.faviconSource = result?.source || 'unknown';
    if (result?.dataUrl && isValidFaviconUrl(result.dataUrl) && iconEl.isConnected) {
      applyIconBackground(iconEl, result.dataUrl, result.source || 'unknown');
    }
  }
}

export function scheduleFaviconHydrate() {
  // 关键：必须在 renderTree 把 DOM 节点 append 完之后再跑，否则 querySelectorAll('.tree-node') 为空
  if (state.__faviconHydrateScheduled) return;
  state.__faviconHydrateScheduled = true;
  setTimeout(async () => {
    state.__faviconHydrateScheduled = false;
    try {
      await hydrateIconsAfterFaviconCacheLoaded();
    } catch (e) {
      // 避免影响主流程：图标失败不应影响 popup 功能
      console.warn('Favicon hydrate failed:', e);
    }
  }, 0);
}
