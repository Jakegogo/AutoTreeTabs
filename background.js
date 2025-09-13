// 后台服务脚本 - 处理标签页创建和关系跟踪
// 基于 URL 的持久化系统，解决 tabId 和 openerTabId 重启后变化的问题

importScripts('src/background/PinnedTabPersistentStorage.js');
importScripts('src/background/DelayedMergeExecutor.js');
importScripts('src/background/SettingsCache.js');
importScripts('src/background/tools.js');

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
      
      // 检查是否已经有标签页关系数据，如果有则不进行恢复
      const existingRelations = storageManager.getTabRelations();
      if (existingRelations) {
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
          // console.log(`✓ Restored: ${childTab.id}(${relation.child.url}) -> ${parentTab.id}(${relation.parent.url})`);
        } else {
          unmatchedCount++;
          if (!childTab) {
            // console.log(`❌ Child not found: ${relation.child.url}`);
          } else if (!parentTab) {
            // console.log(`❌ Parent not found: ${relation.parent.url}`);
          } else if (restoredRelations[childTab.id]) {
            // console.log(`⚠️ Already restored: ${childTab.id}`);
          }
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

// Storage管理器 - 简化版本
class StorageManager {
  constructor() {
    this.persistentTreeCache = null;
    this.tabRelationsCache = null; // 仅内存缓存，不持久化
    this.scrollPositionsCache = null; // 滚动位置缓存，需要持久化
    this.pinnedTabsCache = null; // 置顶标签页缓存，需要持久化
    this.pinnedTabIdsCache = null; // 缓存 tabId -> pinnedTabInfo 映射，避免每次重建
    // 全局历史记录存储（多个标签页共享）, 仅当前窗口会话存储(关闭窗口后丢失)
    this.globalTabHistory = null;
    this.writeTimer = null;
    this.isWriting = false; // 写入执行状态标记
    this.pendingWrite = false; // 是否有待处理的写入请求
    this.WRITE_INTERVAL = 5000; // 5秒写入间隔
    this.maxHistorySize = 30; // 全局历史记录大小限制
    this.defaultRecentFilter = undefined; // 最近筛选默认偏好（内存缓存）
  }

  // 获取persistentTree
  async getPersistentTree() {
    if (!this.persistentTreeCache) {
      const result = await chrome.storage.local.get(['persistentTabTree']);
      this.persistentTreeCache = result.persistentTabTree || { relations: [], snapshots: [] };
    }
    return this.persistentTreeCache;
  }

  // 保存persistentTree到缓存和调度写入
  saveToPersistentTree(data) {
    this.persistentTreeCache = data;
    this.scheduleWrite();
  }

  // 从persistentTree移除数据
  removeFromPersistentTree() {
    this.persistentTreeCache = { relations: [], snapshots: [] };
    this.scheduleWrite();
  }

  // 获取tabRelations（仅内存缓存）
  getTabRelations() {
    return this.tabRelationsCache;
  }

  // 同步获取tabRelations，如果缓存为空则先恢复数据
  async getTabRelationsSync() {
    // 如果缓存为空，先从持久化存储恢复关系
    if (!this.tabRelationsCache) {
      console.log('📦 Cache is empty, restoring relations from persistent storage...');
      await persistentStorage.restoreRelations();
      if (!this.tabRelationsCache) {
        console.log('❌ Tab relations cache is still null after restore');
      } else {
        console.log('✅ Tab relations cache restored successfully, tabRelationsCache.size:', Object.keys(this.tabRelationsCache).length);
      }
    }
    return this.tabRelationsCache;
  }

  // 保存tabRelations到内存缓存（不持久化）
  saveTabRelations(data) {
    this.tabRelationsCache = data;
    // 不再调度写入，仅保存在内存中
  }

  // 从tabRelations移除数据（仅清空内存缓存）
  removeTabRelations() {
    this.tabRelationsCache = {};
    // 不再调度写入，仅清空内存缓存
  }

  // 获取滚动位置缓存
  async getScrollPositions() {
    if (!this.scrollPositionsCache) {
      const result = await chrome.storage.local.get(['scrollPositions']);
      this.scrollPositionsCache = result.scrollPositions || {};
    }
    return this.scrollPositionsCache;
  }

  // 保存滚动位置
  async saveScrollPosition(url, position) {
    if (!this.scrollPositionsCache) {
      await this.getScrollPositions();
    }
    this.scrollPositionsCache[url] = {
      scrollTop: position.scrollTop,
      scrollLeft: position.scrollLeft,
      timestamp: Date.now()
    };
    this.scheduleWrite();
  }

  // 获取特定URL的滚动位置（同步版本）
  async getScrollPositionSync(url) {
    if (!this.scrollPositionsCache) {
      // 如果缓存未加载，触发异步加载但返回null
      await this.getScrollPositions().catch(error => {
        console.error('Error loading scroll positions cache:', error);
      });
      return null;
    }
    return this.scrollPositionsCache[url] || null;
  }

  // 获取特定URL的滚动位置（异步版本，保留用于其他地方）
  async getScrollPosition(url) {
    const positions = await this.getScrollPositions();
    return positions[url] || null;
  }

  // 移除特定URL的滚动位置
  async removeScrollPosition(url) {
    if (!this.scrollPositionsCache) {
      await this.getScrollPositions();
    }
    delete this.scrollPositionsCache[url];
    this.scheduleWrite();
  }

  // 清理过期的滚动位置（7天以前的）
  async cleanupOldScrollPositions() {
    if (!this.scrollPositionsCache) {
      await this.getScrollPositions();
    }
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    let hasChanges = false;
    
    for (const [url, data] of Object.entries(this.scrollPositionsCache)) {
      if (data.timestamp < sevenDaysAgo) {
        delete this.scrollPositionsCache[url];
        hasChanges = true;
      }
    }
    
    if (hasChanges) {
      this.scheduleWrite();
      console.log('🧹 Cleaned up old scroll positions');
    }
  }

  // 获取置顶标签页缓存
  async getPinnedTabs() {
    if (!this.pinnedTabsCache) {
      const result = await chrome.storage.local.get(['pinnedTabs']);
      this.pinnedTabsCache = result.pinnedTabs || {};
    }
    return this.pinnedTabsCache;
  }

  // 获取 pinnedTabIdsCache，如果不存在则构建
  async getPinnedTabIdsCache() {
    if (!this.pinnedTabIdsCache) {
      this.pinnedTabIdsCache = await pinnedTabStorage.buildPinnedTabIdsCache();
      console.log(`🔄 Rebuilt pinnedTabIdsCache: ${Object.keys(this.pinnedTabIdsCache).length} tabs`);
    }
    return this.pinnedTabIdsCache;
  }


  // 清除 pinnedTabIdsCache，强制下次重建
  clearPinnedTabIdsCache() {
    this.pinnedTabIdsCache = null;
    console.log('🗑️ Cleared pinnedTabIdsCache');
  }


  // 获取全局历史记录
  async getGlobalTabHistorySync() {
    if (!this.globalTabHistory) {
      const result = await chrome.storage.local.get(['globalTabHistory']);
      this.globalTabHistory = result.globalTabHistory || { history: [], currentIndex: -1 };
    }
    return this.globalTabHistory;
  }

  // 添加到全局历史记录
  async addToGlobalTabHistory(tabId) {
    const data = this.globalTabHistory || { history: [], currentIndex: -1 };
  
    // 如果新标签页不是当前标签页，则添加到历史记录
    if (data.history[data.currentIndex] !== tabId) {
      // 如果当前不在历史记录的末尾，删除后面的记录
      if (data.currentIndex < data.history.length - 1) {
        data.history = data.history.slice(0, data.currentIndex + 1);
      }
      
      data.history.push(tabId);
      data.currentIndex++;

      // 限制历史记录大小
      if (data.history.length > this.maxHistorySize) {
        data.history.shift();
        data.currentIndex--;
      }
      this.globalTabHistory = data;
      this.scheduleWrite();
      console.log(`📚 History added: ${tabId}, index: ${data.currentIndex}, history: [${data.history.join(', ')}]`);
    }
  }

  saveGlobalTabHistory(data) {
    this.globalTabHistory = data;
    this.scheduleWrite();
    console.log('📚 History data saved:', data);
  }

  // 清空全局历史记录
  clearGlobalTabHistory() {
    this.globalTabHistory = null;
    this.scheduleWrite();
    console.log('🗑️ Global tab history cleared');
  }

  // 最近筛选默认值：读取（带内存缓存）
  async getDefaultRecentFilter() {
    if (typeof this.defaultRecentFilter === 'boolean') {
      return this.defaultRecentFilter;
    }
    const store = await chrome.storage.local.get('defaultRecentFilter');
    this.defaultRecentFilter = !!store.defaultRecentFilter;
    return this.defaultRecentFilter;
  }

  // 最近筛选默认值：写入并更新缓存
  async setDefaultRecentFilter(value) {
    this.defaultRecentFilter = !!value;
    await chrome.storage.local.set({ defaultRecentFilter: this.defaultRecentFilter });
    return true;
  }

  // 调度写入 - 并发安全版本
  scheduleWrite() {
    // 如果正在执行写入，标记有待处理的写入请求
    if (this.isWriting) {
      this.pendingWrite = true;
      return;
    }
    
    // 如果定时器已存在，直接返回，不创建新的定时器
    if (this.writeTimer !== null) {
      return;
    }

    this.writeTimer = setTimeout(async () => {
      this.writeTimer = null; // 立即清空定时器
      
      // 执行写入操作（可能有循环）
      do {
        this.pendingWrite = false; // 重置待处理标记
        this.isWriting = true; // 设置执行状态
        
        try {
          const dataToWrite = {};
          
          if (this.persistentTreeCache) {
            dataToWrite.persistentTabTree = this.persistentTreeCache;
          }
          
          if (this.scrollPositionsCache) {
            dataToWrite.scrollPositions = this.scrollPositionsCache;
          }

          if (this.pinnedTabsCache) {
            dataToWrite.pinnedTabs = this.pinnedTabsCache;
          }

          if (this.globalTabHistory) {
            dataToWrite.globalTabHistory = this.globalTabHistory;
          }
          
          if (Object.keys(dataToWrite).length > 0) {
            console.log(`💾 Writing cached data to storage:`, Object.keys(dataToWrite));
            await chrome.storage.local.set(dataToWrite);
            console.log('✅ Storage write completed');
          }
          
        } catch (error) {
          console.error('Storage write error:', error);
          
          // 发生错误时延迟重试
          this.isWriting = false;
          setTimeout(() => this.scheduleWrite(), 1000);
          return;
        }
        
        this.isWriting = false; // 清除执行状态
        
        // 如果在执行期间有新的写入请求，继续执行
      } while (this.pendingWrite);
    }, this.WRITE_INTERVAL);
  }

  // 立即强制写入 - 并发安全版本
  async forceWrite() {
    // 取消已有的定时器
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    
    // 等待当前写入操作完成
    while (this.isWriting) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    this.isWriting = true; // 设置执行状态
    this.pendingWrite = false; // 清除待处理标记
    
    try {
      const dataToWrite = {};
      
      if (this.persistentTreeCache) {
        dataToWrite.persistentTabTree = this.persistentTreeCache;
      }
      
      if (this.scrollPositionsCache) {
        dataToWrite.scrollPositions = this.scrollPositionsCache;
      }
      
      if (this.pinnedTabsCache) {
        dataToWrite.pinnedTabs = this.pinnedTabsCache;
      }
      
      // tabRelations 不再持久化，仅保存在内存中
      
      if (Object.keys(dataToWrite).length > 0) {
        console.log(`💾 Force writing cached data to storage:`, Object.keys(dataToWrite));
        await chrome.storage.local.set(dataToWrite);
        console.log('✅ Force write completed');
      }
    } catch (error) {
      console.error('Force write error:', error);
    } finally {
      this.isWriting = false; // 确保状态被清除
    }
  }

  // 清理（在扩展卸载时调用）
  cleanup() {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    // 重置状态标记
    this.isWriting = false;
    this.pendingWrite = false;
  }
}

// 全局存储管理器实例
const storageManager = new StorageManager();

// 全局持久化存储实例
const persistentStorage = new TabTreePersistentStorage();
const pinnedTabStorage = new PinnedTabPersistentStorage();

// SettingsCache 已移至 src/background/SettingsCache.js


// 全局设置缓存实例
const settingsCache = new SettingsCache();

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


// 标签页关闭方向追踪（简单索引方案）
let tabCloseDirection = {
  lastCloseTabIndex: -1,        // 上一次关闭的标签页索引
  beforeLastCloseTabIndex: -1,  // 上上次关闭的标签页索引
  currentDirection: 'right'     // 当前方向：'left' 或 'right'
};

// 更新关闭方向索引
function updateCloseDirectionIndex(closedTabId) {
  try {
    // 从快照中获取被关闭标签页的索引位置
    const snapshotInfo = tabIndexSnapshot.get(closedTabId);
    if (!snapshotInfo) {
      console.log(`⚠️ Cannot find closed tab ${closedTabId} in tabIndexSnapshot`);
      return;
    }
    
    const currentIndex = snapshotInfo.index;
    
    // 更新索引记录：当前 -> 上次，上次 -> 上上次
    tabCloseDirection.beforeLastCloseTabIndex = tabCloseDirection.lastCloseTabIndex;
    tabCloseDirection.lastCloseTabIndex = currentIndex;
    
    console.log(`📍 Updated close indexes: current=${currentIndex}, last=${tabCloseDirection.beforeLastCloseTabIndex}`);
  } catch (error) {
    console.error('❌ Error updating close direction index:', error);
  }
}

// 基于索引检测标签页关闭方向
function detectCloseDirectionFromIndex() {
  try {
    // 如果没有足够的历史记录，使用默认方向
    if (tabCloseDirection.lastCloseTabIndex === -1 || tabCloseDirection.beforeLastCloseTabIndex === -1) {
      console.log('🔍 No sufficient history, using default direction:', tabCloseDirection.currentDirection);
      return tabCloseDirection.currentDirection;
    }
    
    const lastIndex = tabCloseDirection.lastCloseTabIndex;
    const beforeLastIndex = tabCloseDirection.beforeLastCloseTabIndex;
    
    console.log(`🔍 Index comparison: before last=${beforeLastIndex}, last=${lastIndex}`);
    
    // 简单的方向判断逻辑
    if (lastIndex < beforeLastIndex) {
      tabCloseDirection.currentDirection = 'left';
      console.log('🏃‍⬅️ Direction detected: LEFT (closing tabs from right to left)');
    } else {
      tabCloseDirection.currentDirection = 'right';
      console.log('🏃‍➡️ Direction detected: RIGHT (closing tabs from left to right)');
    }
    
    return tabCloseDirection.currentDirection;
  } catch (error) {
    console.error('❌ Error detecting close direction from index:', error);
    return tabCloseDirection.currentDirection;
  }
}

// 监听设置变化，清除缓存
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.extensionSettings) {
    console.log('📝 Extension settings changed, clearing cache');
    settingsCache.clearCache();
  }
});

