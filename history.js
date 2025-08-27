// 标签页访问历史记录管理器
// 用于实现前进后退功能，仅保存在内存中

class TabHistory {
  constructor() {
    // 不再在本地存储历史记录，改为通过消息机制与 background.js 通信
    this.maxHistorySize = 50; // 最大历史记录数
    this.isLoaded = false; // 标记是否已加载数据
  }

  // 从 background.js 获取历史记录数据
  async getHistoryData() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getHistoryData' });
      return response || { history: [], currentIndex: -1 };
    } catch (error) {
      console.error('Error getting history data:', error);
      return { history: [], currentIndex: -1 };
    }
  }

  // 保存历史记录数据到 background.js
  async saveHistoryData(historyData) {
    try {
      await chrome.runtime.sendMessage({ 
        action: 'saveHistoryData', 
        historyData: historyData 
      });
    } catch (error) {
      console.error('Error saving history data:', error);
    }
  }

  // 添加新的标签页到历史记录
  async addTab(tabId) {
    const data = await this.getHistoryData();
    
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

      await this.saveHistoryData(data);
      console.log(`📚 History added: ${tabId}, index: ${data.currentIndex}, history: [${data.history.join(', ')}]`);
    }
  }

  // 获取上一个标签页ID
  async getPreviousTab() {
    const data = await this.getHistoryData();
    
    if (data.currentIndex <= 0) {
      console.log('📚 No previous tab available');
      return null;
    }

    // 从当前位置往前查找可用的标签页
    for (let i = data.currentIndex - 1; i >= 0; i--) {
      const tabId = data.history[i];
      
      try {
        // 检查标签页是否还存在
        const tab = await chrome.tabs.get(tabId);
        if (tab) {
          data.currentIndex = i;
          await this.saveHistoryData(data);
          console.log(`📚 Found previous tab: ${tabId}, new index: ${data.currentIndex}`);
          return tabId;
        }
      } catch (error) {
        console.log(`📚 Previous tab ${tabId} no longer exists, removing from history`);
        // 标签页不存在，从历史记录中移除
        data.history.splice(i, 1);
        // 调整当前索引
        if (i <= data.currentIndex) {
          data.currentIndex--;
        }
      }
    }

    await this.saveHistoryData(data);
    console.log('📚 No valid previous tab found');
    return null;
  }

  // 获取下一个标签页ID
  async getNextTab() {
    const data = await this.getHistoryData();
    
    if (data.currentIndex >= data.history.length - 1) {
      console.log('📚 No next tab available');
      return null;
    }

    // 从当前位置往后查找可用的标签页
    for (let i = data.currentIndex + 1; i < data.history.length; i++) {
      const tabId = data.history[i];
      
      try {
        // 检查标签页是否还存在
        const tab = await chrome.tabs.get(tabId);
        if (tab) {
          data.currentIndex = i;
          await this.saveHistoryData(data);
          console.log(`📚 Found next tab: ${tabId}, new index: ${data.currentIndex}`);
          return tabId;
        }
      } catch (error) {
        console.log(`📚 Next tab ${tabId} no longer exists, removing from history`);
        // 标签页不存在，从历史记录中移除
        data.history.splice(i, 1);
        i--; // 调整循环变量，因为数组长度变了
      }
    }

    await this.saveHistoryData(data);
    console.log('📚 No valid next tab found');
    return null;
  }

  // 从历史记录中移除指定的标签页
  async removeTabFromHistory(tabId) {
    const data = await this.getHistoryData();
    const index = data.history.indexOf(tabId);
    if (index !== -1) {
      data.history.splice(index, 1);
      
      // 调整当前索引
      if (index <= data.currentIndex) {
        data.currentIndex--;
      }
      
      // 确保索引不会变成负数
      if (data.currentIndex < 0 && data.history.length > 0) {
        data.currentIndex = 0;
      }
      
      await this.saveHistoryData(data);
      console.log(`📚 Removed tab ${tabId} from history, new index: ${data.currentIndex}, history: [${data.history.join(', ')}]`);
    }
  }

  // 批量移除已关闭的标签页
  async removeTabsFromHistory(tabIds) {
    for (const tabId of tabIds) {
      await this.removeTabFromHistory(tabId);
    }
  }

  // 检查是否可以后退
  async canGoBack() {
    const data = await this.getHistoryData();
    return data.currentIndex > 0;
  }

  // 检查是否可以前进
  async canGoForward() {
    const data = await this.getHistoryData();
    return data.currentIndex < data.history.length - 1;
  }

  // 获取当前标签页ID
  async getCurrentTab() {
    const data = await this.getHistoryData();
    if (data.currentIndex >= 0 && data.currentIndex < data.history.length) {
      return data.history[data.currentIndex];
    }
    return null;
  }

  // 设置当前标签页（用于同步当前状态）
  async setCurrentTab(tabId) {
    const data = await this.getHistoryData();
    const index = data.history.indexOf(tabId);
    if (index !== -1) {
      data.currentIndex = index;
      await this.saveHistoryData(data);
      console.log(`📚 Set current tab: ${tabId}, index: ${data.currentIndex}`);
    }
  }

  // 清空历史记录
  async clear() {
    const data = { history: [], currentIndex: -1 };
    await this.saveHistoryData(data);
    console.log('📚 History cleared');
  }

  // 获取历史记录状态（用于调试）
  async getStatus() {
    const data = await this.getHistoryData();
    return {
      history: data.history,
      currentIndex: data.currentIndex,
      current: data.currentIndex >= 0 && data.currentIndex < data.history.length ? data.history[data.currentIndex] : null,
      canGoBack: data.currentIndex > 0,
      canGoForward: data.currentIndex < data.history.length - 1
    };
  }
}

// 创建全局历史记录管理器实例
const tabHistory = new TabHistory();

// 导出到全局作用域
window.tabHistory = tabHistory;
