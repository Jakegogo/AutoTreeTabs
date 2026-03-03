// 后台服务脚本入口 - 处理标签页创建和关系跟踪
// 源码已拆分为 ES Modules，通过 esbuild 打包为 background.js

import {
  storageManager,
  settingsCache,
  persistentStorage,
  pinnedTabStorage,
} from './instances.js';

import {
  updateTabSnapshot,
  deleteTabSnapshot,
  scheduleSnapshotUpdate,
  findNextTabToActivate,
  updateCloseDirectionIndex,
} from './AutoBackTrack.js';

import {
  injectContentScript,
  cleanupScrollPositionForTab,
} from './tools.js';

// 监听 settings 变化，清除 settingsCache（原 SettingsCache.js 末尾的全局引用，移至此处）
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.extensionSettings) {
    console.log('📝 Extension settings changed, clearing cache');
    settingsCache.clearCache();
  }
});

// 标记通过插件关闭的标签页
let pluginClosedTabs = new Set();

// 记录 tabId -> 最近一次已知 URL（因为 tabs.onRemoved 触发时 tab 已不可查询）
const tabLastKnownUrlById = new Map();

function recordTabUrl(tabId, url) {
  if (typeof url !== 'string' || url.trim() === '') return;
  tabLastKnownUrlById.set(tabId, url);
}

function isGoogleOAuthUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.hostname === 'accounts.google.com' && u.pathname.startsWith('/signin/oauth');
  } catch {
    return false;
  }
}

async function isPopupWindow(windowId) {
  try {
    const win = await chrome.windows.get(windowId);
    return win?.type === 'popup';
  } catch {
    return false;
  }
}

// 监听标签页创建事件 - 优先使用 openerTabId + 持久化记录
chrome.tabs.onCreated.addListener(async (tab) => {
  console.log('Tab created:', tab.id, 'openerTabId:', tab.openerTabId, 'url:', tab.url);
  recordTabUrl(tab.id, tab.url || tab.pendingUrl || '');

  try {
    if (isWindowRestoring) {
      console.log(`🔄 Window restoration in progress, skipping auto parent-child setup for tab ${tab.id}`);
      return;
    }

    let parentTab = null;

    if (tab.openerTabId) {
      try {
        parentTab = await chrome.tabs.get(tab.openerTabId);
        await setTabParent(tab.id, tab.openerTabId);
        console.log(`✓ Parent set via openerTabId: ${tab.id} -> ${tab.openerTabId}`);
      } catch (error) {
        console.log('OpenerTab not found, falling back to active tab');
      }
    }

    if (!parentTab) {
      const [activeTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
      if (activeTab && activeTab.id !== tab.id) {
        parentTab = activeTab;
        await setTabParent(tab.id, activeTab.id);
        console.log(`✓ Parent set to active tab: ${tab.id} -> ${activeTab.id}`);
      }
    }

    if (parentTab) {
      await persistentStorage.recordRelation(tab, parentTab);
    }
  } catch (error) {
    console.error('Error setting tab parent on creation:', error);
  }
});

// AutoBackTrack 的快照更新也需要监听 onCreated / onMoved
chrome.tabs.onCreated.addListener(() => {
  scheduleSnapshotUpdate();
});

chrome.tabs.onMoved.addListener(() => {
  scheduleSnapshotUpdate();
});

// 监听标签页URL更新 - 处理延迟加载的URL
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!settingsCache.isFeatureEnabled('autoRestore')) {
    return;
  }

  if (changeInfo.url && !isWindowRestoring) {
    console.log('Tab URL updated:', tabId, 'new URL:', changeInfo.url);
    recordTabUrl(tabId, changeInfo.url);

    try {
      if (tab.openerTabId) {
        try {
          const parentTab = await chrome.tabs.get(tab.openerTabId);
          await persistentStorage.recordRelation(tab, parentTab);
          console.log(`🔄 Native relation recorded: ${tabId} -> ${tab.openerTabId} (URL now available)`);
        } catch (error) {
          console.log('OpenerTab not found when updating URL:', error);
        }
      }

      await updateChildRelationsForUpdatedParent(tabId, tab);

    } catch (error) {
      console.error('Error updating tab relation on URL change:', error);
    }
  }
});

// 标签页更新时按需注入content script
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url &&
      (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
    await injectContentScript(tabId);
  }
});

