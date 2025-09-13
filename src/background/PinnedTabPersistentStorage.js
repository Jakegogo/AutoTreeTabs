// 置顶标签页持久化存储系统 (基于URL)
class PinnedTabPersistentStorage {
  // 规范化 URL（复用 TabTreePersistentStorage 的方法）
  normalizeUrl(url) {
    try {
      const urlObj = new URL(url);
      urlObj.hash = '';
      return urlObj.href;
    } catch (error) {
      return url.split('#')[0];
    }
  }

  constructor(storageManager) {
    this.maxAge = 30 * 24 * 60 * 60 * 1000; // 30天过期时间
  }

  // 添加置顶标签页
  async addPinnedTab(tabId, tabInfo) {
    try {
      const normalizedUrl = this.normalizeUrl(tabInfo.url);
      
      if (!this.isValidUrl(normalizedUrl)) {
        console.log('🚫 Invalid URL for pinning:', normalizedUrl);
        return false;
      }

      const pinnedTabs = await storageManager.getPinnedTabs();
      pinnedTabs[normalizedUrl] = {
        url: tabInfo.url,
        title: tabInfo.title,
        timestamp: Date.now()
      };

      storageManager.pinnedTabsCache = pinnedTabs;
      storageManager.clearPinnedTabIdsCache(); // 清除缓存，下次获取时重建
      storageManager.scheduleWrite();
      
      console.log(`📌 Added pinned tab by URL: ${normalizedUrl} - ${tabInfo.title}`);
      return true;
    } catch (error) {
      console.error('Error adding pinned tab:', error);
      return false;
    }
  }

  // 移除置顶标签页
  async removePinnedTab(tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const normalizedUrl = this.normalizeUrl(tab.url);
      
      const pinnedTabs = await storageManager.getPinnedTabs();
      if (pinnedTabs[normalizedUrl]) {
        delete pinnedTabs[normalizedUrl];
        storageManager.pinnedTabsCache = pinnedTabs;
        storageManager.clearPinnedTabIdsCache(); // 清除缓存，下次获取时重建
        storageManager.scheduleWrite();
        console.log(`📌 Removed pinned tab by URL: ${normalizedUrl}`);
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
      const pinnedTabs = await storageManager.getPinnedTabs();
      return !!pinnedTabs[normalizedUrl];
    } catch (error) {
      return false;
    }
  }

  // 根据当前标签页构建 tabId -> 数据 的置顶映射
  async buildPinnedTabIdsCache() {
    try {
      const pinnedTabs = await storageManager.getPinnedTabs();
      const pinnedUrls = Object.keys(pinnedTabs);
      
      if (pinnedUrls.length === 0) {
        return {};
      }
      
      const allTabs = await chrome.tabs.query({});
      const pinnedTabIdsCache = {};
      
      allTabs.forEach(tab => {
        const normalizedUrl = this.normalizeUrl(tab.url);
        if (pinnedTabs[normalizedUrl]) {
          pinnedTabIdsCache[tab.id] = pinnedTabs[normalizedUrl];
        }
      });
      
      console.log(`📌 Built pinned tab IDs cache: ${Object.keys(pinnedTabIdsCache).length} tabs`);
      return pinnedTabIdsCache;
    } catch (error) {
      console.error('Error building pinned tab IDs cache:', error);
      return {};
    }
  }

  // 清理无效的置顶标签页
  async cleanupInvalidPinnedTabs() {
    try {
      const pinnedTabs = await storageManager.getPinnedTabs();
      const allTabs = await chrome.tabs.query({});
      const validUrls = new Set(allTabs.map(tab => this.normalizeUrl(tab.url)));
      let hasChanges = false;
      
      for (const pinnedUrl of Object.keys(pinnedTabs)) {
        if (!validUrls.has(pinnedUrl)) {
          delete pinnedTabs[pinnedUrl];
          hasChanges = true;
          console.log(`🧹 Removed invalid pinned URL: ${pinnedUrl}`);
        }
      }
      
      if (hasChanges) {
        storageManager.pinnedTabsCache = pinnedTabs;
        storageManager.clearPinnedTabIdsCache(); // 清除缓存，下次获取时重建
        storageManager.scheduleWrite();
        console.log('🧹 Cleaned up invalid pinned tabs');
      }
      
      return hasChanges;
    } catch (error) {
      console.error('Error cleaning up pinned tabs:', error);
      return false;
    }
  }

  // 清理过期的置顶标签页
  async cleanupExpiredPinnedTabs() {
    try {
      const pinnedTabs = await storageManager.getPinnedTabs();
      const now = Date.now();
      let hasChanges = false;
      
      for (const [url, data] of Object.entries(pinnedTabs)) {
        if (data.timestamp && (now - data.timestamp > this.maxAge)) {
          delete pinnedTabs[url];
          hasChanges = true;
          console.log(`🧹 Removed expired pinned URL: ${url}`);
        }
      }
      
      if (hasChanges) {
        storageManager.pinnedTabsCache = pinnedTabs;
        storageManager.clearPinnedTabIdsCache(); // 清除缓存，下次获取时重建
        storageManager.scheduleWrite();
        console.log('🧹 Cleaned up expired pinned tabs');
      }
      
      return hasChanges;
    } catch (error) {
      console.error('Error cleaning up expired pinned tabs:', error);
      return false;
    }
  }

  // 获取所有置顶标签页的URL
  async getPinnedTabUrls() {
    const pinnedTabs = await storageManager.getPinnedTabs();
    return Object.keys(pinnedTabs);
  }

  // 检查URL是否有效（可以置顶）
  isValidUrl(url) {
    if (!url || typeof url !== 'string' || url.trim() === '') {
      return false;
    }
    
    // 排除无效的URL
    const invalidPrefixes = [
      'chrome://',
      'moz-extension://',
      'safari-extension://',
      'about:',
      'data:text/html'
    ];
    
    return !invalidPrefixes.some(prefix => url.startsWith(prefix));
  }
}


