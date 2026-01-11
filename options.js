/**
 * Options页面功能处理
 * Author: Assistant
 * Created: 2024-01-20
 */

class OptionsManager {
  constructor() {
    this.initializeOptions();
    this.loadStatistics();
    this.setupEventListeners();
  }

  /**
   * 初始化选项页面
   */
  async initializeOptions() {
    // 加载当前设置
    const settings = await this.loadSettings();
    
    // 设置开关状态
    document.getElementById('autoRestoreToggle').checked = settings.autoRestore !== false;
    document.getElementById('smartSwitchToggle').checked = settings.smartSwitch !== false;
    document.getElementById('restoreScrollToggle').checked = settings.restoreScroll !== false;
    document.getElementById('showTabGroupsToggle').checked = settings.showTabGroups === true;
    
    // 显示版本信息
    const manifest = chrome.runtime.getManifest();
    document.getElementById('versionInfo').textContent = manifest.version;
  }

  /**
   * 加载设置
   */
  async loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['extensionSettings'], (result) => {
        resolve(result.extensionSettings || {});
      });
    });
  }

  /**
   * 保存设置
   */
  async saveSettings(settings) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ extensionSettings: settings }, resolve);
    });
  }

  /**
   * 加载统计信息
   */
  async loadStatistics() {
    try {
      const result = await chrome.storage.local.get(['tabRelations', 'persistentTabTree']);
      
      const tabRelations = result.tabRelations || {};
      const persistentTabTree = result.persistentTabTree || { relations: [] };
      
      // 计算关系数量
      const tabRelationsCount = Object.keys(tabRelations).length;
      const persistentRelationsCount = persistentTabTree.relations ? persistentTabTree.relations.length : 0;
      
      // 计算存储大小（估算）
      const dataSize = JSON.stringify(result).length;
      const sizeInKB = Math.round(dataSize / 1024 * 100) / 100;
      
      // 更新UI
      document.getElementById('tabRelationsCount').textContent = tabRelationsCount;
      document.getElementById('persistentRelationsCount').textContent = persistentRelationsCount;
      document.getElementById('totalStorageSize').textContent = sizeInKB;
      
      console.log('📊 Statistics loaded:', {
        tabRelationsCount,
        persistentRelationsCount,
        sizeInKB
      });
    } catch (error) {
      console.error('❌ Failed to load statistics:', error);
    }
  }

  /**
   * 设置事件监听器
   */
  setupEventListeners() {
    // 清除所有数据按钮
    document.getElementById('clearAllBtn').addEventListener('click', () => {
      this.clearAllData();
    });

    // 导出数据按钮
    document.getElementById('exportDataBtn').addEventListener('click', () => {
      this.exportData();
    });

    // 设置开关
    document.getElementById('autoRestoreToggle').addEventListener('change', (e) => {
      this.updateSetting('autoRestore', e.target.checked);
    });

    document.getElementById('smartSwitchToggle').addEventListener('change', (e) => {
      this.updateSetting('smartSwitch', e.target.checked);
    });

    document.getElementById('restoreScrollToggle').addEventListener('change', (e) => {
      this.updateSetting('restoreScroll', e.target.checked);
    });

    // 显示分组 - 请求可选权限
    document.getElementById('showTabGroupsToggle').addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      if (enabled) {
        try {
          const granted = await chrome.permissions.request({ permissions: ['tabGroups'] });
          if (!granted) {
            e.target.checked = false;
            this.showNotification('Permission denied: tabGroups', 'error');
            return;
          }
        } catch (err) {
          e.target.checked = false;
          this.showNotification('Permission request failed', 'error');
          return;
        }
      }
      this.updateSetting('showTabGroups', enabled);
    });
  }

  /**
   * 更新单个设置
   */
  async updateSetting(key, value) {
    try {
      const settings = await this.loadSettings();
      settings[key] = value;
      await this.saveSettings(settings);
      
      console.log(`⚙️ Setting updated: ${key} = ${value}`);
      this.showNotification(`Setting saved: ${key}`, 'success');
    } catch (error) {
      console.error(`❌ Failed to update setting ${key}:`, error);
      this.showNotification('Failed to save setting', 'error');
    }
  }

  /**
   * 清除所有数据
   */
  async clearAllData() {
    const confirmMessage = `Are you sure you want to clear ALL data?

This will remove:
• All tab relations
• All persistent storage data
• Extension settings

This action CANNOT be undone!`;

    if (!confirm(confirmMessage)) {
      return;
    }

    // 二次确认
    const secondConfirm = prompt(`To confirm, please type "DELETE ALL" (case sensitive):`);
    if (secondConfirm !== "DELETE ALL") {
      this.showNotification('Deletion cancelled', 'error');
      return;
    }

    try {
      console.log('🗑️ Starting data clearance...');
      
      // 清除所有存储数据
      await new Promise((resolve) => {
        chrome.storage.local.clear(resolve);
      });
      
      console.log('✅ All data cleared successfully');
      
      // 重新加载统计信息
      await this.loadStatistics();
      
      // 重置设置开关
      document.getElementById('autoRestoreToggle').checked = true;
      document.getElementById('smartSwitchToggle').checked = true;
      
      this.showNotification('All data cleared successfully!', 'success');
      
    } catch (error) {
      console.error('❌ Failed to clear data:', error);
      this.showNotification('Failed to clear data', 'error');
    }
  }

  /**
   * 导出数据
   */
  async exportData() {
    try {
      console.log('📤 Starting data export...');
      
      const result = await chrome.storage.local.get(null); // 获取所有数据
      
      const exportData = {
        exportDate: new Date().toISOString(),
        version: chrome.runtime.getManifest().version,
        data: result
      };
      
      // 创建下载链接
      const dataStr = JSON.stringify(exportData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      
      // 生成文件名
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-').split('T')[0];
      const filename = `AutoTreeTabs-backup-${timestamp}.json`;
      
      // 触发下载
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      console.log('✅ Data exported successfully:', filename);
      this.showNotification('Data exported successfully!', 'success');
      
    } catch (error) {
      console.error('❌ Failed to export data:', error);
      this.showNotification('Failed to export data', 'error');
    }
  }

  /**
   * 显示通知
   */
  showNotification(message, type = 'info') {
    // 移除现有通知
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) {
      existingNotification.remove();
    }

    // 创建新通知
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    // 显示动画
    setTimeout(() => {
      notification.classList.add('show');
    }, 100);

    // 3秒后隐藏
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  }
}

// 确保只初始化一次，避免重复注册事件导致权限弹窗出现两次
(function initOptionsOnce() {
  if (window.__optionsInitialized) return;
  window.__optionsInitialized = true;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.optionsManager = new OptionsManager();
  });
} else {
  window.optionsManager = new OptionsManager();
}
})();