// 创建延迟执行器实例（500ms延迟）
const tabSnapshotExecutor = new DelayedMergeExecutor(200);

// 监听标签页创建事件 - 优先使用 openerTabId + 持久化记录
chrome.tabs.onCreated.addListener(async (tab) => {
  console.log('Tab created:', tab.id, 'openerTabId:', tab.openerTabId, 'url:', tab.url);
  
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

// 标记通过插件关闭的标签页
let pluginClosedTabs = new Set();

// 存储标签页状态，用于在关闭时恢复顺序信息
let tabIndexSnapshot = new Map();

// 监听标签页更新，保存位置信息
chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
  // 当标签页移动时延迟更新快照
  tabSnapshotExecutor.addEvent(updateTabSnapshot, []);
});

chrome.tabs.onCreated.addListener(() => {
  // 当创建新标签页时延迟更新快照
  tabSnapshotExecutor.addEvent(updateTabSnapshot, []);
});

// 更新标签页位置快照
async function updateTabSnapshot() {
  try {
    const tabs = await chrome.tabs.query({});
    tabs.forEach(tab => {
      tabIndexSnapshot.set(tab.id, { index: tab.index, windowId: tab.windowId });
    });
  } catch (error) {
    console.error('Error updating tab snapshot:', error);
  }
}

