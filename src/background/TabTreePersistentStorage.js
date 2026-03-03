// URL-based 标签页树持久化系统 (学习自 Tabs Outliner)
export class TabTreePersistentStorage {
  constructor(storageManager, settingsCache) {
    this._sm = storageManager;
    this._sc = settingsCache;
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
    if (!this._sc.isFeatureEnabled('autoRestore')) {
      return {};
    }
    try {
      const persistentTree = await this._sm.getPersistentTree();

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

      this._sm.saveToPersistentTree(persistentTree);
    } catch (error) {
      console.error('Error recording relation:', error);
    }
  }

  // 恢复标签页关系（防重复执行）
  async restoreRelations() {
    try {
      // 检查自动恢复设置
      const autoRestoreEnabled = await this._sc.isFeatureEnabledSync('autoRestore');
      if (!autoRestoreEnabled) {
        console.log('🚫 autoRestore is disable!')
        return {};
      }

      // 检查是否已经有标签页关系数据，如果缓存已初始化（即使为空对象）则不进行恢复
      const existingRelations = this._sm.getTabRelations();
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
      tabs.forEach(tab => {
        const normalizedUrl = this.normalizeUrl(tab.url);
        urlToTab.set(normalizedUrl, tab);
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
      this._sm.saveTabRelations(restoredRelations);
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
      const persistentTree = await this._sm.getPersistentTree();
      const normalizedUrl = this.normalizeUrl(url);
      persistentTree.relations = persistentTree.relations.filter(relation => relation.child.url !== normalizedUrl);
      this._sm.saveToPersistentTree(persistentTree);
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
        this._sm.saveToPersistentTree(persistentTree);
        console.log(`🧹 Cleaned up ${beforeCount - persistentTree.relations.length} expired relations`);
      }
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }
}
