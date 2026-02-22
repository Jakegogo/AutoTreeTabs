// ===================
// 搜索、过滤器（chips）与搜索历史
// ===================
import { state } from './state.js';
import { loadTabTree, updateSeparatorVisibility } from './tree.js';
import { scrollToCurrentTab } from './selection.js';
import { getAllBookmarkedUrlSet } from './bookmarks.js';

// --------------------
// 最近标签持久化
// --------------------
export async function saveRecentPreference(enabled) {
  try { await chrome.runtime.sendMessage({ action: 'setDefaultRecentFilter', value: !!enabled }); } catch {}
}

export async function loadRecentPreference() {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getDefaultRecentFilter' });
    return !!(res && res.value);
  } catch {
    return false;
  }
}

// --------------------
// 搜索历史
// --------------------
export async function loadSearchHistory() {
  try {
    const store = await chrome.storage.local.get('searchHistory');
    state.searchHistory = Array.isArray(store.searchHistory) ? store.searchHistory : [];
  } catch (e) {
    state.searchHistory = [];
  }
}

export async function saveSearchHistory(term) {
  const t = (term || '').trim();
  if (!t) return;
  state.searchHistory = [t, ...state.searchHistory.filter(x => x !== t)].slice(0, 10);
  try { await chrome.storage.local.set({ searchHistory: state.searchHistory }); } catch {}
}

// --------------------
// Chips 层（输入框内的过滤标签）
// --------------------
export function renderChipsLayer() {
  const chipsLayer = document.getElementById('chipsLayer');
  if (!chipsLayer) return;
  chipsLayer.innerHTML = '';

  const addChip = (label, type) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.textContent = label + ' ';
    const remove = document.createElement('span');
    remove.className = 'remove';
    remove.textContent = '×';
    remove.title = 'Remove';
    remove.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (type === 'bookmarked') state.selectedFilters.bookmarked = false;
      if (type === 'recent') {
        state.selectedFilters.recent = false;
        await saveRecentPreference(false);
      }
      if (type === 'history') state.selectedFilters.historyTerm = null;
      renderChipsLayer();
      performSearch(document.getElementById('searchInput')?.value || '');
    });
    chip.appendChild(remove);
    chipsLayer.appendChild(chip);
  };

  // 显示顺序：最近 → 书签 → 历史
  if (state.selectedFilters.recent) addChip(i18n('recent2h') || 'Recent', 'recent');
  if (state.selectedFilters.bookmarked) addChip(i18n('bookmarked') || 'Bookmarked', 'bookmarked');
  if (state.selectedFilters.historyTerm) addChip(state.selectedFilters.historyTerm, 'history');

  const input = document.getElementById('searchInput');
  if (input) {
    const basePadding = 35;
    const gap = 6;
    const chipsWidth = chipsLayer.children.length > 0 ? Math.min(chipsLayer.scrollWidth, (input.clientWidth - basePadding - 30)) : 0;
    const newPadding = chipsWidth > 0 ? (basePadding + chipsWidth + gap) : basePadding;
    input.style.paddingLeft = newPadding + 'px';
  }
}

// --------------------
// 标签建议（搜索框下方）
// --------------------
export function renderTagSuggestions() {
  const container = document.getElementById('tagSuggestions');
  if (!container) return;
  container.innerHTML = '';

  const makeChip = (text, onClick) => {
    const el = document.createElement('span');
    el.className = 'tag-chip';
    el.textContent = text;
    el.addEventListener('mousedown', async (e) => {
      e.preventDefault();
      await onClick();
    });
    return el;
  };

  container.appendChild(makeChip(i18n('recent2h') || 'Recent 2h', async () => {
    state.selectedFilters.recent = !state.selectedFilters.recent;
    await saveRecentPreference(state.selectedFilters.recent);
    state.suppressAutoSearchOnce = true;
    renderChipsLayer();
    performSearch(document.getElementById('searchInput')?.value || '');
  }));

  container.appendChild(makeChip(i18n('bookmarked') || 'Bookmarked', async () => {
    state.selectedFilters.bookmarked = !state.selectedFilters.bookmarked;
    renderChipsLayer();
    performSearch(document.getElementById('searchInput')?.value || '');
  }));

  // 加载历史
  loadSearchHistory().then(() => {
    (state.searchHistory || []).slice(0, 6).forEach(term => {
      if (!term) return;
      container.appendChild(makeChip(term, () => {
        state.selectedFilters.historyTerm = term;
        const input = document.getElementById('searchInput');
        if (input) input.value = '';
        renderChipsLayer();
        performSearch('');
      }));
    });
  });
  container.style.display = 'flex';
}

