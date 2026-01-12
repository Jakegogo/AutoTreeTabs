// 后台服务脚本 - 处理标签页创建和关系跟踪
// 基于 URL 的持久化系统，解决 tabId 和 openerTabId 重启后变化的问题

importScripts('src/background/PinnedTabPersistentStorage.js');
importScripts('src/background/DelayedMergeExecutor.js');
importScripts('src/background/SettingsCache.js');
importScripts('src/background/StorageManager.js');
importScripts('src/background/tools.js');
importScripts('src/background/AutoBackTrack.js');


// URL-based 标签页树持久化系统 (学习自 Tabs Outliner)
class TabTreePersistentStorage {
  constructor() {
    this.maxHistory = 500; // 限制历史记录数量
  }

  // 规范化 URL（只移除hash片段，保留所有查询参数）
  normalizeUrl(url) {
    try {
      const urlObj = new URL(url);
      
      // 只移除 hash 片段，保留所有查询参数
      urlObj.hash = '';
      
      return urlObj.href;
    } catch (error) {
      // 如果不是有效 URL，返回原始字符串（移除锚点）
      return url.split('#')[0];
    }
  }

  // 创建标签页的稳定标识符
  createTabSignature(tab) {
    // 获取有效的URL（优先使用url，fallback到pendingUrl）
    const effectiveUrl = tab.url || tab.pendingUrl || '';
    
    return {
      url: this.normalizeUrl(effectiveUrl),
      title: tab.title || '',
      favIconUrl: tab.favIconUrl || ''
    };
  }

  // 记录标签页关系
  async recordRelation(childTab, parentTab) {
    // 检查自动恢复设置
    if (!settingsCache.isFeatureEnabled('autoRestore')) {
      return {};
    }
    try {
      const persistentTree = await storageManager.getPersistentTree();
      
      const childSignature = this.createTabSignature(childTab);
      const parentSignature = this.createTabSignature(parentTab);
      
      // 检查URL有效性
      if (!childSignature.url || !parentSignature.url || 
          childSignature.url.trim() === '' || parentSignature.url.trim() === '' ||
          childSignature.url === 'chrome://newtab/' || 
          parentSignature.url === 'chrome://newtab/' ||
          childSignature.url.startsWith('chrome-extension://') ||
          parentSignature.url.startsWith('chrome-extension://')) {
        console.log('🚫 Skipping record: invalid URLs', childSignature.url, '->', parentSignature.url);
        return;
      }
      
      // 检查是否已存在相同的关系（避免重复记录）
      const existingRelation = persistentTree.relations.find(relation => 
        relation.child.url === childSignature.url && 
        relation.parent.url === parentSignature.url
      );
      
      if (existingRelation) {
        // 更新时间戳即可，不重复添加
        existingRelation.timestamp = Date.now();
        console.log('🔄 Updated existing relation:', childSignature.url, '->', parentSignature.url);
      } else {
        // 添加新关系
        const relation = {
          child: childSignature,
          parent: parentSignature,
          timestamp: Date.now(),
          method: childTab.openerTabId === parentTab.id ? 'opener' : 'manual'
        };
        
        persistentTree.relations.push(relation);
        console.log('📝 Recorded new relation:', relation.child.url, '->', relation.parent.url);
      }
      
      // 限制历史记录数量
      if (persistentTree.relations.length > this.maxHistory) {
        persistentTree.relations = persistentTree.relations.slice(-this.maxHistory);
      }
      
      storageManager.saveToPersistentTree(persistentTree);
    } catch (error) {
      console.error('Error recording relation:', error);
    }
  }

