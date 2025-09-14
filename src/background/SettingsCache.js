// 设置缓存机制
class SettingsCache {
  constructor() {
    this.cache = null;
    this.lastUpdate = 0;
    this.CACHE_DURATION = 60000; // 60秒缓存时间
    this.pendingPromise = null; // 防止并发读取
  }

  // 获取缓存的设置
  async getSettings() {
    const now = Date.now();

    // 如果缓存有效，直接返回
    if (this.cache && (now - this.lastUpdate) < this.CACHE_DURATION) {
      return this.cache;
    }

    // 如果正在读取中，等待现有的Promise
    if (this.pendingPromise) {
      return await this.pendingPromise;
    }

    // 创建新的读取Promise
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
      chrome.storage.local.get(['extensionSettings'], (result) => {
        const settings = result.extensionSettings || {};
        // 提供默认值
        const defaultSettings = {
          autoRestore: true,
          smartSwitch: true, // 默认启用智能标签切换
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
    console.log('🗑️ Settings cache cleared');
  }

  // 更新缓存（当设置更新时调用）
  updateCache(newSettings) {
    this.cache = newSettings;
    this.lastUpdate = Date.now();
    console.log('🔄 Settings cache updated');
  }

  // 快速检查特定设置（用于高频调用）
  isFeatureEnabled(featureName) {
    // 如果有缓存且在有效期内，直接使用缓存
    const now = Date.now();
    if (this.cache && (now - this.lastUpdate) < this.CACHE_DURATION) {
      return this.cache[featureName] !== false;
    }

    // 没有缓存时，异步更新缓存（不阻塞当前调用）
    this.getSettings().catch(error => {
      console.warn('Failed to update settings cache:', error);
    });

    // 再次查询缓存
    if (this.cache) {
      return this.cache[featureName] !== false;
    }

    // 返回默认值（避免阻塞）
    const defaults = {
      autoRestore: true,
      smartSwitch: true
    };

    return defaults[featureName] !== false;
  }

  // 同步检查特定设置，如果没有缓存则等待初始化
  async isFeatureEnabledSync(featureName) {
    // 如果有缓存且在有效期内，直接使用缓存
    const now = Date.now();
    if (this.cache && (now - this.lastUpdate) < this.CACHE_DURATION) {
      return this.cache[featureName] !== false;
    }

    // 没有缓存时，等待异步获取设置
    await this.getSettings();

    // 重新获取缓存值
    if (this.cache) {
      return this.cache[featureName] !== false;
    }

    // 如果仍然没有缓存，返回默认值
    const defaults = {
      autoRestore: true,
      smartSwitch: true
    };
    return defaults[featureName] !== false;
  }
}


// 监听设置变化，清除缓存
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.extensionSettings) {
    console.log('📝 Extension settings changed, clearing cache');
    settingsCache.clearCache();
  }
});