// 更新父节点URL变化时的子节点关系
async function updateChildRelationsForUpdatedParent(parentTabId, updatedParentTab) {
  try {
    const tabRelations = await storageManager.getTabRelationsSync() || {};

    const childTabIds = Object.keys(tabRelations).filter(childId =>
      tabRelations[childId] == parentTabId
    );

    if (childTabIds.length === 0) {
      return;
    }

    console.log(`🔄 Updating relations for parent ${parentTabId} with ${childTabIds.length} children`);

    for (const childTabId of childTabIds) {
      try {
        const childTab = await chrome.tabs.get(parseInt(childTabId));
        await persistentStorage.recordRelation(childTab, updatedParentTab);
        console.log(`🔄 Updated relation: ${childTabId} -> ${parentTabId} (parent URL updated)`);
      } catch (error) {
        console.log(`⚠️ Could not update relation for child ${childTabId}:`, error);
      }
    }

  } catch (error) {
    console.error('Error updating child relations for updated parent:', error);
  }
}

// 监听标签页移除事件
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  try {
    if (removeInfo.isWindowClosing) {
      await removeTabRelations(tabId);
      deleteTabSnapshot(tabId);
      await cleanupScrollPositionForTab(tabId);
      return;
    }

    if (pluginClosedTabs.has(tabId)) {
      console.log(`Tab ${tabId} was closed by plugin, skipping auto-switch`);
      pluginClosedTabs.delete(tabId);
      await removeTabRelations(tabId);
      deleteTabSnapshot(tabId);
      await cleanupScrollPositionForTab(tabId);
      return;
    }

    const lastKnownUrl = tabLastKnownUrlById.get(tabId);
    const shouldSkipSmartSwitch = isGoogleOAuthUrl(lastKnownUrl) && await isPopupWindow(removeInfo.windowId);
    if (shouldSkipSmartSwitch) {
      console.log(`🔐 OAuth popup tab ${tabId} closed, skipping smart switch. url=`, lastKnownUrl);
      await removeTabRelations(tabId);
      await cleanupScrollPositionForTab(tabId);
      deleteTabSnapshot(tabId);
      return;
    }

    console.log(`Tab ${tabId} was closed by user, checking settings...`);

    if (!settingsCache.isFeatureEnabled('smartSwitch')) {
      console.log(`Smart tab switching is disabled, skipping auto-switch`);
      await removeTabRelations(tabId);
      await cleanupScrollPositionForTab(tabId);
      deleteTabSnapshot(tabId);
      return;
    }

    updateCloseDirectionIndex(tabId);

    const tabRelations = storageManager.getTabRelations();
    const remainingTabs = await chrome.tabs.query({});

    const nextTabId = findNextTabToActivate(tabId, tabRelations || {}, remainingTabs);

    if (nextTabId) {
      console.log(`Activating next tab: ${nextTabId} after closing ${tabId}`);
      await chrome.tabs.update(nextTabId, { active: true });
    }

    await removeTabRelations(tabId);
    await cleanupScrollPositionForTab(tabId);
    deleteTabSnapshot(tabId);
  } catch (error) {
    console.error('Error handling tab removal:', error);
  } finally {
    tabLastKnownUrlById.delete(tabId);
  }
  updateTabSnapshot();
});

// 标签页激活时按需注入content script
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
      await injectContentScript(activeInfo.tabId);
    }
  } catch (error) {
    console.log('Error injecting content script on tab activation:', error);
  }
  try {
    storageManager.addToGlobalTabHistory(activeInfo.tabId);
  } catch (error) {
    console.log('Error adding to global tab history:', error);
  }
});

