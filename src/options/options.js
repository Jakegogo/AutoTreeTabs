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

    // 更新 favicon 缓存所需权限状态
    await this.updateFaviconPermissionUI();
  }

  async isFaviconHostPermissionGranted() {
    try {
      return await chrome.permissions.contains({
        origins: ['http://*/*', 'https://*/*']
      });
    } catch {
      return false;
    }
  }

  async updateFaviconPermissionUI() {
    const statusEl = document.getElementById('faviconPermissionStatus');
    const btn = document.getElementById('grantFaviconPermissionBtn');
    if (!statusEl || !btn) return;

    const granted = await this.isFaviconHostPermissionGranted();
    if (granted) {
      statusEl.textContent = i18n('faviconPermissionStatusGranted') || 'Granted';
      btn.disabled = true;
      btn.style.opacity = '0.6';
      btn.style.cursor = 'default';
    } else {
      statusEl.textContent = i18n('faviconPermissionStatusNotGranted') || 'Not granted';
      btn.disabled = false;
      btn.style.opacity = '';
      btn.style.cursor = '';
    }
  }

  async requestFaviconHostPermission() {
    try {
      const granted = await chrome.permissions.request({
        origins: ['http://*/*', 'https://*/*']
      });

      if (!granted) {
        this.showNotification(i18n('faviconPermissionDeniedToast') || 'Permission denied', 'error');
        return false;
      }

      this.showNotification(i18n('faviconPermissionGrantedToast') || 'Permission granted', 'success');
      return true;
    } catch {
      this.showNotification(i18n('faviconPermissionRequestFailedToast') || 'Permission request failed', 'error');
      return false;
    } finally {
      await this.updateFaviconPermissionUI();
    }
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

    // favicon 缓存 - 请求可选 host 权限
    const faviconBtn = document.getElementById('grantFaviconPermissionBtn');
    if (faviconBtn) {
      faviconBtn.addEventListener('click', async () => {
        await this.requestFaviconHostPermission();
      });
    }
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

// ==================== 单标签规则管理 ====================
const SINGLE_TAB_STORAGE_KEY = 'singleTabRules';

class SingleTabRulesUI {
  constructor() {
    this._rules = [];
    this._listEl = document.getElementById('singleTabRulesList');
    this._inputEl = document.getElementById('newRulePattern');
    this._addBtn = document.getElementById('addSingleTabRuleBtn');
    if (!this._listEl) return;
    this._addBtn?.addEventListener('click', () => this._addRule());
    this._inputEl?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._addRule(); });
    this._load();
  }

  async _getRules() {
    const result = await chrome.storage.local.get([SINGLE_TAB_STORAGE_KEY]);
    return result[SINGLE_TAB_STORAGE_KEY] || [];
  }

  async _saveRules(rules) {
    await chrome.storage.local.set({ [SINGLE_TAB_STORAGE_KEY]: rules });
  }

  async _load() {
    this._rules = await this._getRules();
    this._render();
  }

  _render() {
    if (!this._listEl) return;
    if (this._rules.length === 0) {
      this._listEl.innerHTML = '<div class="rules-empty">暂无规则，右键标签页添加，或在下方手动输入</div>';
      return;
    }
    this._listEl.innerHTML = '';
    for (const rule of this._rules) {
      this._listEl.appendChild(this._buildRow(rule));
    }
  }

  _buildRow(rule) {
    const row = document.createElement('div');
    row.className = 'rule-item';
    row.dataset.id = rule.id;

    // 启用开关
    const sw = document.createElement('label');
    sw.className = 'switch';
    sw.style.flexShrink = '0';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = rule.enabled;
    chk.addEventListener('change', () => this._toggle(rule.id, chk.checked));
    const slider = document.createElement('span');
    slider.className = 'slider';
    sw.appendChild(chk);
    sw.appendChild(slider);

    // Pattern 文本
    const patternSpan = document.createElement('span');
    patternSpan.className = 'rule-pattern';
    patternSpan.title = rule.pattern;
    patternSpan.textContent = rule.pattern;

    // 操作按钮
    const actions = document.createElement('div');
    actions.className = 'rule-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn-sm btn-sm-edit';
    editBtn.textContent = '编辑';
    editBtn.addEventListener('click', () => this._startEdit(row, rule, patternSpan, editBtn));

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-sm btn-sm-delete';
    delBtn.textContent = '删除';
    delBtn.addEventListener('click', () => this._delete(rule.id));

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    row.appendChild(sw);
    row.appendChild(patternSpan);
    row.appendChild(actions);
    return row;
  }

  _startEdit(row, rule, patternSpan, editBtn) {
    // 替换 span 为 input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rule-pattern-input';
    input.value = rule.pattern;
    patternSpan.replaceWith(input);
    input.focus();

    // 替换编辑按钮为保存/取消
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-sm btn-sm-save';
    saveBtn.textContent = '保存';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-sm btn-sm-cancel';
    cancelBtn.textContent = '取消';

    editBtn.replaceWith(saveBtn, cancelBtn);

    const doSave = async () => {
      const newPattern = input.value.trim();
      if (!newPattern) return;
      await this._update(rule.id, { pattern: newPattern });
    };

    saveBtn.addEventListener('click', doSave);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); if (e.key === 'Escape') this._load(); });
    cancelBtn.addEventListener('click', () => this._load());
  }

  async _addRule() {
    const pattern = this._inputEl?.value.trim();
    if (!pattern) return;
    const rules = await this._getRules();
    if (rules.some(r => r.pattern === pattern)) {
      alert(`规则 "${pattern}" 已存在`);
      return;
    }
    rules.push({
      id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      pattern,
      enabled: true,
      createdAt: Date.now(),
    });
    await this._saveRules(rules);
    if (this._inputEl) this._inputEl.value = '';
    await this._load();
  }

  async _delete(id) {
    const rules = await this._getRules();
    await this._saveRules(rules.filter(r => r.id !== id));
    await this._load();
  }

  async _toggle(id, enabled) {
    const rules = await this._getRules();
    const idx = rules.findIndex(r => r.id === id);
    if (idx !== -1) rules[idx].enabled = enabled;
    await this._saveRules(rules);
    this._rules = rules;
  }

  async _update(id, patch) {
    const rules = await this._getRules();
    const idx = rules.findIndex(r => r.id === id);
    if (idx !== -1) Object.assign(rules[idx], patch);
    await this._saveRules(rules);
    await this._load();
  }
}

// 确保只初始化一次，避免重复注册事件导致权限弹窗出现两次
(function initOptionsOnce() {
  if (window.__optionsInitialized) return;
  window.__optionsInitialized = true;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.optionsManager = new OptionsManager();
    window.singleTabRulesUI = new SingleTabRulesUI();
  });
} else {
  window.optionsManager = new OptionsManager();
  window.singleTabRulesUI = new SingleTabRulesUI();
}
})();
