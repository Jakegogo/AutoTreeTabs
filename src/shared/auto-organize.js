/**
 * Auto Organize功能 - 按域名自动整理标签页
 * Author: Assistant
 * Created: 2024-01-20
 */

class AutoOrganizer {
  constructor() {
    this.setupEventListeners();
  }

  /**
   * 设置事件监听器
   */
  setupEventListeners() {
    const organizeBtn = document.getElementById('organizeBtn');
    if (organizeBtn) {
      organizeBtn.addEventListener('click', () => this.organizeTabsByDomain());
    }
  }

  /**
   * 从URL提取域名
   * @param {string} url - 完整URL
   * @returns {string} 域名
   */
  extractDomain(url) {
    try {
      if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
        return 'chrome-internal';
      }
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (error) {
      console.warn('Failed to extract domain from URL:', url, error);
      return 'unknown';
    }
  }

  /**
   * 从域名提取顶级域名（用于子域名分组）
   * @param {string} domain - 完整域名
   * @returns {string} 顶级域名
   */
  extractTopLevelDomain(domain) {
    if (!domain || domain === 'chrome-internal' || domain === 'unknown') {
      return domain;
    }
    
    try {
      // 处理特殊情况
      if (domain === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(domain)) {
        return domain;
      }
      
      // 分割域名部分
      const parts = domain.split('.');
      
      // 如果只有一部分，直接返回
      if (parts.length <= 1) {
        return domain;
      }
      
      // 处理常见的二级域名后缀（如 .com.cn, .co.uk 等）
      const secondLevelTlds = ['com', 'net', 'org', 'edu', 'gov', 'mil', 'co', 'ac'];
      
      if (parts.length >= 3) {
        const lastTwo = parts.slice(-2);
        // 检查是否是二级域名后缀
        if (secondLevelTlds.includes(lastTwo[0])) {
          return parts.slice(-3).join('.');
        }
      }
      
      // 默认情况：返回最后两部分作为顶级域名
      return parts.slice(-2).join('.');
      
    } catch (error) {
      console.warn('Failed to extract top level domain:', domain, error);
      return domain;
    }
  }

  /**
   * 获取域名的排序权重（子域名在同一顶级域名内按长度排序）
   * @param {string} domain - 域名
   * @param {string} topDomain - 顶级域名
   * @returns {number} 排序权重
   */
  getDomainSortWeight(domain, topDomain) {
    if (domain === topDomain) {
      // 主域名权重最高（排在最前）
      return 0;
    }
    
    // 子域名按层级深度排序，越深的排在后面
    const parts = domain.split('.');
    const topParts = topDomain.split('.');
    const subdomainDepth = parts.length - topParts.length;
    
    return subdomainDepth * 1000 + domain.length;
  }

  /**
   * 获取标签页的完整数据（包括父子关系）
   * @returns {Promise<Object>} 包含tabs和relations的对象
   */
  async getTabsData() {
    return new Promise((resolve) => {
      chrome.tabs.query({}, async (tabs) => {
        // 获取当前标签关系
        const result = await chrome.storage.local.get(['tabRelations']);
        const tabRelations = result.tabRelations || {};
        
        resolve({
          tabs: tabs,
          relations: tabRelations
        });
      });
    });
  }

  /**
   * 构建标签页树结构
   * @param {Array} tabs - 所有标签页
   * @param {Object} relations - 标签页关系
   * @returns {Array} 根节点数组
   */
  buildTabTree(tabs, relations) {
    const tabMap = new Map();
    const rootTabs = [];

    // 创建标签页映射
    tabs.forEach(tab => {
      const domain = this.extractDomain(tab.url);
      const topDomain = this.extractTopLevelDomain(domain);
      
      tabMap.set(tab.id, {
        ...tab,
        children: [],
        domain: domain,
        topDomain: topDomain
      });
    });

    // 构建父子关系
    tabs.forEach(tab => {
      const tabNode = tabMap.get(tab.id);
      const parentId = relations[tab.id];
      
      if (parentId && tabMap.has(parentId)) {
        // 有父节点，添加到父节点的children中
        const parentNode = tabMap.get(parentId);
        parentNode.children.push(tabNode);
      } else {
        // 没有父节点，是根节点
        rootTabs.push(tabNode);
      }
    });

    return rootTabs;
  }

  /**
   * 收集节点及其所有子节点（深度优先）
   * @param {Object} node - 节点
   * @returns {Array} 节点及其所有子节点的数组
   */
  collectNodeAndChildren(node) {
    const result = [node];
    node.children.forEach(child => {
      result.push(...this.collectNodeAndChildren(child));
    });
    return result;
  }

