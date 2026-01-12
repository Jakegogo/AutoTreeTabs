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
        // 用 null 表示“缓存未初始化/需要从持久化存储恢复”，
        // 避免空对象 {} 被误判为“已有关系”从而跳过 restore。
        this.tabRelationsCache = null;
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