// 监听来自popup和content script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      if (request.action === 'linkClicked') {
        const parentTabId = sender.tab.id;

        setTimeout(async () => {
          try {
            const tabs = await chrome.tabs.query({ active: true, windowId: sender.tab.windowId });
            if (tabs.length > 0 && tabs[0].id !== parentTabId) {
              await setTabParent(tabs[0].id, parentTabId);
            }
          } catch (error) {
            console.error('Error setting parent for clicked link:', error);
          }
          sendResponse({ success: true });
        }, 100);
      } else if (request.action === 'markPluginClosed') {
        if (request.tabIds && Array.isArray(request.tabIds)) {
          request.tabIds.forEach(tabId => {
            pluginClosedTabs.add(tabId);
            console.log(`Marked tab ${tabId} as plugin-closed`);
          });
        }
        sendResponse({ success: true });
      } else if (request.action === 'restoreRelations') {
        console.log('Popup requested restore relations');
        await persistentStorage.restoreRelations();
        sendResponse({ success: true });
      } else if (request.action === 'getHistoryData') {
        sendResponse(await storageManager.getGlobalTabHistorySync());
      } else if (request.action === 'saveHistoryData') {
        if (request.historyData) {
          storageManager.saveGlobalTabHistory(request.historyData);
        }
        sendResponse({ success: true });
      } else if (request.action === 'getTabRelations') {
        const tabRelations = storageManager.getTabRelations();
        if (tabRelations == null) {
          sendResponse(undefined);
        } else {
          sendResponse(tabRelations);
        }
      } else if (request.action === 'isFeatureEnabled') {
        try {
          const enabled = await settingsCache.isFeatureEnabledSync(request.feature);
          sendResponse(enabled === true);
        } catch (e) {
          sendResponse(false);
        }
      } else if (request.action === 'saveScrollPosition') {
        if (request.url && request.position) {
          await storageManager.saveScrollPosition(request.url, request.position);
          console.log(`📜 Saved scroll position for ${request.url}:`, request.position);
        }
        sendResponse({ success: true });
      } else if (request.action === 'getScrollPosition') {
        if (request.url) {
          const position = await storageManager.getScrollPositionSync(request.url);
          sendResponse(position);
          console.log(`📜 Retrieved scroll position for ${request.url}:`, position);
        } else {
          sendResponse(null);
        }
      } else if (request.action === 'removeScrollPosition') {
        if (request.url) {
          await storageManager.removeScrollPosition(request.url);
          console.log(`🗑️ Removed scroll position for ${request.url}`);
        }
        sendResponse({ success: true });
      } else if (request.action === 'removeTabRelationsFor') {
        if (request.tabId) {
          try {
            await removeTabParentRelationsPersistent(parseInt(request.tabId));
            console.log(`🗑️ Removed relations for tab ${request.tabId}`);
            sendResponse({ success: true });
            updateTabSnapshot();
          } catch (e) {
            console.error('Error removing relations for tab:', e);
            sendResponse({ success: false, error: e?.message || String(e) });
          }
        } else {
          sendResponse({ success: false, error: 'tabId required' });
        }
      } else if (request.action === 'addPinnedTab') {
        if (request.tabId && request.tabInfo) {
          const success = await pinnedTabStorage.addPinnedTab(request.tabId, request.tabInfo);
          sendResponse({ success });
        } else {
          sendResponse({ success: false, error: 'tabId and tabInfo required' });
        }
      } else if (request.action === 'removePinnedTab') {
        if (request.tabId) {
          const success = await pinnedTabStorage.removePinnedTab(request.tabId);
          sendResponse({ success });
        } else {
          sendResponse({ success: false, error: 'tabId required' });
        }
      } else if (request.action === 'getPinnedTabs') {
        const pinnedTabs = await storageManager.getPinnedTabs();
        sendResponse(pinnedTabs);
      } else if (request.action === 'getPinnedTabIdsCache') {
        const pinnedTabIdsCache = await storageManager.getPinnedTabIdsCache();
        sendResponse(pinnedTabIdsCache);
      } else if (request.action === 'isPinnedTab') {
        if (request.tabId) {
          const isPinned = await pinnedTabStorage.isPinnedTab(request.tabId);
          sendResponse({ isPinned });
        } else {
          sendResponse({ isPinned: false });
        }
      } else if (request.action === 'getDefaultRecentFilter') {
        try {
          const value = await storageManager.getDefaultRecentFilter();
          sendResponse({ value });
        } catch (e) {
          sendResponse({ value: false });
        }
      } else if (request.action === 'setDefaultRecentFilter') {
        try {
          const ok = await storageManager.setDefaultRecentFilter(!!request.value);
          sendResponse({ success: ok });
        } catch (e) {
          sendResponse({ success: false });
        }
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ error: error.message });
    }
  })();

  return true;
});

// 设置标签页的父标签页
async function setTabParent(childTabId, parentTabId) {
  try {
    const tabRelations = await storageManager.getTabRelationsSync() || {};

    tabRelations[childTabId] = parentTabId;

    storageManager.saveTabRelations(tabRelations);
    console.log(`Set parent for tab ${childTabId} to ${parentTabId}`);

    try {
      const [childTab, parentTab] = await Promise.all([
        chrome.tabs.get(childTabId),
        chrome.tabs.get(parentTabId)
      ]);

      if (childTab.openerTabId !== parentTabId) {
        await persistentStorage.recordRelation(childTab, parentTab);
        console.log(`📝 Manual relation recorded: ${childTab.id} -> ${parentTabId} (not from openerTabId)`);
      } else {
        console.log(`⏭️ Skipping native relation: ${childTab.id} -> ${parentTabId} (handled by onUpdated)`);
      }
    } catch (error) {
      console.log('Could not record manual relation to persistent storage:', error);
    }
  } catch (error) {
    console.error('Error setting tab parent:', error);
  }
}