// --------------------
// 搜索核心逻辑
// --------------------

function normalizeText(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[\uff01-\uff5e]/g, function(ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    })
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightText(element, searchTerm) {
  removeHighlight(element);

  if (!searchTerm) return;

  const text = element.textContent;
  const normalizedText = normalizeText(text);
  const normalizedSearchTerm = normalizeText(searchTerm);
  const index = normalizedText.indexOf(normalizedSearchTerm);

  if (index !== -1) {
    let originalIndex = index;
    let originalLength = normalizedSearchTerm.length;

    if (normalizedText !== text.toLowerCase()) {
      const pattern = new RegExp(escapeRegExp(searchTerm), 'i');
      const match = text.match(pattern);
      if (match) {
        originalIndex = match.index;
        originalLength = match[0].length;
      }
    }

    const beforeText = text.substring(0, originalIndex);
    const matchText = text.substring(originalIndex, originalIndex + originalLength);
    const afterText = text.substring(originalIndex + originalLength);

    element.innerHTML = beforeText +
      '<span class="search-highlight">' + matchText + '</span>' +
      afterText;
  }
}

function removeHighlight(nodeOrElement) {
  const element = nodeOrElement.querySelector ?
    nodeOrElement.querySelector('.tree-title') : nodeOrElement;

  if (element) {
    const highlights = element.querySelectorAll('.search-highlight');
    highlights.forEach(highlight => {
      const text = highlight.textContent;
      highlight.replaceWith(document.createTextNode(text));
    });
    element.normalize();
  }
}

function showParentNodes(node) {
  let parent = node.parentElement;
  while (parent && parent.classList.contains('tree-node')) {
    parent.classList.remove('hidden');
    parent = parent.parentElement;
  }
}

function showAllNodes() {
  const allNodes = document.querySelectorAll('.tree-node');
  allNodes.forEach(node => {
    node.classList.remove('hidden');
    removeHighlight(node);
  });

  const separators = document.querySelectorAll('.pinned-separator');
  separators.forEach(sep => sep.style.display = 'flex');
  updateSeparatorVisibility();
}

function showNoResultsMessage() {
  removeNoResultsMessage();
  const treeContainer = document.getElementById('treeContainer');
  const noResults = document.createElement('div');
  noResults.className = 'no-results';
  noResults.id = 'noResults';
  noResults.textContent = `No tabs found matching "${state.currentSearchTerm}"`;
  treeContainer.appendChild(noResults);
}

function removeNoResultsMessage() {
  const existing = document.getElementById('noResults');
  if (existing) {
    existing.remove();
  }
}