  // 恢复标签页关系（防重复执行）
  async restoreRelations() {
    try {
      // 检查自动恢复设置
      const autoRestoreEnabled = await settingsCache.isFeatureEnabledSync('autoRestore');
      if (!autoRestoreEnabled) {
        console.log('🚫 autoRestore is disable!')
        return {};
      }
      
      // 检查是否已经有标签页关系数据，如果缓存已初始化（即使为空对象）则不进行恢复
      const existingRelations = storageManager.getTabRelations();
      if (existingRelations != null) {
        console.log('🚫 Tab relations already exist, skipping restore. Existing relations:', Object.keys(existingRelations).length);
        return existingRelations;
      }
      
      const tabs = await chrome.tabs.query({});
      const result = await chrome.storage.local.get(['persistentTabTree']);
      const persistentTree = result.persistentTabTree || { relations: [], snapshots: [] };
      
      console.log('🔄 Restoring from', persistentTree.relations.length, 'recorded relations');
      
      // 创建当前标签页的 URL 到 Tab 的映射
      const urlToTab = new Map();
      // console.log('📋 Current tabs:');
      tabs.forEach(tab => {
        const normalizedUrl = this.normalizeUrl(tab.url);
        urlToTab.set(normalizedUrl, tab);
        // console.log(`  ${tab.id}: ${normalizedUrl}`);
      });
      
      const restoredRelations = {};
      let restoredCount = 0;
      let unmatchedCount = 0;
      
      // 从关系历史记录恢复（按时间倒序，最新的优先）
      const sortedRelations = [...persistentTree.relations].sort((a, b) => b.timestamp - a.timestamp);
      
      console.log('🔍 Checking recorded relations:');
      sortedRelations.forEach(relation => {
        const childTab = urlToTab.get(relation.child.url);
        const parentTab = urlToTab.get(relation.parent.url);
        
        if (childTab && parentTab && childTab.id !== parentTab.id && !restoredRelations[childTab.id]) {
          restoredRelations[childTab.id] = parentTab.id;
          restoredCount++;
        } else {
          unmatchedCount++;
        }
      });
      
      // 补充：基于当前的 openerTabId
      tabs.forEach(tab => {
        if (tab.openerTabId && !restoredRelations[tab.id]) {
          const openerExists = tabs.some(t => t.id === tab.openerTabId);
          if (openerExists) {
            restoredRelations[tab.id] = tab.openerTabId;
            restoredCount++;
            console.log(`✓ Restored from current openerTabId: ${tab.id} -> ${tab.openerTabId}`);
          }
        }
      });
      
      // 保存标签页关系
      storageManager.saveTabRelations(restoredRelations);
      console.log(`🎉 Total restored: ${restoredCount} relations (${unmatchedCount} unmatched)`);
      
      return restoredRelations;
    } catch (error) {
      console.error('Error restoring relations:', error);
      return {};
    }
  }

  // 移除标签页相关的所有关系（持久化存储）
  async removeRelation(url) {
    try {
      const persistentTree = await storageManager.getPersistentTree();
      const normalizedUrl = this.normalizeUrl(url);
      persistentTree.relations = persistentTree.relations.filter(relation => relation.child.url !== normalizedUrl);
      storageManager.saveToPersistentTree(persistentTree);
    } catch(error) {
      console.error('Error removing persistent relation:', error);
    }
  }

  // 清理过期数据
  async cleanup() {
    try {
      const result = await chrome.storage.local.get(['persistentTabTree']);
      const persistentTree = result.persistentTabTree || { relations: [], snapshots: [] };
      
      const maxAge = 30 * 24 * 60 * 60 * 1000; // 30天
      const now = Date.now();
      
      const beforeCount = persistentTree.relations.length;
      persistentTree.relations = persistentTree.relations.filter(
        relation => now - relation.timestamp < maxAge
      );
      
      if (beforeCount > persistentTree.relations.length) {
        storageManager.saveToPersistentTree(persistentTree);
        console.log(`🧹 Cleaned up ${beforeCount - persistentTree.relations.length} expired relations`);
      }
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }
}


// 全局存储管理器实例
const storageManager = new StorageManager();
// 全局持久化存储实例
const persistentStorage = new TabTreePersistentStorage();
const pinnedTabStorage = new PinnedTabPersistentStorage();
// 全局设置缓存实例
const settingsCache = new SettingsCache();
// 创建延迟执行器实例（500ms延迟）
const tabSnapshotExecutor = new DelayedMergeExecutor(200);

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
    // window 可能已不存在/正在关闭，保守返回 false
    return false;
  }
}