// 初始化时立即建立快照
updateTabSnapshot();

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
  }
  // 刷新快照
  updateTabSnapshot();
});

// injectContentScript 已迁移到 src/background/tools.js

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


// 标签页更新时按需注入content script
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && 
      (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
    await injectContentScript(tabId);
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
        // 获取当前的标签页关系缓存，如果没有值则先恢复数据
        const tabRelations = storageManager.getTabRelations() || {};
        if (!tabRelations) {
          // 如果缓存为空，使用同步方法恢复数据
          const restoredRelations = await storageManager.getTabRelationsSync();
          console.log('🔄 getTabRelations returns:', Object.keys(restoredRelations).length);
          sendResponse(restoredRelations);
        } else {
          sendResponse(tabRelations);
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

// 清理标签页的滚动位置（根据URL）
async function cleanupScrollPositionForTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.url) {
      await storageManager.removeScrollPosition(tab.url);
      console.log(`🗑️ Removed scroll position for ${tab.url}`);
    }
  } catch (error) {
    // 标签页已关闭，无法获取URL，跳过清理
    // console.log(`Could not clean scroll position for tab ${tabId}: tab no longer exists`);
  }
}

// 查找下一个要激活的标签页（智能方向检测 - 基于索引）
function findNextTabToActivate(closedTabId, tabRelations, allTabs) {
  // 检测关闭方向（基于索引）
  const direction = detectCloseDirectionFromIndex();
  console.log(`🧭 Using direction: ${direction.toUpperCase()} for sibling search`);
  
  const tabMap = new Map();
  
  // 创建标签页映射
  allTabs.forEach(tab => {
    tabMap.set(tab.id, tab);
  });
  
  // 构建树结构
  const tree = buildTabTree(allTabs, tabRelations);
  
  // 查找被关闭标签页的父节点ID
  const parentId = tabRelations[closedTabId];
  
  if (parentId && tabMap.has(parentId)) {
    // 找到父节点，查找同级节点
    const siblings = allTabs.filter(tab => tabRelations[tab.id] === parentId);
    
    // 根据检测到的方向优先查找兄弟节点
    if (direction === 'right') {
      // 优先查找下一个兄弟节点（往右）
      const nextSibling = findNextSibling(closedTabId, siblings);
      if (nextSibling) {
        console.log(`Found next sibling (RIGHT): ${nextSibling.id}`);
        return nextSibling.id;
      }
      
      // 没有下一个兄弟节点，查找前一个兄弟节点
      const previousSibling = findPreviousSibling(closedTabId, siblings);
      if (previousSibling) {
        console.log(`No next sibling, found previous sibling (fallback): ${previousSibling.id}`);
        return previousSibling.id;
      }
    } else {
      // 优先查找前一个兄弟节点（往左）
      const previousSibling = findPreviousSibling(closedTabId, siblings);
      if (previousSibling) {
        console.log(`Found previous sibling (LEFT): ${previousSibling.id}`);
        return previousSibling.id;
      }
      
      // 没有前一个兄弟节点，查找下一个兄弟节点
      const nextSibling = findNextSibling(closedTabId, siblings);
      if (nextSibling) {
        console.log(`No previous sibling, found next sibling (fallback): ${nextSibling.id}`);
        return nextSibling.id;
      }
    }
    
    // 没有找到任何兄弟节点，返回父节点
    console.log(`No siblings found, activating parent: ${parentId}`);
    return parentId;
  } else {
    // 是根节点，查找同级的根节点
    const rootTabs = allTabs.filter(tab => !tabRelations[tab.id]);
    
    // 根据方向优先查找根节点兄弟
    if (direction === 'right') {
      // 优先查找下一个根兄弟节点
      const nextRoot = findNextSibling(closedTabId, rootTabs);
      if (nextRoot) {
        console.log(`Found next root sibling (RIGHT): ${nextRoot.id}`);
        return nextRoot.id;
      }
      
      // 没有下一个根兄弟节点，查找前一个根兄弟节点
      const previousRoot = findPreviousSibling(closedTabId, rootTabs);
      if (previousRoot) {
        console.log(`No next root sibling, found previous root sibling (fallback): ${previousRoot.id}`);
        return previousRoot.id;
      }
    } else {
      // 优先查找前一个根兄弟节点
      const previousRoot = findPreviousSibling(closedTabId, rootTabs);
      if (previousRoot) {
        console.log(`Found previous root sibling (LEFT): ${previousRoot.id}`);
        return previousRoot.id;
      }
      
      // 没有前一个根兄弟节点，查找下一个根兄弟节点
      const nextRoot = findNextSibling(closedTabId, rootTabs);
      if (nextRoot) {
        console.log(`No previous root sibling, found next root sibling (fallback): ${nextRoot.id}`);
        return nextRoot.id;
      }
    }
  }
  
  return null;
}

