(() => {
  // src/background/StorageManager.js
  var StorageManager = class {
    constructor() {
      this.persistentTreeCache = null;
      this.tabRelationsCache = null;
      this.scrollPositionsCache = null;
      this.pinnedTabsCache = null;
      this.pinnedTabIdsCache = null;
      this.globalTabHistory = null;
      this.writeTimer = null;
      this.isWriting = false;
      this.pendingWrite = false;
      this.WRITE_INTERVAL = 5e3;
      this.maxHistorySize = 30;
      this.defaultRecentFilter = void 0;
      this._persistentStorage = null;
      this._pinnedTabStorage = null;
    }
    // 晚绑定：在 instances.js 中创建所有实例后调用
    init(persistentStorage2, pinnedTabStorage2) {
      this._persistentStorage = persistentStorage2;
      this._pinnedTabStorage = pinnedTabStorage2;
    }
    // 获取persistentTree
    async getPersistentTree() {
      if (!this.persistentTreeCache) {
        const result = await chrome.storage.local.get(["persistentTabTree"]);
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
      if (!this.tabRelationsCache) {
        console.log("\u{1F4E6} Cache is empty, restoring relations from persistent storage...");
        await this._persistentStorage.restoreRelations();
        if (!this.tabRelationsCache) {
          console.log("\u274C Tab relations cache is still null after restore");
        } else {
          console.log("\u2705 Tab relations cache restored successfully, tabRelationsCache.size:", Object.keys(this.tabRelationsCache).length);
        }
      }
      return this.tabRelationsCache;
    }
    // 保存tabRelations到内存缓存（不持久化）
    saveTabRelations(data) {
      this.tabRelationsCache = data;
    }
    // 从tabRelations移除数据（仅清空内存缓存）
    removeTabRelations() {
      this.tabRelationsCache = null;
    }
    // 获取滚动位置缓存
    async getScrollPositions() {
      if (!this.scrollPositionsCache) {
        const result = await chrome.storage.local.get(["scrollPositions"]);
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
        await this.getScrollPositions().catch((error) => {
          console.error("Error loading scroll positions cache:", error);
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
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1e3;
      let hasChanges = false;
      for (const [url, data] of Object.entries(this.scrollPositionsCache)) {
        if (data.timestamp < sevenDaysAgo) {
          delete this.scrollPositionsCache[url];
          hasChanges = true;
        }
      }
      if (hasChanges) {
        this.scheduleWrite();
        console.log("\u{1F9F9} Cleaned up old scroll positions");
      }
    }
    // 获取置顶标签页缓存
    async getPinnedTabs() {
      if (!this.pinnedTabsCache) {
        const result = await chrome.storage.local.get(["pinnedTabs"]);
        this.pinnedTabsCache = result.pinnedTabs || {};
      }
      return this.pinnedTabsCache;
    }
    // 获取 pinnedTabIdsCache，如果不存在则构建
    async getPinnedTabIdsCache() {
      if (!this.pinnedTabIdsCache) {
        this.pinnedTabIdsCache = await this._pinnedTabStorage.buildPinnedTabIdsCache();
        console.log(`\u{1F504} Rebuilt pinnedTabIdsCache: ${Object.keys(this.pinnedTabIdsCache).length} tabs`);
      }
      return this.pinnedTabIdsCache;
    }
    // 清除 pinnedTabIdsCache，强制下次重建
    clearPinnedTabIdsCache() {
      this.pinnedTabIdsCache = null;
      console.log("\u{1F5D1}\uFE0F Cleared pinnedTabIdsCache");
    }
    // 获取全局历史记录
    async getGlobalTabHistorySync() {
      if (!this.globalTabHistory) {
        const result = await chrome.storage.local.get(["globalTabHistory"]);
        this.globalTabHistory = result.globalTabHistory || { history: [], currentIndex: -1 };
      }
      return this.globalTabHistory;
    }
    // 添加到全局历史记录
    async addToGlobalTabHistory(tabId) {
      const data = this.globalTabHistory || { history: [], currentIndex: -1 };
      if (data.history[data.currentIndex] !== tabId) {
        if (data.currentIndex < data.history.length - 1) {
          data.history = data.history.slice(0, data.currentIndex + 1);
        }
        data.history.push(tabId);
        data.currentIndex++;
        if (data.history.length > this.maxHistorySize) {
          data.history.shift();
          data.currentIndex--;
        }
        this.globalTabHistory = data;
        this.scheduleWrite();
        console.log(`\u{1F4DA} History added: ${tabId}, index: ${data.currentIndex}, history: [${data.history.join(", ")}]`);
      }
    }
    saveGlobalTabHistory(data) {
      this.globalTabHistory = data;
      this.scheduleWrite();
      console.log("\u{1F4DA} History data saved:", data);
    }
    // 清空全局历史记录
    clearGlobalTabHistory() {
      this.globalTabHistory = null;
      this.scheduleWrite();
      console.log("\u{1F5D1}\uFE0F Global tab history cleared");
    }
    // 最近筛选默认值：读取（带内存缓存）
    async getDefaultRecentFilter() {
      if (typeof this.defaultRecentFilter === "boolean") {
        return this.defaultRecentFilter;
      }
      const store = await chrome.storage.local.get("defaultRecentFilter");
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
      if (this.isWriting) {
        this.pendingWrite = true;
        return;
      }
      if (this.writeTimer !== null) {
        return;
      }
      this.writeTimer = setTimeout(async () => {
        this.writeTimer = null;
        do {
          this.pendingWrite = false;
          this.isWriting = true;
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
              console.log(`\u{1F4BE} Writing cached data to storage:`, Object.keys(dataToWrite));
              await chrome.storage.local.set(dataToWrite);
              console.log("\u2705 Storage write completed");
            }
          } catch (error) {
            console.error("Storage write error:", error);
            this.isWriting = false;
            setTimeout(() => this.scheduleWrite(), 1e3);
            return;
          }
          this.isWriting = false;
        } while (this.pendingWrite);
      }, this.WRITE_INTERVAL);
    }
    // 立即强制写入 - 并发安全版本
    async forceWrite() {
      if (this.writeTimer) {
        clearTimeout(this.writeTimer);
        this.writeTimer = null;
      }
      while (this.isWriting) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      this.isWriting = true;
      this.pendingWrite = false;
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
        if (Object.keys(dataToWrite).length > 0) {
          console.log(`\u{1F4BE} Force writing cached data to storage:`, Object.keys(dataToWrite));
          await chrome.storage.local.set(dataToWrite);
          console.log("\u2705 Force write completed");
        }
      } catch (error) {
        console.error("Force write error:", error);
      } finally {
        this.isWriting = false;
      }
    }
    // 清理（在扩展卸载时调用）
    cleanup() {
      if (this.writeTimer) {
        clearTimeout(this.writeTimer);
        this.writeTimer = null;
      }
      this.isWriting = false;
      this.pendingWrite = false;
    }
  };

  // src/background/SettingsCache.js
  var SettingsCache = class {
    constructor() {
      this.cache = null;
      this.lastUpdate = 0;
      this.CACHE_DURATION = 6e4;
      this.pendingPromise = null;
    }
    // 获取缓存的设置
    async getSettings() {
      const now = Date.now();
      if (this.cache && now - this.lastUpdate < this.CACHE_DURATION) {
        return this.cache;
      }
      if (this.pendingPromise) {
        return await this.pendingPromise;
      }
      this.pendingPromise = this.loadFromStorage();
      try {
        const settings = await this.pendingPromise;
        this.cache = settings;
        this.lastUpdate = now;
        return settings;
      } finally {
        this.pendingPromise = null;
      }
    }
    // 从存储加载设置
    async loadFromStorage() {
      return new Promise((resolve) => {
        chrome.storage.local.get(["extensionSettings"], (result) => {
          const settings = result.extensionSettings || {};
          const defaultSettings = {
            autoRestore: true,
            smartSwitch: true,
            // 默认启用智能标签切换
            showTabGroups: false,
            // 默认不显示分组
            ...settings
          };
          resolve(defaultSettings);
        });
      });
    }
    // 清除缓存（当设置更新时调用）
    clearCache() {
      this.cache = null;
      this.lastUpdate = 0;
      console.log("\u{1F5D1}\uFE0F Settings cache cleared");
    }
    // 更新缓存（当设置更新时调用）
    updateCache(newSettings) {
      this.cache = newSettings;
      this.lastUpdate = Date.now();
      console.log("\u{1F504} Settings cache updated");
    }
    // 快速检查特定设置（用于高频调用）
    isFeatureEnabled(featureName) {
      const now = Date.now();
      if (this.cache && now - this.lastUpdate < this.CACHE_DURATION) {
        return this.cache[featureName] !== false;
      }
      this.getSettings().catch((error) => {
        console.warn("Failed to update settings cache:", error);
      });
      if (this.cache) {
        return this.cache[featureName] !== false;
      }
      const defaults = {
        autoRestore: true,
        smartSwitch: true,
        showTabGroups: false
      };
      return defaults[featureName] !== false;
    }
    // 同步检查特定设置，如果没有缓存则等待初始化
    async isFeatureEnabledSync(featureName) {
      const now = Date.now();
      if (this.cache && now - this.lastUpdate < this.CACHE_DURATION) {
        return this.cache[featureName] !== false;
      }
      await this.getSettings();
      if (this.cache) {
        return this.cache[featureName] !== false;
      }
      const defaults = {
        autoRestore: true,
        smartSwitch: true,
        showTabGroups: false
      };
      return defaults[featureName] !== false;
    }
  };

  // src/background/DelayedMergeExecutor.js
  var DelayedMergeExecutor = class {
    constructor(delay = 500) {
      this.delay = delay;
      this.eventQueue = [];
      this.timer = null;
    }
    /**
     * 添加延迟执行事件
     * @param {Function} func - 要执行的函数
     * @param {Array} args - 函数参数
     * @param {string} key - 事件唯一标识（可选，用于去重）
     */
    addEvent(func, args = [], key = null) {
      const event = {
        func,
        args,
        key,
        timestamp: Date.now()
      };
      if (key) {
        this.eventQueue = this.eventQueue.filter((e) => e.key !== key);
      }
      this.eventQueue.push(event);
      console.log(`\u{1F4DD} Added delayed event (queue size: ${this.eventQueue.length})`);
      if (!this.timer) {
        this.scheduleExecution();
      }
    }
    /**
     * 调度执行
     */
    scheduleExecution() {
      this.timer = setTimeout(() => {
        this.executeEvents();
      }, this.delay);
      console.log(`\u23F0 Scheduled execution in ${this.delay}ms`);
    }
    /**
     * 执行事件队列
     */
    executeEvents() {
      console.log(`\u{1F680} Executing delayed events (queue size: ${this.eventQueue.length})`);
      this.timer = null;
      if (this.eventQueue.length === 0) {
        console.log("\u{1F4ED} Event queue is empty, no execution");
        return;
      }
      if (this.eventQueue.length === 1) {
        const event = this.eventQueue[0];
        this.eventQueue = [];
        try {
          console.log(`\u2705 Executing single event`);
          event.func.apply(null, event.args);
        } catch (error) {
          console.error("Error executing delayed event:", error);
        }
        return;
      }
      const eventToExecute = this.eventQueue[this.eventQueue.length - 2];
      const lastEvent = this.eventQueue[this.eventQueue.length - 1];
      this.eventQueue = [lastEvent];
      try {
        console.log(`\u2705 Executing second-to-last event (keeping last in queue)`);
        eventToExecute.func.apply(null, eventToExecute.args);
      } catch (error) {
        console.error("Error executing delayed event:", error);
      }
      if (this.eventQueue.length > 0) {
        console.log(`\u{1F504} Queue not empty, scheduling next execution`);
        this.scheduleExecution();
      }
    }
    /**
     * 立即执行所有事件并清空队列
     */
    flush() {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      while (this.eventQueue.length > 0) {
        const event = this.eventQueue.shift();
        try {
          event.func.apply(null, event.args);
        } catch (error) {
          console.error("Error flushing delayed event:", error);
        }
      }
    }
    /**
     * 清空队列但不执行
     */
    clear() {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.eventQueue = [];
      console.log("\u{1F5D1}\uFE0F Delayed event queue cleared");
    }
  };

  // src/background/TabTreePersistentStorage.js
  var TabTreePersistentStorage = class {
    constructor(storageManager2, settingsCache2) {
      this._sm = storageManager2;
      this._sc = settingsCache2;
      this.maxHistory = 500;
    }
    // 规范化 URL（只移除hash片段，保留所有查询参数）
    normalizeUrl(url) {
      try {
        const urlObj = new URL(url);
        urlObj.hash = "";
        return urlObj.href;
      } catch (error) {
        return url.split("#")[0];
      }
    }
    // 创建标签页的稳定标识符
    createTabSignature(tab) {
      const effectiveUrl = tab.url || tab.pendingUrl || "";
      return {
        url: this.normalizeUrl(effectiveUrl),
        title: tab.title || "",
        favIconUrl: tab.favIconUrl || ""
      };
    }
    // 记录标签页关系
    async recordRelation(childTab, parentTab) {
      if (!this._sc.isFeatureEnabled("autoRestore")) {
        return {};
      }
      try {
        const persistentTree = await this._sm.getPersistentTree();
        const childSignature = this.createTabSignature(childTab);
        const parentSignature = this.createTabSignature(parentTab);
        if (!childSignature.url || !parentSignature.url || childSignature.url.trim() === "" || parentSignature.url.trim() === "" || childSignature.url === "chrome://newtab/" || parentSignature.url === "chrome://newtab/" || childSignature.url.startsWith("chrome-extension://") || parentSignature.url.startsWith("chrome-extension://")) {
          console.log("\u{1F6AB} Skipping record: invalid URLs", childSignature.url, "->", parentSignature.url);
          return;
        }
        const existingRelation = persistentTree.relations.find(
          (relation) => relation.child.url === childSignature.url && relation.parent.url === parentSignature.url
        );
        if (existingRelation) {
          existingRelation.timestamp = Date.now();
          console.log("\u{1F504} Updated existing relation:", childSignature.url, "->", parentSignature.url);
        } else {
          const relation = {
            child: childSignature,
            parent: parentSignature,
            timestamp: Date.now(),
            method: childTab.openerTabId === parentTab.id ? "opener" : "manual"
          };
          persistentTree.relations.push(relation);
          console.log("\u{1F4DD} Recorded new relation:", relation.child.url, "->", relation.parent.url);
        }
        if (persistentTree.relations.length > this.maxHistory) {
          persistentTree.relations = persistentTree.relations.slice(-this.maxHistory);
        }
        this._sm.saveToPersistentTree(persistentTree);
      } catch (error) {
        console.error("Error recording relation:", error);
      }
    }
    // 恢复标签页关系（防重复执行）
    async restoreRelations() {
      try {
        const autoRestoreEnabled = await this._sc.isFeatureEnabledSync("autoRestore");
        if (!autoRestoreEnabled) {
          console.log("\u{1F6AB} autoRestore is disable!");
          return {};
        }
        const existingRelations = this._sm.getTabRelations();
        if (existingRelations != null) {
          console.log("\u{1F6AB} Tab relations already exist, skipping restore. Existing relations:", Object.keys(existingRelations).length);
          return existingRelations;
        }
        const tabs = await chrome.tabs.query({});
        const result = await chrome.storage.local.get(["persistentTabTree"]);
        const persistentTree = result.persistentTabTree || { relations: [], snapshots: [] };
        console.log("\u{1F504} Restoring from", persistentTree.relations.length, "recorded relations");
        const urlToTab = /* @__PURE__ */ new Map();
        tabs.forEach((tab) => {
          const normalizedUrl = this.normalizeUrl(tab.url);
          urlToTab.set(normalizedUrl, tab);
        });
        const restoredRelations = {};
        let restoredCount = 0;
        let unmatchedCount = 0;
        const sortedRelations = [...persistentTree.relations].sort((a, b) => b.timestamp - a.timestamp);
        console.log("\u{1F50D} Checking recorded relations:");
        sortedRelations.forEach((relation) => {
          const childTab = urlToTab.get(relation.child.url);
          const parentTab = urlToTab.get(relation.parent.url);
          if (childTab && parentTab && childTab.id !== parentTab.id && !restoredRelations[childTab.id]) {
            restoredRelations[childTab.id] = parentTab.id;
            restoredCount++;
          } else {
            unmatchedCount++;
          }
        });
        tabs.forEach((tab) => {
          if (tab.openerTabId && !restoredRelations[tab.id]) {
            const openerExists = tabs.some((t) => t.id === tab.openerTabId);
            if (openerExists) {
              restoredRelations[tab.id] = tab.openerTabId;
              restoredCount++;
              console.log(`\u2713 Restored from current openerTabId: ${tab.id} -> ${tab.openerTabId}`);
            }
          }
        });
        this._sm.saveTabRelations(restoredRelations);
        console.log(`\u{1F389} Total restored: ${restoredCount} relations (${unmatchedCount} unmatched)`);
        return restoredRelations;
      } catch (error) {
        console.error("Error restoring relations:", error);
        return {};
      }
    }
    // 移除标签页相关的所有关系（持久化存储）
    async removeRelation(url) {
      try {
        const persistentTree = await this._sm.getPersistentTree();
        const normalizedUrl = this.normalizeUrl(url);
        persistentTree.relations = persistentTree.relations.filter((relation) => relation.child.url !== normalizedUrl);
        this._sm.saveToPersistentTree(persistentTree);
      } catch (error) {
        console.error("Error removing persistent relation:", error);
      }
    }
    // 清理过期数据
    async cleanup() {
      try {
        const result = await chrome.storage.local.get(["persistentTabTree"]);
        const persistentTree = result.persistentTabTree || { relations: [], snapshots: [] };
        const maxAge = 30 * 24 * 60 * 60 * 1e3;
        const now = Date.now();
        const beforeCount = persistentTree.relations.length;
        persistentTree.relations = persistentTree.relations.filter(
          (relation) => now - relation.timestamp < maxAge
        );
        if (beforeCount > persistentTree.relations.length) {
          this._sm.saveToPersistentTree(persistentTree);
          console.log(`\u{1F9F9} Cleaned up ${beforeCount - persistentTree.relations.length} expired relations`);
        }
      } catch (error) {
        console.error("Error during cleanup:", error);
      }
    }
  };

  // src/background/PinnedTabPersistentStorage.js
  var PinnedTabPersistentStorage = class {
    // 规范化 URL（复用 TabTreePersistentStorage 的方法）
    normalizeUrl(url) {
      try {
        const urlObj = new URL(url);
        urlObj.hash = "";
        return urlObj.href;
      } catch (error) {
        return url.split("#")[0];
      }
    }
    constructor(storageManager2) {
      this._sm = storageManager2;
      this.maxAge = 30 * 24 * 60 * 60 * 1e3;
    }
    // 添加置顶标签页
    async addPinnedTab(tabId, tabInfo) {
      try {
        const normalizedUrl = this.normalizeUrl(tabInfo.url);
        if (!this.isValidUrl(normalizedUrl)) {
          console.log("\u{1F6AB} Invalid URL for pinning:", normalizedUrl);
          return false;
        }
        const pinnedTabs = await this._sm.getPinnedTabs();
        pinnedTabs[normalizedUrl] = {
          url: tabInfo.url,
          title: tabInfo.title,
          timestamp: Date.now()
        };
        this._sm.pinnedTabsCache = pinnedTabs;
        this._sm.clearPinnedTabIdsCache();
        this._sm.scheduleWrite();
        console.log(`\u{1F4CC} Added pinned tab by URL: ${normalizedUrl} - ${tabInfo.title}`);
        return true;
      } catch (error) {
        console.error("Error adding pinned tab:", error);
        return false;
      }
    }
    // 移除置顶标签页
    async removePinnedTab(tabId) {
      try {
        const tab = await chrome.tabs.get(tabId);
        const normalizedUrl = this.normalizeUrl(tab.url);
        const pinnedTabs = await this._sm.getPinnedTabs();
        if (pinnedTabs[normalizedUrl]) {
          delete pinnedTabs[normalizedUrl];
          this._sm.pinnedTabsCache = pinnedTabs;
          this._sm.clearPinnedTabIdsCache();
          this._sm.scheduleWrite();
          console.log(`\u{1F4CC} Removed pinned tab by URL: ${normalizedUrl}`);
          return true;
        }
        return false;
      } catch (error) {
        console.log(`Could not remove pinned tab ${tabId}:`, error);
        return false;
      }
    }
    // 检查标签页是否置顶
    async isPinnedTab(tabId) {
      try {
        const tab = await chrome.tabs.get(tabId);
        const normalizedUrl = this.normalizeUrl(tab.url);
        const pinnedTabs = await this._sm.getPinnedTabs();
        return !!pinnedTabs[normalizedUrl];
      } catch (error) {
        return false;
      }
    }
    // 根据当前标签页构建 tabId -> 数据 的置顶映射
    async buildPinnedTabIdsCache() {
      try {
        const pinnedTabs = await this._sm.getPinnedTabs();
        const pinnedUrls = Object.keys(pinnedTabs);
        if (pinnedUrls.length === 0) {
          return {};
        }
        const allTabs = await chrome.tabs.query({});
        const pinnedTabIdsCache = {};
        allTabs.forEach((tab) => {
          const normalizedUrl = this.normalizeUrl(tab.url);
          if (pinnedTabs[normalizedUrl]) {
            pinnedTabIdsCache[tab.id] = pinnedTabs[normalizedUrl];
          }
        });
        console.log(`\u{1F4CC} Built pinned tab IDs cache: ${Object.keys(pinnedTabIdsCache).length} tabs`);
        return pinnedTabIdsCache;
      } catch (error) {
        console.error("Error building pinned tab IDs cache:", error);
        return {};
      }
    }
    // 清理无效的置顶标签页
    async cleanupInvalidPinnedTabs() {
      try {
        const pinnedTabs = await this._sm.getPinnedTabs();
        const allTabs = await chrome.tabs.query({});
        const validUrls = new Set(allTabs.map((tab) => this.normalizeUrl(tab.url)));
        let hasChanges = false;
        for (const pinnedUrl of Object.keys(pinnedTabs)) {
          if (!validUrls.has(pinnedUrl)) {
            delete pinnedTabs[pinnedUrl];
            hasChanges = true;
            console.log(`\u{1F9F9} Removed invalid pinned URL: ${pinnedUrl}`);
          }
        }
        if (hasChanges) {
          this._sm.pinnedTabsCache = pinnedTabs;
          this._sm.clearPinnedTabIdsCache();
          this._sm.scheduleWrite();
          console.log("\u{1F9F9} Cleaned up invalid pinned tabs");
        }
        return hasChanges;
      } catch (error) {
        console.error("Error cleaning up pinned tabs:", error);
        return false;
      }
    }
    // 清理过期的置顶标签页
    async cleanupExpiredPinnedTabs() {
      try {
        const pinnedTabs = await this._sm.getPinnedTabs();
        const now = Date.now();
        let hasChanges = false;
        for (const [url, data] of Object.entries(pinnedTabs)) {
          if (data.timestamp && now - data.timestamp > this.maxAge) {
            delete pinnedTabs[url];
            hasChanges = true;
            console.log(`\u{1F9F9} Removed expired pinned URL: ${url}`);
          }
        }
        if (hasChanges) {
          this._sm.pinnedTabsCache = pinnedTabs;
          this._sm.clearPinnedTabIdsCache();
          this._sm.scheduleWrite();
          console.log("\u{1F9F9} Cleaned up expired pinned tabs");
        }
        return hasChanges;
      } catch (error) {
        console.error("Error cleaning up expired pinned tabs:", error);
        return false;
      }
    }
    // 获取所有置顶标签页的URL
    async getPinnedTabUrls() {
      const pinnedTabs = await this._sm.getPinnedTabs();
      return Object.keys(pinnedTabs);
    }
    // 检查URL是否有效（可以置顶）
    isValidUrl(url) {
      if (!url || typeof url !== "string" || url.trim() === "") {
        return false;
      }
      const invalidPrefixes = [
        "chrome://",
        "moz-extension://",
        "safari-extension://",
        "about:",
        "data:text/html"
      ];
      return !invalidPrefixes.some((prefix) => url.startsWith(prefix));
    }
  };

  // src/background/instances.js
  var storageManager = new StorageManager();
  var settingsCache = new SettingsCache();
  var tabSnapshotExecutor = new DelayedMergeExecutor(200);
  var persistentStorage = new TabTreePersistentStorage(storageManager, settingsCache);
  var pinnedTabStorage = new PinnedTabPersistentStorage(storageManager);
  storageManager.init(persistentStorage, pinnedTabStorage);

  // src/background/AutoBackTrack.js
  var tabIndexSnapshot = /* @__PURE__ */ new Map();
  var tabCloseDirection = {
    lastCloseTabIndex: -1,
    // 上一次关闭的标签页索引
    beforeLastCloseTabIndex: -1,
    // 上上次关闭的标签页索引
    currentDirection: "right"
    // 当前方向：'left' 或 'right'
  };
  function buildTabTree(tabs, tabRelations) {
    const tabMap = /* @__PURE__ */ new Map();
    const rootTabs = [];
    tabs.forEach((tab) => {
      tabMap.set(tab.id, { ...tab, children: [] });
    });
    tabs.forEach((tab) => {
      const parentId = tabRelations[tab.id];
      if (parentId && tabMap.has(parentId)) {
        tabMap.get(parentId).children.push(tabMap.get(tab.id));
      } else {
        rootTabs.push(tabMap.get(tab.id));
      }
    });
    return rootTabs;
  }
  async function updateTabSnapshot() {
    try {
      const tabs = await chrome.tabs.query({});
      tabs.forEach((tab) => {
        tabIndexSnapshot.set(tab.id, { index: tab.index, windowId: tab.windowId });
      });
    } catch (error) {
      console.error("Error updating tab snapshot:", error);
    }
  }
  function deleteTabSnapshot(tabId) {
    tabIndexSnapshot.delete(tabId);
  }
  function scheduleSnapshotUpdate() {
    tabSnapshotExecutor.addEvent(updateTabSnapshot, []);
  }
  function findNextTabToActivate(closedTabId, tabRelations, allTabs) {
    const direction = detectCloseDirectionFromIndex();
    console.log(`\u{1F9ED} Using direction: ${direction.toUpperCase()} for sibling search`);
    const tabMap = /* @__PURE__ */ new Map();
    allTabs.forEach((tab) => {
      tabMap.set(tab.id, tab);
    });
    const tree = buildTabTree(allTabs, tabRelations);
    const parentId = tabRelations[closedTabId];
    if (parentId && tabMap.has(parentId)) {
      const siblings = allTabs.filter((tab) => tabRelations[tab.id] === parentId);
      if (direction === "right") {
        const nextSibling = findNextSibling(closedTabId, siblings);
        if (nextSibling) {
          console.log(`Found next sibling (RIGHT): ${nextSibling.id}`);
          return nextSibling.id;
        }
        const previousSibling = findPreviousSibling(closedTabId, siblings);
        if (previousSibling) {
          console.log(`No next sibling, found previous sibling (fallback): ${previousSibling.id}`);
          return previousSibling.id;
        }
      } else {
        const previousSibling = findPreviousSibling(closedTabId, siblings);
        if (previousSibling) {
          console.log(`Found previous sibling (LEFT): ${previousSibling.id}`);
          return previousSibling.id;
        }
        const nextSibling = findNextSibling(closedTabId, siblings);
        if (nextSibling) {
          console.log(`No previous sibling, found next sibling (fallback): ${nextSibling.id}`);
          return nextSibling.id;
        }
      }
      console.log(`No siblings found, activating parent: ${parentId}`);
      return parentId;
    } else {
      const rootTabs = allTabs.filter((tab) => !tabRelations[tab.id]);
      if (direction === "right") {
        const nextRoot = findNextSibling(closedTabId, rootTabs);
        if (nextRoot) {
          console.log(`Found next root sibling (RIGHT): ${nextRoot.id}`);
          return nextRoot.id;
        }
        const previousRoot = findPreviousSibling(closedTabId, rootTabs);
        if (previousRoot) {
          console.log(`No next root sibling, found previous root sibling (fallback): ${previousRoot.id}`);
          return previousRoot.id;
        }
      } else {
        const previousRoot = findPreviousSibling(closedTabId, rootTabs);
        if (previousRoot) {
          console.log(`Found previous root sibling (LEFT): ${previousRoot.id}`);
          return previousRoot.id;
        }
        const nextRoot = findNextSibling(closedTabId, rootTabs);
        if (nextRoot) {
          console.log(`No previous root sibling, found next root sibling (fallback): ${nextRoot.id}`);
          return nextRoot.id;
        }
      }
    }
    return null;
  }
  function findPreviousSibling(targetTabId, siblings) {
    return findSibling(targetTabId, siblings, "previous");
  }
  function findNextSibling(targetTabId, siblings) {
    return findSibling(targetTabId, siblings, "next");
  }
  function findSibling(targetTabId, siblings, direction = "previous") {
    const directionText = direction === "previous" ? "previous" : "next";
    console.log(`Looking for ${directionText} sibling of tab ${targetTabId}`);
    if (!tabIndexSnapshot.has(targetTabId)) {
      console.log(`No snapshot data for target tab ${targetTabId}`);
      return null;
    }
    const closedTabInfo = tabIndexSnapshot.get(targetTabId);
    console.log(`Closed tab ${targetTabId} was at index ${closedTabInfo.index}`);
    console.log(`Available siblings:`, siblings.map((tab) => `${tab.id}(${tab.index})`));
    const reconstructedSiblings = [];
    siblings.forEach((tab) => {
      if (tab.index < closedTabInfo.index) {
        reconstructedSiblings.push({ ...tab, originalIndex: tab.index });
      } else {
        reconstructedSiblings.push({ ...tab, originalIndex: tab.index + 1 });
      }
    });
    reconstructedSiblings.push({
      id: targetTabId,
      originalIndex: closedTabInfo.index,
      title: "(closed)"
    });
    reconstructedSiblings.sort((a, b) => a.originalIndex - b.originalIndex);
    console.log(`Reconstructed order:`, reconstructedSiblings.map((tab) => `${tab.id}(${tab.originalIndex})`));
    const targetIndex = reconstructedSiblings.findIndex((tab) => tab.id === targetTabId);
    console.log(`Target tab was at position: ${targetIndex}`);
    let siblingIndex;
    if (direction === "previous") {
      if (targetIndex > 0) {
        siblingIndex = targetIndex - 1;
      }
    } else {
      if (targetIndex < reconstructedSiblings.length - 1) {
        siblingIndex = targetIndex + 1;
      }
    }
    if (siblingIndex !== void 0) {
      const sibling = reconstructedSiblings[siblingIndex];
      const existingSibling = siblings.find((tab) => tab.id === sibling.id);
      if (existingSibling) {
        console.log(`Found ${directionText} sibling: ${existingSibling.id} (was at original index: ${sibling.originalIndex})`);
        return existingSibling;
      }
    }
    console.log(`No ${directionText} sibling found`);
    return null;
  }
  function updateCloseDirectionIndex(closedTabId) {
    try {
      const snapshotInfo = tabIndexSnapshot.get(closedTabId);
      if (!snapshotInfo) {
        console.log(`\u26A0\uFE0F Cannot find closed tab ${closedTabId} in tabIndexSnapshot`);
        return;
      }
      const currentIndex = snapshotInfo.index;
      tabCloseDirection.beforeLastCloseTabIndex = tabCloseDirection.lastCloseTabIndex;
      tabCloseDirection.lastCloseTabIndex = currentIndex;
      console.log(`\u{1F4CD} Updated close indexes: current=${currentIndex}, last=${tabCloseDirection.beforeLastCloseTabIndex}`);
    } catch (error) {
      console.error("\u274C Error updating close direction index:", error);
    }
  }
  function detectCloseDirectionFromIndex() {
    try {
      if (tabCloseDirection.lastCloseTabIndex === -1 || tabCloseDirection.beforeLastCloseTabIndex === -1) {
        console.log("\u{1F50D} No sufficient history, using default direction:", tabCloseDirection.currentDirection);
        return tabCloseDirection.currentDirection;
      }
      const lastIndex = tabCloseDirection.lastCloseTabIndex;
      const beforeLastIndex = tabCloseDirection.beforeLastCloseTabIndex;
      console.log(`\u{1F50D} Index comparison: before last=${beforeLastIndex}, last=${lastIndex}`);
      if (lastIndex < beforeLastIndex) {
        tabCloseDirection.currentDirection = "left";
        console.log("\u{1F3C3}\u200D\u2B05\uFE0F Direction detected: LEFT (closing tabs from right to left)");
      } else {
        tabCloseDirection.currentDirection = "right";
        console.log("\u{1F3C3}\u200D\u27A1\uFE0F Direction detected: RIGHT (closing tabs from left to right)");
      }
      return tabCloseDirection.currentDirection;
    } catch (error) {
      console.error("\u274C Error detecting close direction from index:", error);
      return tabCloseDirection.currentDirection;
    }
  }

  // src/background/tools.js
  async function injectContentScript(tabId) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.autoTreeTabsContentScriptInjected || false
      });
      if (!results[0]?.result) {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["src/content/content.js"]
        });
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            window.autoTreeTabsContentScriptInjected = true;
          }
        });
        console.log(`Content script injected into tab ${tabId}`);
      }
    } catch (error) {
      console.log(`Failed to inject content script into tab ${tabId}:`, error);
    }
  }
  async function cleanupScrollPositionForTab(tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && tab.url) {
        await storageManager.removeScrollPosition(tab.url);
        console.log(`\u{1F5D1}\uFE0F Removed scroll position for ${tab.url}`);
      }
    } catch (error) {
    }
  }

  // src/background/background-main.js
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local" && changes.extensionSettings) {
      console.log("\u{1F4DD} Extension settings changed, clearing cache");
      settingsCache.clearCache();
    }
  });
  var pluginClosedTabs = /* @__PURE__ */ new Set();
  var tabLastKnownUrlById = /* @__PURE__ */ new Map();
  function recordTabUrl(tabId, url) {
    if (typeof url !== "string" || url.trim() === "") return;
    tabLastKnownUrlById.set(tabId, url);
  }
  function isGoogleOAuthUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url);
      return u.hostname === "accounts.google.com" && u.pathname.startsWith("/signin/oauth");
    } catch {
      return false;
    }
  }
  async function isPopupWindow(windowId) {
    try {
      const win = await chrome.windows.get(windowId);
      return win?.type === "popup";
    } catch {
      return false;
    }
  }
  chrome.tabs.onCreated.addListener(async (tab) => {
    console.log("Tab created:", tab.id, "openerTabId:", tab.openerTabId, "url:", tab.url);
    recordTabUrl(tab.id, tab.url || tab.pendingUrl || "");
    try {
      if (isWindowRestoring) {
        console.log(`\u{1F504} Window restoration in progress, skipping auto parent-child setup for tab ${tab.id}`);
        return;
      }
      let parentTab = null;
      if (tab.openerTabId) {
        try {
          parentTab = await chrome.tabs.get(tab.openerTabId);
          await setTabParent(tab.id, tab.openerTabId);
          console.log(`\u2713 Parent set via openerTabId: ${tab.id} -> ${tab.openerTabId}`);
        } catch (error) {
          console.log("OpenerTab not found, falling back to active tab");
        }
      }
      if (!parentTab) {
        const [activeTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
        if (activeTab && activeTab.id !== tab.id) {
          parentTab = activeTab;
          await setTabParent(tab.id, activeTab.id);
          console.log(`\u2713 Parent set to active tab: ${tab.id} -> ${activeTab.id}`);
        }
      }
      if (parentTab) {
        await persistentStorage.recordRelation(tab, parentTab);
      }
    } catch (error) {
      console.error("Error setting tab parent on creation:", error);
    }
  });
  chrome.tabs.onCreated.addListener(() => {
    scheduleSnapshotUpdate();
  });
  chrome.tabs.onMoved.addListener(() => {
    scheduleSnapshotUpdate();
  });
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (!settingsCache.isFeatureEnabled("autoRestore")) {
      return;
    }
    if (changeInfo.url && !isWindowRestoring) {
      console.log("Tab URL updated:", tabId, "new URL:", changeInfo.url);
      recordTabUrl(tabId, changeInfo.url);
      try {
        if (tab.openerTabId) {
          try {
            const parentTab = await chrome.tabs.get(tab.openerTabId);
            await persistentStorage.recordRelation(tab, parentTab);
            console.log(`\u{1F504} Native relation recorded: ${tabId} -> ${tab.openerTabId} (URL now available)`);
          } catch (error) {
            console.log("OpenerTab not found when updating URL:", error);
          }
        }
        await updateChildRelationsForUpdatedParent(tabId, tab);
      } catch (error) {
        console.error("Error updating tab relation on URL change:", error);
      }
    }
  });
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
      await injectContentScript(tabId);
    }
  });
  async function updateChildRelationsForUpdatedParent(parentTabId, updatedParentTab) {
    try {
      const tabRelations = await storageManager.getTabRelationsSync() || {};
      const childTabIds = Object.keys(tabRelations).filter(
        (childId) => tabRelations[childId] == parentTabId
      );
      if (childTabIds.length === 0) {
        return;
      }
      console.log(`\u{1F504} Updating relations for parent ${parentTabId} with ${childTabIds.length} children`);
      for (const childTabId of childTabIds) {
        try {
          const childTab = await chrome.tabs.get(parseInt(childTabId));
          await persistentStorage.recordRelation(childTab, updatedParentTab);
          console.log(`\u{1F504} Updated relation: ${childTabId} -> ${parentTabId} (parent URL updated)`);
        } catch (error) {
          console.log(`\u26A0\uFE0F Could not update relation for child ${childTabId}:`, error);
        }
      }
    } catch (error) {
      console.error("Error updating child relations for updated parent:", error);
    }
  }
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
        console.log(`\u{1F510} OAuth popup tab ${tabId} closed, skipping smart switch. url=`, lastKnownUrl);
        await removeTabRelations(tabId);
        await cleanupScrollPositionForTab(tabId);
        deleteTabSnapshot(tabId);
        return;
      }
      console.log(`Tab ${tabId} was closed by user, checking settings...`);
      if (!settingsCache.isFeatureEnabled("smartSwitch")) {
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
      console.error("Error handling tab removal:", error);
    } finally {
      tabLastKnownUrlById.delete(tabId);
    }
    updateTabSnapshot();
  });
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      if (tab.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
        await injectContentScript(activeInfo.tabId);
      }
    } catch (error) {
      console.log("Error injecting content script on tab activation:", error);
    }
    try {
      storageManager.addToGlobalTabHistory(activeInfo.tabId);
    } catch (error) {
      console.log("Error adding to global tab history:", error);
    }
  });
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
      try {
        if (request.action === "linkClicked") {
          const parentTabId = sender.tab.id;
          setTimeout(async () => {
            try {
              const tabs = await chrome.tabs.query({ active: true, windowId: sender.tab.windowId });
              if (tabs.length > 0 && tabs[0].id !== parentTabId) {
                await setTabParent(tabs[0].id, parentTabId);
              }
            } catch (error) {
              console.error("Error setting parent for clicked link:", error);
            }
            sendResponse({ success: true });
          }, 100);
        } else if (request.action === "markPluginClosed") {
          if (request.tabIds && Array.isArray(request.tabIds)) {
            request.tabIds.forEach((tabId) => {
              pluginClosedTabs.add(tabId);
              console.log(`Marked tab ${tabId} as plugin-closed`);
            });
          }
          sendResponse({ success: true });
        } else if (request.action === "restoreRelations") {
          console.log("Popup requested restore relations");
          await persistentStorage.restoreRelations();
          sendResponse({ success: true });
        } else if (request.action === "getHistoryData") {
          sendResponse(await storageManager.getGlobalTabHistorySync());
        } else if (request.action === "saveHistoryData") {
          if (request.historyData) {
            storageManager.saveGlobalTabHistory(request.historyData);
          }
          sendResponse({ success: true });
        } else if (request.action === "getTabRelations") {
          const tabRelations = storageManager.getTabRelations();
          if (tabRelations == null) {
            sendResponse(void 0);
          } else {
            sendResponse(tabRelations);
          }
        } else if (request.action === "isFeatureEnabled") {
          try {
            const enabled = await settingsCache.isFeatureEnabledSync(request.feature);
            sendResponse(enabled === true);
          } catch (e) {
            sendResponse(false);
          }
        } else if (request.action === "saveScrollPosition") {
          if (request.url && request.position) {
            await storageManager.saveScrollPosition(request.url, request.position);
            console.log(`\u{1F4DC} Saved scroll position for ${request.url}:`, request.position);
          }
          sendResponse({ success: true });
        } else if (request.action === "getScrollPosition") {
          if (request.url) {
            const position = await storageManager.getScrollPositionSync(request.url);
            sendResponse(position);
            console.log(`\u{1F4DC} Retrieved scroll position for ${request.url}:`, position);
          } else {
            sendResponse(null);
          }
        } else if (request.action === "removeScrollPosition") {
          if (request.url) {
            await storageManager.removeScrollPosition(request.url);
            console.log(`\u{1F5D1}\uFE0F Removed scroll position for ${request.url}`);
          }
          sendResponse({ success: true });
        } else if (request.action === "removeTabRelationsFor") {
          if (request.tabId) {
            try {
              await removeTabParentRelationsPersistent(parseInt(request.tabId));
              console.log(`\u{1F5D1}\uFE0F Removed relations for tab ${request.tabId}`);
              sendResponse({ success: true });
              updateTabSnapshot();
            } catch (e) {
              console.error("Error removing relations for tab:", e);
              sendResponse({ success: false, error: e?.message || String(e) });
            }
          } else {
            sendResponse({ success: false, error: "tabId required" });
          }
        } else if (request.action === "addPinnedTab") {
          if (request.tabId && request.tabInfo) {
            const success = await pinnedTabStorage.addPinnedTab(request.tabId, request.tabInfo);
            sendResponse({ success });
          } else {
            sendResponse({ success: false, error: "tabId and tabInfo required" });
          }
        } else if (request.action === "removePinnedTab") {
          if (request.tabId) {
            const success = await pinnedTabStorage.removePinnedTab(request.tabId);
            sendResponse({ success });
          } else {
            sendResponse({ success: false, error: "tabId required" });
          }
        } else if (request.action === "getPinnedTabs") {
          const pinnedTabs = await storageManager.getPinnedTabs();
          sendResponse(pinnedTabs);
        } else if (request.action === "getPinnedTabIdsCache") {
          const pinnedTabIdsCache = await storageManager.getPinnedTabIdsCache();
          sendResponse(pinnedTabIdsCache);
        } else if (request.action === "isPinnedTab") {
          if (request.tabId) {
            const isPinned = await pinnedTabStorage.isPinnedTab(request.tabId);
            sendResponse({ isPinned });
          } else {
            sendResponse({ isPinned: false });
          }
        } else if (request.action === "getDefaultRecentFilter") {
          try {
            const value = await storageManager.getDefaultRecentFilter();
            sendResponse({ value });
          } catch (e) {
            sendResponse({ value: false });
          }
        } else if (request.action === "setDefaultRecentFilter") {
          try {
            const ok = await storageManager.setDefaultRecentFilter(!!request.value);
            sendResponse({ success: ok });
          } catch (e) {
            sendResponse({ success: false });
          }
        }
      } catch (error) {
        console.error("Error handling message:", error);
        sendResponse({ error: error.message });
      }
    })();
    return true;
  });
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
          console.log(`\u{1F4DD} Manual relation recorded: ${childTab.id} -> ${parentTabId} (not from openerTabId)`);
        } else {
          console.log(`\u23ED\uFE0F Skipping native relation: ${childTab.id} -> ${parentTabId} (handled by onUpdated)`);
        }
      } catch (error) {
        console.log("Could not record manual relation to persistent storage:", error);
      }
    } catch (error) {
      console.error("Error setting tab parent:", error);
    }
  }
  async function removeTabRelations(removedTabId) {
    try {
      const tabRelations = storageManager.getTabRelations();
      if (!tabRelations) {
        return;
      }
      delete tabRelations[removedTabId];
      Object.keys(tabRelations).forEach((childId) => {
        if (tabRelations[childId] === removedTabId) {
          delete tabRelations[childId];
        }
      });
      storageManager.saveTabRelations(tabRelations);
    } catch (error) {
      console.error("Error removing tab relations:", error);
    }
  }
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
        console.log(`\u{1F5D1}\uFE0F Removed persistent relation for ${tab.url}`);
      }
    } catch (error) {
      console.error("Error removing tab relations:", error);
    }
  }
  chrome.runtime.onInstalled.addListener(async () => {
    try {
      console.log("\u{1F680} Extension initialized");
      await persistentStorage.restoreRelations();
      await persistentStorage.cleanup();
    } catch (error) {
      console.error("Error initializing extension:", error);
    }
  });
  var isWindowRestoring = false;
  chrome.windows.onRemoved.addListener(async (windowId) => {
    try {
      const normalWindows = await chrome.windows.getAll({ windowTypes: ["normal"] });
      if (!normalWindows || normalWindows.length === 0) {
        console.log("\u{1F5D1}\uFE0F All normal windows closed, clearing tabRelations + global history");
        storageManager.removeTabRelations();
        storageManager.clearGlobalTabHistory();
      } else {
        console.log("\u{1FA9F} Window closed:", windowId, "but normal windows remain, keeping tabRelations + global history");
      }
    } catch (error) {
      console.error("Error clearing tabRelations on window close:", error);
    }
  });
  chrome.windows.onCreated.addListener(async (window2) => {
    console.log("\u{1FA9F} Window created:", window2.id, "type:", window2.type);
    if (window2.type === "normal") {
      isWindowRestoring = true;
      console.log("\u{1F504} Window restoration detected, will skip auto parent-child setup");
      setTimeout(async () => {
        console.log("\u{1F504} Starting restoration process...");
        await persistentStorage.restoreRelations();
        isWindowRestoring = false;
        console.log("\u{1F504} Window restoration detection reset");
      }, 3e3);
    }
  });
  var rebuildTimeout = null;
  chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) {
      if (rebuildTimeout) clearTimeout(rebuildTimeout);
      rebuildTimeout = setTimeout(async () => {
        console.log("\u{1F504} Window focus changed, restoring relations...");
        await persistentStorage.restoreRelations();
      }, 1e3);
    }
  });
  storageManager.getScrollPositions().then(() => {
    console.log("\u{1F4DC} Scroll positions cache preloaded");
  }).catch((error) => {
    console.error("Error preloading scroll positions cache:", error);
  });
  settingsCache.getSettings().then(() => {
    console.log("\u{1F4DC} Settings cache preloaded");
  }).catch((error) => {
    console.error("Error preloading settings cache:", error);
  });
  updateTabSnapshot();
  setInterval(async () => {
    try {
      await storageManager.cleanupOldScrollPositions();
    } catch (error) {
      console.error("Error during scroll position cleanup:", error);
    }
  }, 60 * 60 * 1e3);
  setTimeout(async () => {
    try {
      await storageManager.cleanupOldScrollPositions();
      await pinnedTabStorage.cleanupInvalidPinnedTabs();
      await pinnedTabStorage.cleanupExpiredPinnedTabs();
    } catch (error) {
      console.error("Error during initial cleanup:", error);
    }
  }, 5e3);
  setInterval(async () => {
    try {
      await pinnedTabStorage.cleanupInvalidPinnedTabs();
    } catch (error) {
      console.error("Error during pinned tabs cleanup:", error);
    }
  }, 30 * 60 * 1e3);
  setInterval(async () => {
    try {
      await pinnedTabStorage.cleanupExpiredPinnedTabs();
    } catch (error) {
      console.error("Error during expired pinned tabs cleanup:", error);
    }
  }, 24 * 60 * 60 * 1e3);
})();
//# sourceMappingURL=background.js.map
