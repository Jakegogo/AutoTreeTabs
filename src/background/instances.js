// 共享单例 hub — 统一创建并导出所有后台实例
// 顺序：无依赖的先创建，然后 constructor 注入，最后晚绑定
import { StorageManager } from './StorageManager.js';
import { SettingsCache } from './SettingsCache.js';
import { DelayedMergeExecutor } from './DelayedMergeExecutor.js';
import { TabTreePersistentStorage } from './TabTreePersistentStorage.js';
import { PinnedTabPersistentStorage } from './PinnedTabPersistentStorage.js';

// 1. 无外部依赖的基础实例
export const storageManager = new StorageManager();
export const settingsCache = new SettingsCache();
export const tabSnapshotExecutor = new DelayedMergeExecutor(200);

// 2. constructor 注入：接受 storageManager / settingsCache（不反向 import instances.js，无循环）
export const persistentStorage = new TabTreePersistentStorage(storageManager, settingsCache);
export const pinnedTabStorage = new PinnedTabPersistentStorage(storageManager);

// 3. 晚绑定：storageManager 现在可以访问 persistentStorage / pinnedTabStorage
storageManager.init(persistentStorage, pinnedTabStorage);