// 查找兄弟节点（通用方法）
function findSibling(targetTabId, siblings, direction = 'previous') {
  const directionText = direction === 'previous' ? 'previous' : 'next';
  console.log(`Looking for ${directionText} sibling of tab ${targetTabId}`);
  
  if (!tabIndexSnapshot.has(targetTabId)) {
    console.log(`No snapshot data for target tab ${targetTabId}`);
    return null;
  }
  
  const closedTabInfo = tabIndexSnapshot.get(targetTabId);
  console.log(`Closed tab ${targetTabId} was at index ${closedTabInfo.index}`);
  console.log(`Available siblings:`, siblings.map(tab => `${tab.id}(${tab.index})`));
  
  // 重新构建关闭前的完整位置信息
  // 现在所有剩余标签页的 index 已经重新排列，我们需要重建关闭前的顺序
  const reconstructedSiblings = [];
  
  // 为每个兄弟标签页分配正确的原始位置
  siblings.forEach(tab => {
    if (tab.index < closedTabInfo.index) {
      // 这个标签页在关闭的标签页之前，位置不变
      reconstructedSiblings.push({ ...tab, originalIndex: tab.index });
    } else {
      // 这个标签页在关闭的标签页之后，原始位置应该 +1
      reconstructedSiblings.push({ ...tab, originalIndex: tab.index + 1 });
    }
  });
  
  // 添加关闭的标签页
  reconstructedSiblings.push({
    id: targetTabId,
    originalIndex: closedTabInfo.index,
    title: '(closed)'
  });
  
  // 按原始位置排序
  reconstructedSiblings.sort((a, b) => a.originalIndex - b.originalIndex);
  console.log(`Reconstructed order:`, reconstructedSiblings.map(tab => `${tab.id}(${tab.originalIndex})`));
  
  const targetIndex = reconstructedSiblings.findIndex(tab => tab.id === targetTabId);
  console.log(`Target tab was at position: ${targetIndex}`);
  
  let siblingIndex;
  if (direction === 'previous') {
    // 查找前一个兄弟节点
    if (targetIndex > 0) {
      siblingIndex = targetIndex - 1;
    }
  } else {
    // 查找下一个兄弟节点
    if (targetIndex < reconstructedSiblings.length - 1) {
      siblingIndex = targetIndex + 1;
    }
  }
  
  if (siblingIndex !== undefined) {
    const sibling = reconstructedSiblings[siblingIndex];
    // 确保返回的是仍然存在的标签页
    const existingSibling = siblings.find(tab => tab.id === sibling.id);
    if (existingSibling) {
      console.log(`Found ${directionText} sibling: ${existingSibling.id} (was at original index: ${sibling.originalIndex})`);
      return existingSibling;
    }
  }
  
  console.log(`No ${directionText} sibling found`);
  return null;
}

// 为了保持向后兼容，创建包装函数
function findPreviousSibling(targetTabId, siblings) {
  return findSibling(targetTabId, siblings, 'previous');
}

function findNextSibling(targetTabId, siblings) {
  return findSibling(targetTabId, siblings, 'next');
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
  console.log('🗑️ Window closed:', windowId, 'clearing all tabRelations');
  
  try {
    // 完全清除内存中的标签关系，依赖持久化存储恢复
    storageManager.removeTabRelations();
    console.log('✅ All tabRelations cleared on window close');
    storageManager.clearGlobalTabHistory();
    console.log('✅ Global tab history cleared on window close');
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