// 监听标签页创建事件 - 优先使用 openerTabId + 持久化记录
chrome.tabs.onCreated.addListener(async (tab) => {
  console.log('Tab created:', tab.id, 'openerTabId:', tab.openerTabId, 'url:', tab.url);
  recordTabUrl(tab.id, tab.url || tab.pendingUrl || '');
  
  try {
    // 如果检测到窗口恢复，跳过自动父子关系设置
    if (isWindowRestoring) {
      console.log(`🔄 Window restoration in progress, skipping auto parent-child setup for tab ${tab.id}`);
      return;
    }
    
    let parentTab = null;
    
    // 优先使用 Chrome 原生的 openerTabId
    if (tab.openerTabId) {
      try {
        parentTab = await chrome.tabs.get(tab.openerTabId);
        await setTabParent(tab.id, tab.openerTabId);
        console.log(`✓ Parent set via openerTabId: ${tab.id} -> ${tab.openerTabId}`);
      } catch (error) {
        console.log('OpenerTab not found, falling back to active tab');
      }
    }
    
    // 回退方案：使用当前活动标签页作为父标签页
    if (!parentTab) {
      const [activeTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
      if (activeTab && activeTab.id !== tab.id) {
        parentTab = activeTab;
        await setTabParent(tab.id, activeTab.id);
        console.log(`✓ Parent set to active tab: ${tab.id} -> ${activeTab.id}`);
      }
    }
    
    // 记录到持久化存储
    if (parentTab) {
      await persistentStorage.recordRelation(tab, parentTab);
    }
  } catch (error) {
    console.error('Error setting tab parent on creation:', error);
  }
});

// 监听标签页URL更新 - 处理延迟加载的URL
// 设计说明：专门处理浏览器原生的 openerTabId 关系
// 当标签页创建时URL为空，URL加载完成后在此补充记录到持久化存储
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // 快速检查自动恢复设置（使用缓存）
  if (!settingsCache.isFeatureEnabled('autoRestore')) {
    return;
  }
  
  // 只处理URL更新且不在窗口恢复过程中
  if (changeInfo.url && !isWindowRestoring) {
    console.log('Tab URL updated:', tabId, 'new URL:', changeInfo.url);
    recordTabUrl(tabId, changeInfo.url);
    
    try {
      // 1. 处理原生的 openerTabId 关系（与 setTabParent 中的逻辑形成互补）
      if (tab.openerTabId) {
        try {
          const parentTab = await chrome.tabs.get(tab.openerTabId);
          await persistentStorage.recordRelation(tab, parentTab);
          console.log(`🔄 Native relation recorded: ${tabId} -> ${tab.openerTabId} (URL now available)`);
        } catch (error) {
          console.log('OpenerTab not found when updating URL:', error);
        }
      }
      
      // 2. 更新已存储关系中以该标签页为父节点的关系
      await updateChildRelationsForUpdatedParent(tabId, tab);
      
    } catch (error) {
      console.error('Error updating tab relation on URL change:', error);
    }
  }
});

