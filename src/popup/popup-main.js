// ===================
// popup 入口：DOMContentLoaded 初始化 + 模块连线
// ===================
import { state } from './modules/state.js';
import { calculateTreeHeight } from './modules/layout.js';
import { loadTabTree, updateNavigationButtons, registerSearchHistorySaver, registerActivateTabFn } from './modules/tree.js';
import { activateTabAndWindow } from './modules/tab-actions.js';
import { performSearch, clearSearch, renderChipsLayer, renderTagSuggestions, loadRecentPreference, saveSearchHistory, initializeSearch } from './modules/search.js';
import { installDebugGlobals } from './modules/debug.js';

// 注入回调，避免 tree.js 反向依赖 search.js / tab-actions.js
registerSearchHistorySaver(saveSearchHistory);
registerActivateTabFn(activateTabAndWindow);

// DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', async () => {
  // 获取当前活动标签页
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab) {
    state.currentTabId = activeTab.id;
  }

  // 读取"最近"默认偏好并应用
  let preferRecent = false;
  try {
    preferRecent = await loadRecentPreference();
  } catch {}

  if (preferRecent) {
    state.selectedFilters.recent = true;
    renderChipsLayer();
    await performSearch(document.getElementById('searchInput')?.value || '');
  } else {
    // 立即刷新并加载树形结构
    await loadTabTree();
    // 立即搜索
    performSearch('');
  }

  // 绑定前进后退按钮事件
  document.getElementById('backBtn').addEventListener('click', async () => {
    if (window.tabHistory) {
      const prevTabId = await window.tabHistory.getPreviousTab();
      if (prevTabId) {
        activateTabAndWindow(prevTabId);
      }
      // 刷新按钮状态（getPreviousTab 可能已清理无效历史条目）
      await updateNavigationButtons();
    }
  });

  document.getElementById('forwardBtn').addEventListener('click', async () => {
    if (window.tabHistory) {
      const nextTabId = await window.tabHistory.getNextTab();
      if (nextTabId) {
        activateTabAndWindow(nextTabId);
      }
      // 刷新按钮状态（getNextTab 可能已清理无效历史条目）
      await updateNavigationButtons();
    }
  });

  // 刷新按钮
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      await loadTabTree();
    });
  }

  // 导出按钮
  document.getElementById('exportBtn').addEventListener('click', async () => {
    try {
      if (!window.__exportModuleLoaded) {
        await loadScriptOnce('../shared/export.js');
        window.__exportModuleLoaded = true;
      }
      await exportTabTree();
    } catch (e) {
      console.error('Failed to load export module:', e);
    }
  });

  // 自动整理按钮
  document.getElementById('organizeBtn').addEventListener('click', async () => {
    try {
      if (!window.AutoOrganizer && !window.autoOrganizer) {
        if (!window.__organizeModuleLoaded) {
          await loadScriptOnce('../shared/auto-organize.js');
          window.__organizeModuleLoaded = true;
        }
      }
    } catch (e) {
      console.error('Failed to load auto-organize module:', e);
    }
    const AutoOrganizerClass = window.AutoOrganizer;
    const autoOrganizerInstance = window.autoOrganizer;

    if (AutoOrganizerClass) {
      const organizer = new AutoOrganizerClass();
      await organizer.organizeTabsByDomain();
      await loadTabTree();
    } else if (autoOrganizerInstance) {
      await autoOrganizerInstance.organizeTabsByDomain();
      await loadTabTree();
    } else {
      console.error('AutoOrganizer not loaded. Available window objects:', Object.keys(window).filter(key => key.toLowerCase().includes('organ')));
    }
  });

  // 计算树形结构高度
  calculateTreeHeight();
  // 初始化导航按钮状态
  await updateNavigationButtons();
  // 初始化国际化
  initI18n();

  // 搜索框交互
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('focus', () => {
      renderTagSuggestions();
    });

    // Windows 下补一个 click/mousedown 触发，保证 tagSuggestions 稳定显示
    const ensureTagSuggestions = () => {
      try { renderTagSuggestions(); } catch {}
    };
    searchInput.addEventListener('mousedown', ensureTagSuggestions);
    searchInput.addEventListener('click', ensureTagSuggestions);
    ensureTagSuggestions();

    // 回车保存历史
    searchInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        await saveSearchHistory(searchInput.value);
        renderTagSuggestions();
      }
      // 退格行为：当输入为空时，依次删除最后一个标签
      if (e.key === 'Backspace' && (searchInput.value || '').trim() === '') {
        let removed = false;
        if (state.selectedFilters.historyTerm) {
          state.selectedFilters.historyTerm = null;
          removed = true;
        } else if (state.selectedFilters.recent) {
          state.selectedFilters.recent = false;
          removed = true;
        } else if (state.selectedFilters.bookmarked) {
          state.selectedFilters.bookmarked = false;
          removed = true;
        }
        if (removed) {
          e.preventDefault();
          renderChipsLayer();
          await performSearch('');
        }
      }
    });
  }

  // 初始化搜索功能（绑定 input/清除按钮事件）
  initializeSearch();

  // 安装调试全局变量
  installDebugGlobals(performSearch);
});

// --------------------
// 兼容旧代码：loadScriptOnce 在 export/organize 按钮中使用
// --------------------
function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-dynamic="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.defer = true;
    s.dataset.dynamic = src;
    s.onload = () => resolve();
    s.onerror = (e) => reject(e);
    document.body.appendChild(s);
  });
}