// 移除标签页相关的所有关系（内存缓存）
async function removeTabRelations(removedTabId) {
  try {
    const tabRelations = storageManager.getTabRelations();
    if (!tabRelations) {
      return;
    }

    delete tabRelations[removedTabId];

    Object.keys(tabRelations).forEach(childId => {
      if (tabRelations[childId] === removedTabId) {
        delete tabRelations[childId];
      }
    });

    storageManager.saveTabRelations(tabRelations);
  } catch (error) {
    console.error('Error removing tab relations:', error);
  }
}

// 移除标签页相关的所有关系（含持久化存储）
async function removeTabParentRelationsPersistent(removedTabId) {
  try {
    const tabRelations = storageManager.getTabRelations();
    if (!tabRelations) {
      return;
    }
    delete tabRelations[removedTabId];
    storageManager.saveTabRelations(tabRelations);

    const tab = await chrome.tabs.get(removedTabId);
    if (tab && tab.url) {
      persistentStorage.removeRelation(tab.url);
      console.log(`🗑️ Removed persistent relation for ${tab.url}`);
    }
  } catch(error) {
    console.error('Error removing tab relations:', error);
  }
}

// 插件安装时的初始化
chrome.runtime.onInstalled.addListener(async () => {
  try {
    console.log('🚀 Extension initialized');
    await persistentStorage.restoreRelations();
    await persistentStorage.cleanup();
  } catch (error) {
    console.error('Error initializing extension:', error);
  }
});

// 窗口恢复检测
let isWindowRestoring = false;

// 监听窗口关闭事件 - 清除内存中的标签关系
chrome.windows.onRemoved.addListener(async (windowId) => {
  try {
    const normalWindows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    if (!normalWindows || normalWindows.length === 0) {
      console.log('🗑️ All normal windows closed, clearing tabRelations + global history');
      storageManager.removeTabRelations();
      storageManager.clearGlobalTabHistory();
    } else {
      console.log('🪟 Window closed:', windowId, 'but normal windows remain, keeping tabRelations + global history');
    }
  } catch (error) {
    console.error('Error clearing tabRelations on window close:', error);
  }
});

// 监听窗口创建事件 - 检测窗口恢复
chrome.windows.onCreated.addListener(async (window) => {
  console.log('🪟 Window created:', window.id, 'type:', window.type);

  if (window.type === 'normal') {
    isWindowRestoring = true;
    console.log('🔄 Window restoration detected, will skip auto parent-child setup');

    setTimeout(async () => {
      console.log('🔄 Starting restoration process...');
      await persistentStorage.restoreRelations();

      isWindowRestoring = false;
      console.log('🔄 Window restoration detection reset');
    }, 3000);
  }
});

// 监听窗口焦点变化，重建关系（延迟执行避免频繁触发）
let rebuildTimeout = null;
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    if (rebuildTimeout) clearTimeout(rebuildTimeout);

    rebuildTimeout = setTimeout(async () => {
      console.log('🔄 Window focus changed, restoring relations...');
      await persistentStorage.restoreRelations();
    }, 1000);
  }
});

// 初始化时预加载缓存
storageManager.getScrollPositions().then(() => {
  console.log('📜 Scroll positions cache preloaded');
}).catch(error => {
  console.error('Error preloading scroll positions cache:', error);
});

settingsCache.getSettings().then(() => {
  console.log('📜 Settings cache preloaded');
}).catch(error => {
  console.error('Error preloading settings cache:', error);
});

// 初始化时立即建立快照
updateTabSnapshot();

// 定期清理过期的滚动位置（每小时执行一次）
setInterval(async () => {
  try {
    await storageManager.cleanupOldScrollPositions();
  } catch (error) {
    console.error('Error during scroll position cleanup:', error);
  }
}, 60 * 60 * 1000);

// 启动时立即执行一次清理（5秒后）
setTimeout(async () => {
  try {
    await storageManager.cleanupOldScrollPositions();
    await pinnedTabStorage.cleanupInvalidPinnedTabs();
    await pinnedTabStorage.cleanupExpiredPinnedTabs();
  } catch (error) {
    console.error('Error during initial cleanup:', error);
  }
}, 5000);

// 定期清理无效的置顶标签页（每30分钟执行一次）
setInterval(async () => {
  try {
    await pinnedTabStorage.cleanupInvalidPinnedTabs();
  } catch (error) {
    console.error('Error during pinned tabs cleanup:', error);
  }
}, 30 * 60 * 1000);

// 定期清理过期的置顶标签页（每天执行一次）
setInterval(async () => {
  try {
    await pinnedTabStorage.cleanupExpiredPinnedTabs();
  } catch (error) {
    console.error('Error during expired pinned tabs cleanup:', error);
  }
}, 24 * 60 * 60 * 1000);