// 更新父节点URL变化时的子节点关系
async function updateChildRelationsForUpdatedParent(parentTabId, updatedParentTab) {
  try {
    const persistentTree = await storageManager.getPersistentTree();
    const tabRelations = await storageManager.getTabRelationsSync() || {};
    
    // 查找所有以该标签页为父节点的子节点
    const childTabIds = Object.keys(tabRelations).filter(childId => 
      tabRelations[childId] == parentTabId
    );
    
    if (childTabIds.length === 0) {
      return; // 没有子节点，无需更新
    }
    
    console.log(`🔄 Updating relations for parent ${parentTabId} with ${childTabIds.length} children`);
    
    // 为每个子节点更新持久化存储中的父节点信息
    for (const childTabId of childTabIds) {
      try {
        const childTab = await chrome.tabs.get(parseInt(childTabId));
        
        // 使用更新后的父节点信息重新记录关系
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
    // 如果是窗口关闭导致的标签页移除
    if (removeInfo.isWindowClosing) {
      await removeTabRelations(tabId);
      tabIndexSnapshot.delete(tabId);
      // 清理滚动位置
      await cleanupScrollPositionForTab(tabId);
      // 不需要在这里清理置顶状态，因为基于URL的存储会在下次访问时自动清理
      return;
    }
    
    // 如果是通过插件关闭的标签页，不执行自动切换
    if (pluginClosedTabs.has(tabId)) {
      console.log(`Tab ${tabId} was closed by plugin, skipping auto-switch`);
      pluginClosedTabs.delete(tabId);
      await removeTabRelations(tabId);
      tabIndexSnapshot.delete(tabId);
      // 清理滚动位置
      await cleanupScrollPositionForTab(tabId);
      // 不需要在这里清理置顶状态，因为基于URL的存储会在下次访问时自动清理
      return;
    }

    // ✅ OAuth 登录弹窗（popup window）关闭：应回到上一个标签页（浏览器默认行为）
    // 不应触发 AutoBackTrack 的 sibling 跳转。
    const lastKnownUrl = tabLastKnownUrlById.get(tabId);
    const shouldSkipSmartSwitch = isGoogleOAuthUrl(lastKnownUrl) && await isPopupWindow(removeInfo.windowId);
    if (shouldSkipSmartSwitch) {
      console.log(`🔐 OAuth popup tab ${tabId} closed, skipping smart switch. url=`, lastKnownUrl);
      await removeTabRelations(tabId);
      await cleanupScrollPositionForTab(tabId);
      tabIndexSnapshot.delete(tabId);
      return;
    }
    
    console.log(`Tab ${tabId} was closed by user, checking settings...`);
    
    // 快速检查智能标签切换设置（使用缓存）
    if (!settingsCache.isFeatureEnabled('smartSwitch')) {
      console.log(`Smart tab switching is disabled, skipping auto-switch`);
      await removeTabRelations(tabId);
      await cleanupScrollPositionForTab(tabId);
      // 不需要在这里清理置顶状态，因为基于URL的存储会在下次访问时自动清理
      tabIndexSnapshot.delete(tabId);
      return;
    }
    
    // 更新方向检测索引
    updateCloseDirectionIndex(tabId);
    
    // 获取所有标签页关系数据
    const tabRelations = storageManager.getTabRelations();
    
    // 立即获取当前所有标签页（关闭后的状态）
    const remainingTabs = await chrome.tabs.query({});
    // console.log(`Remaining tabs after close:`, remainingTabs.map(t => `${t.id}(${t.index})`));
    
    // 查找要激活的下一个标签页
    const nextTabId = findNextTabToActivate(tabId, tabRelations || {}, remainingTabs);
    
    if (nextTabId) {
      console.log(`Activating next tab: ${nextTabId} after closing ${tabId}`);
      await chrome.tabs.update(nextTabId, { active: true });
    }
    
    // 清理相关的关系数据和快照
    await removeTabRelations(tabId);
    await cleanupScrollPositionForTab(tabId);
    // 不需要在这里清理置顶状态，因为基于URL的存储会在下次访问时自动清理
    tabIndexSnapshot.delete(tabId);
  } catch (error) {
    console.error('Error handling tab removal:', error);
  } finally {
    tabLastKnownUrlById.delete(tabId);
  }
  // 刷新快照
  updateTabSnapshot();
});



// 标签页激活时按需注入content script
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    // 只在http/https页面注入
    if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
      await injectContentScript(activeInfo.tabId);
    }
  } catch (error) {
    console.log('Error injecting content script on tab activation:', error);
  }
  try {
    storageManager.addToGlobalTabHistory(activeInfo.tabId);
  } catch (error) {
    console.log('Error injecting content script on tab activation:', error);
  }
});