  /**
   * 按域名整理标签页
   */
  async organizeTabsByDomain() {
    try {
      console.log('🔄 开始自动整理标签页...');
      
      // 获取标签页数据
      const { tabs, relations } = await this.getTabsData();
      console.log(`📊 获取到 ${tabs.length} 个标签页，${Object.keys(relations).length} 个关系`);

      // 构建树结构
      const rootTabs = this.buildTabTree(tabs, relations);
      console.log(`🌳 构建了 ${rootTabs.length} 个根节点`);

      // 按顶级域名分组，然后在组内按子域名排序
      const topDomainGroups = new Map();
      const topDomainOrder = [];

      // 第一步：按顶级域名分组
      rootTabs.forEach(rootTab => {
        const topDomain = rootTab.topDomain;
        
        if (!topDomainGroups.has(topDomain)) {
          topDomainGroups.set(topDomain, []);
          topDomainOrder.push(topDomain);
        }
        
        topDomainGroups.get(topDomain).push(rootTab);
      });

      console.log(`🏷️ 找到 ${topDomainOrder.length} 个顶级域名:`, topDomainOrder);

      // 第二步：在每个顶级域名组内按子域名排序
      topDomainOrder.forEach(topDomain => {
        const tabsInTopDomain = topDomainGroups.get(topDomain);
        
        // 按子域名分组
        const subDomainGroups = new Map();
        tabsInTopDomain.forEach(tab => {
          const domain = tab.domain;
          if (!subDomainGroups.has(domain)) {
            subDomainGroups.set(domain, []);
          }
          subDomainGroups.get(domain).push(tab);
        });

        // 对子域名进行排序
        const sortedSubDomains = Array.from(subDomainGroups.keys()).sort((a, b) => {
          const weightA = this.getDomainSortWeight(a, topDomain);
          const weightB = this.getDomainSortWeight(b, topDomain);
          return weightA - weightB;
        });

        console.log(`📋 ${topDomain} 的子域名排序:`, sortedSubDomains);

        // 重新组织这个顶级域名下的标签页
        const organizedSubTabs = [];
        sortedSubDomains.forEach(subDomain => {
          const subDomainTabs = subDomainGroups.get(subDomain);
          subDomainTabs.forEach(tab => {
            organizedSubTabs.push(tab);
          });
        });

        // 更新顶级域名组的标签页顺序
        topDomainGroups.set(topDomain, organizedSubTabs);
      });

      // 第三步：按顶级域名顺序重新排列所有标签页
      const organizedTabs = [];
      topDomainOrder.forEach(topDomain => {
        const topDomainTabs = topDomainGroups.get(topDomain);
        topDomainTabs.forEach(rootTab => {
          // 收集根节点及其所有子节点
          const nodeAndChildren = this.collectNodeAndChildren(rootTab);
          organizedTabs.push(...nodeAndChildren);
        });
      });

      console.log(`📋 整理后的标签页顺序 (${organizedTabs.length} 个):`, 
        organizedTabs.map(tab => `${tab.domain}: ${tab.title?.substring(0, 30)}...`));

      // 更新Chrome标签页的实际位置
      await this.updateTabPositions(organizedTabs);

      // 刷新popup显示
      if (typeof loadTabTree === 'function') {
        await loadTabTree();
      }

      console.log('✅ 自动整理完成!');
      
      // 显示成功提示
      this.showNotification('标签页已按域名重新整理完成！', 'success');

    } catch (error) {
      console.error('❌ 自动整理失败:', error);
      this.showNotification('自动整理失败，请查看控制台了解详情', 'error');
    }
  }

  /**
   * 更新Chrome标签页的实际位置
   * @param {Array} organizedTabs - 整理后的标签页数组
   */
  async updateTabPositions(organizedTabs) {
    console.log('🔄 开始更新标签页位置...');
    
    // 按窗口分组
    const windowGroups = new Map();
    organizedTabs.forEach((tab, index) => {
      if (!windowGroups.has(tab.windowId)) {
        windowGroups.set(tab.windowId, []);
      }
      windowGroups.get(tab.windowId).push({ tab, targetIndex: index });
    });

    // 为每个窗口更新标签页位置
    for (const [windowId, tabsInWindow] of windowGroups) {
      console.log(`📋 更新窗口 ${windowId} 中的 ${tabsInWindow.length} 个标签页`);
      
      // 按目标位置排序
      tabsInWindow.sort((a, b) => a.targetIndex - b.targetIndex);
      
      // 逐个移动标签页到正确位置
      for (let i = 0; i < tabsInWindow.length; i++) {
        const { tab } = tabsInWindow[i];
        
        try {
          await new Promise((resolve, reject) => {
            chrome.tabs.move(tab.id, { index: i }, (movedTab) => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else {
                resolve(movedTab);
              }
            });
          });
          
          console.log(`✅ 移动标签页 ${tab.id} 到位置 ${i}`);
        } catch (error) {
          console.warn(`⚠️ 移动标签页 ${tab.id} 失败:`, error);
        }
      }
    }
    
    console.log('✅ 标签页位置更新完成');
  }

  /**
   * 显示通知消息
   * @param {string} message - 消息内容
   * @param {string} type - 消息类型 ('success', 'error', 'info')
   */
  showNotification(message, type = 'info') {
    // 创建通知元素
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      padding: 10px 15px;
      border-radius: 4px;
      color: white;
      z-index: 10000;
      font-size: 12px;
      max-width: 250px;
      word-wrap: break-word;
      background-color: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
    `;

    document.body.appendChild(notification);

    // 3秒后自动移除
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 3000);
  }
}

// 导出AutoOrganizer类
window.AutoOrganizer = AutoOrganizer;

// 初始化实例
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.autoOrganizer = new AutoOrganizer();
    console.log('✅ AutoOrganizer instance created and exported to window.autoOrganizer');
  });
} else {
  window.autoOrganizer = new AutoOrganizer();
  console.log('✅ AutoOrganizer instance created and exported to window.autoOrganizer');
}