async function filterNodesWithTags() {
  const allNodes = document.querySelectorAll('.tree-node');
  let hasVisibleResults = false;
  let hasPinnedResults = false;
  let hasNormalResults = false;

  allNodes.forEach((node, index) => {
    const tabTitle = node.querySelector('.tree-title');
    const tabUrl = node.getAttribute('data-tab-url') || '';
    const titleText = tabTitle ? normalizeText(tabTitle.textContent) : '';
    const tabId = parseInt(node.getAttribute('data-tab-id'));

    const titleMatches = state.currentSearchTerm ? titleText.includes(state.currentSearchTerm) : true;
    const urlMatches = state.currentSearchTerm ? normalizeText(tabUrl).includes(state.currentSearchTerm) : true;
    let matches = titleMatches || urlMatches;

    if (matches && state.selectedFilters.historyTerm && !state.currentSearchTerm) {
      const hist = normalizeText(state.selectedFilters.historyTerm);
      matches = titleText.includes(hist) || normalizeText(tabUrl).includes(hist);
    }

    if (matches && state.selectedFilters.bookmarked) {
      const normalize = (u) => { try { const x = new URL(u); x.hash = ''; return x.href; } catch { return (u||'').split('#')[0]; } };
      const norm = normalize(tabUrl);
      if (!state.bookmarkedUrlsSet || !state.bookmarkedUrlsSet.has(norm)) {
        matches = false;
      }
    }

    if (index < 3 && state.currentSearchTerm) {
      console.log(`🔍 Node ${index} debug:`, {
        originalTitle: tabTitle ? tabTitle.textContent : 'No title',
        normalizedTitle: titleText,
        searchTerm: state.currentSearchTerm,
        titleMatches,
        urlMatches,
        matches
      });
    }

    if (matches) {
      node.classList.remove('hidden');
      showParentNodes(node);
      hasVisibleResults = true;

      const isPinned = state.pinnedTabsCache && state.pinnedTabsCache[tabId];
      if (isPinned) {
        hasPinnedResults = true;
      } else {
        hasNormalResults = true;
      }

      if (titleMatches && tabTitle) {
        highlightText(tabTitle, state.currentSearchTerm);
      }
    } else {
      node.classList.add('hidden');
    }
  });

  updateSeparatorVisibility();

  return hasVisibleResults;
}

export async function performSearch(searchTerm) {
  state.currentSearchTerm = normalizeText(searchTerm);

  console.log('🔍 Search debug:', {
    original: searchTerm,
    normalized: state.currentSearchTerm,
    length: state.currentSearchTerm.length
  });

  if ((state.selectedFilters.recent) && !state.isRefreshingByRecent) {
    try {
      state.isRefreshingByRecent = true;
      await loadTabTree();
    } finally {
      state.isRefreshingByRecent = false;
    }
    state.selectedFilters.lastRecent = state.selectedFilters.recent;
  }

  if (!searchTerm && !state.selectedFilters.bookmarked && !state.selectedFilters.recent && !state.selectedFilters.historyTerm) {
    showAllNodes();
    removeNoResultsMessage();
    scrollToCurrentTab();
    return;
  }

  if (state.selectedFilters.bookmarked && !state.bookmarkedUrlsSet) {
    await getAllBookmarkedUrlSet();
  }

  const hasResults = await filterNodesWithTags();

  if (!hasResults) {
    showNoResultsMessage();
  } else {
    removeNoResultsMessage();
  }
  scrollToCurrentTab();
}

export function clearSearch() {
  const searchInput = document.getElementById('searchInput');
  const clearBtn = document.getElementById('clearSearchBtn');

  if (searchInput) {
    searchInput.value = '';
    searchInput.focus();
  }

  if (clearBtn) {
    clearBtn.classList.remove('visible');
  }

  state.currentSearchTerm = '';
  showAllNodes();
  removeNoResultsMessage();
  renderChipsLayer();
}

export function initializeSearch() {
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');

  if (!searchInput || !clearSearchBtn) return;

  searchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.trim();
    const clearBtn = document.getElementById('clearSearchBtn');
    if (searchTerm) {
      clearBtn.classList.add('visible');
    } else {
      clearBtn.classList.remove('visible');
    }
    performSearch(searchTerm);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      clearSearch();
    }
  });

  clearSearchBtn.addEventListener('click', clearSearch);

  setTimeout(() => {
    searchInput.focus();
  }, 100);
}