// 监听来自popup和content script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 处理异步消息，确保 sendResponse 正确工作
  (async () => {
    try {
      if (request.action === 'linkClicked') {
        // 用户点击了链接，记录父子关系
        const parentTabId = sender.tab.id;
        
        // 等待新标签页创建
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
        // 标记通过插件关闭的标签页
        if (request.tabIds && Array.isArray(request.tabIds)) {
          request.tabIds.forEach(tabId => {
            pluginClosedTabs.add(tabId);
            console.log(`Marked tab ${tabId} as plugin-closed`);
          });
        }
        sendResponse({ success: true });
      } else if (request.action === 'restoreRelations') {
        // Popup 请求从持久化存储恢复关系
        console.log('Popup requested restore relations');
        await persistentStorage.restoreRelations();
        sendResponse({ success: true });
      } else if (request.action === 'getHistoryData') {
        sendResponse(await storageManager.getGlobalTabHistorySync());
      } else if (request.action === 'saveHistoryData') {
        // 保存历史记录数据
        if (request.historyData) {
          storageManager.saveGlobalTabHistory(request.historyData);
        }
        sendResponse({ success: true });
      } else if (request.action === 'getTabRelations') {
        // 获取当前的标签页关系缓存：
        // - 若缓存尚未初始化，返回 undefined 让 popup 继续轮询等待（避免误渲染为“平铺”）
        // - 若已初始化（即使为空对象），正常返回
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
        // 保存滚动位置
        if (request.url && request.position) {
          await storageManager.saveScrollPosition(request.url, request.position);
          console.log(`📜 Saved scroll position for ${request.url}:`, request.position);
        }
        sendResponse({ success: true });
      } else if (request.action === 'getScrollPosition') {
        // 获取滚动位置（同步版本）
        if (request.url) {
          const position = await storageManager.getScrollPositionSync(request.url);
          sendResponse(position);
          console.log(`📜 Retrieved scroll position for ${request.url}:`, position);
        } else {
          sendResponse(null);
        }
      } else if (request.action === 'removeScrollPosition') {
        // 移除滚动位置
        if (request.url) {
          await storageManager.removeScrollPosition(request.url);
          console.log(`🗑️ Removed scroll position for ${request.url}`);
        }
        sendResponse({ success: true });
      } else if (request.action === 'removeTabRelationsFor') {
        // 移除指定标签页的父子关系（用于置顶等场景）
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
      } else if (request.action === 'isFeatureEnabled') {
        // 同步检查特定功能是否启用
        if (request.feature) {
          const isEnabled = settingsCache.isFeatureEnabled(request.feature);
          sendResponse({ enabled: isEnabled });
          console.log(`📜 Feature ${request.feature} enabled:`, isEnabled);
        } else {
          sendResponse({ enabled: false });
        }
      } else if (request.action === 'addPinnedTab') {
        // 添加置顶标签页
        if (request.tabId && request.tabInfo) {
          const success = await pinnedTabStorage.addPinnedTab(request.tabId, request.tabInfo);
          sendResponse({ success });
        } else {
          sendResponse({ success: false, error: 'tabId and tabInfo required' });
        }
      } else if (request.action === 'removePinnedTab') {
        // 移除置顶标签页
        if (request.tabId) {
          const success = await pinnedTabStorage.removePinnedTab(request.tabId);
          sendResponse({ success });
        } else {
          sendResponse({ success: false, error: 'tabId required' });
        }
      } else if (request.action === 'getPinnedTabs') {
        // 获取所有置顶标签页（基于URL存储）
        const pinnedTabs = await storageManager.getPinnedTabs();
        sendResponse(pinnedTabs);
      } else if (request.action === 'getPinnedTabIdsCache') {
        // 获取基于当前tabId的置顶标签页映射（使用缓存）
        const pinnedTabIdsCache = await storageManager.getPinnedTabIdsCache(pinnedTabStorage);
        sendResponse(pinnedTabIdsCache);
      } else if (request.action === 'isPinnedTab') {
        // 检查标签页是否置顶
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
  
  // 返回 true 表示异步响应
  return true;
});

// 设置标签页的父标签页
async function setTabParent(childTabId, parentTabId) {
  try {
    const tabRelations = await storageManager.getTabRelationsSync() || {};
    
    tabRelations[childTabId] = parentTabId;
    
    storageManager.saveTabRelations(tabRelations);
    console.log(`Set parent for tab ${childTabId} to ${parentTabId}`);
    
    // 如果是手动设置的关系，也记录到持久化存储
    try {
      const [childTab, parentTab] = await Promise.all([
        chrome.tabs.get(childTabId),
        chrome.tabs.get(parentTabId)
      ]);
      
      // 避免重复记录：分工明确处理不同类型的父子关系
      // 1. 原生关系 (openerTabId)：由 onCreated + onUpdated 监听器处理
      // 2. 手动关系 (插件设置)：由此处记录到持久化存储
      // 只有当这不是基于浏览器原生 openerTabId 的自动关系时才记录
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

// 移除标签页相关的所有关系
async function removeTabRelations(removedTabId) {
  try {
    const tabRelations = storageManager.getTabRelations();
    if (!tabRelations) {
      return;
    } 

    // 移除以该标签页为子标签页的关系
    delete tabRelations[removedTabId];
    
    // 移除以该标签页为父标签页的关系
    Object.keys(tabRelations).forEach(childId => {
      if (tabRelations[childId] === removedTabId) {
        delete tabRelations[childId];
      }
    });
    
    storageManager.saveTabRelations(tabRelations);
    // console.log(`Cleaned up relations for removed tab ${removedTabId}`);
  } catch (error) {
    console.error('Error removing tab relations:', error);
  }
}

// 移除标签页相关的所有关系（持久化存储）
async function removeTabParentRelationsPersistent(removedTabId) {
  try {
    const tabRelations = storageManager.getTabRelations();
    if (!tabRelations) {
      return;
    } 
    // 移除以该标签页为子标签页的关系
    delete tabRelations[removedTabId];
    storageManager.saveTabRelations(tabRelations);

    const tab = await chrome.tabs.get(removedTabId);
    // 移除持久化存储中的关系
    if (tab && tab.url) {
      persistentStorage.removeRelation(tab.url);
      console.log(`🗑️ Removed persistent relation for ${tab.url}`);
    }
  } catch(error) {
    console.error('Error removing tab relations:', error);
  }
}




// 构建标签页树结构
function buildTabTree(tabs, tabRelations) {
  const tabMap = new Map();
  const rootTabs = [];
  
  // 创建标签页映射
  tabs.forEach(tab => {
    tabMap.set(tab.id, {
      ...tab,
      children: []
    });
  });
  
  // 构建父子关系
  tabs.forEach(tab => {
    const parentId = tabRelations[tab.id];
    if (parentId && tabMap.has(parentId)) {
      const parent = tabMap.get(parentId);
      const child = tabMap.get(tab.id);
      parent.children.push(child);
    } else {
      // 没有父节点的作为根节点
      rootTabs.push(tabMap.get(tab.id));
    }
  });
  
  return rootTabs;
}

// 旧的基于 openerTabId 的重建函数已被 persistentStorage.restoreRelations() 替代

// 插件安装时的初始化
chrome.runtime.onInstalled.addListener(async () => {
  try {
    console.log('🚀 Extension initialized');
    // 从持久化存储恢复关系
    await persistentStorage.restoreRelations();
    // 清理过期数据
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
    // 只在“所有 normal window 都关闭”时才清空内存缓存。
    // 否则（例如 OAuth popup window 关闭）不应影响其他正常窗口的树关系与历史。
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
  
  // 如果是正常窗口类型，标记为窗口恢复状态
  if (window.type === 'normal') {
    isWindowRestoring = true;
    console.log('🔄 Window restoration detected, will skip auto parent-child setup');
    
    // 4秒后执行恢复逻辑并重置状态
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
    // 清除之前的定时器
    if (rebuildTimeout) clearTimeout(rebuildTimeout);
    
    // 延迟1秒执行，避免频繁切换窗口时重复执行
    rebuildTimeout = setTimeout(async () => {
      console.log('🔄 Window focus changed, restoring relations...');
      await persistentStorage.restoreRelations();
    }, 1000);
  }
});

// 标签页更新时按需注入content script
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && 
      (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
    await injectContentScript(tabId);
  }
});

// 初始化时预加载滚动位置缓存
storageManager.getScrollPositions().then(() => {
  console.log('📜 Scroll positions cache preloaded');
}).catch(error => {
  console.error('Error preloading scroll positions cache:', error);
});

// 初始化时预加载设置缓存
settingsCache.getSettings().then(() => {
  console.log('📜 Settings cache preloaded');
}).catch(error => {
  console.error('Error preloading settings cache:', error);
});


// 初始化时立即建立快照
updateTabSnapshot();

// 初始化设置缓存
settingsCache.getSettings().catch(error => {
  console.warn('Failed to initialize settings cache:', error);
});

// 定期清理过期的滚动位置（每小时执行一次）
setInterval(async () => {
  try {
    await storageManager.cleanupOldScrollPositions();
  } catch (error) {
    console.error('Error during scroll position cleanup:', error);
  }
}, 60 * 60 * 1000); // 1小时

// 启动时立即执行一次清理
setTimeout(async () => {
  try {
    await storageManager.cleanupOldScrollPositions();
    await pinnedTabStorage.cleanupInvalidPinnedTabs();
    await pinnedTabStorage.cleanupExpiredPinnedTabs();
  } catch (error) {
    console.error('Error during initial cleanup:', error);
  }
}, 5000); // 5秒后执行

// 定期清理无效的置顶标签页（每30分钟执行一次）
setInterval(async () => {
  try {
    await pinnedTabStorage.cleanupInvalidPinnedTabs();
  } catch (error) {
    console.error('Error during pinned tabs cleanup:', error);
  }
}, 30 * 60 * 1000); // 30分钟

// 定期清理过期的置顶标签页（每天执行一次）
setInterval(async () => {
  try {
    await pinnedTabStorage.cleanupExpiredPinnedTabs();
  } catch (error) {
    console.error('Error during expired pinned tabs cleanup:', error);
  }
}, 24 * 60 * 60 * 1000); // 24小时

