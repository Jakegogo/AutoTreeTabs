// ===================
// 标签页激活与关闭操作
// ===================
import { state } from './state.js';

// 激活标签页并切换到对应窗口
export function activateTabAndWindow(tabId) {
  console.log(`Attempting to activate tab ${tabId}`);

  // 立即激活标签页（优先级最高，快速响应）
  chrome.tabs.update(tabId, { active: true }, () => {
    if (chrome.runtime.lastError) {
      console.error('Error activating tab:', chrome.runtime.lastError);
      return;
    }

    console.log(`Tab ${tabId} activated`);

    // 获取目标标签页信息来检查是否需要激活窗口
    chrome.tabs.get(tabId, (targetTab) => {
      if (chrome.runtime.lastError) {
        console.error('Error getting target tab:', chrome.runtime.lastError);
        window.close();
        return;
      }

      // 获取当前窗口信息
      chrome.tabs.query({ active: true, currentWindow: true }, (currentTabs) => {
        if (chrome.runtime.lastError || !currentTabs[0]) {
          console.log('Could not get current window info, activating target window');
          // 如果获取当前窗口失败，直接激活目标窗口（安全策略）
          chrome.windows.update(targetTab.windowId, { focused: true }, () => {
            console.log(`Window ${targetTab.windowId} focused`);
            window.close();
          });
          return;
        }

        const currentTab = currentTabs[0];
        const needWindowSwitch = targetTab.windowId !== currentTab.windowId;

        if (needWindowSwitch) {
          console.log(`Focusing window ${targetTab.windowId}`);
          chrome.windows.update(targetTab.windowId, { focused: true }, () => {
            if (chrome.runtime.lastError) {
              console.error('Error focusing window:', chrome.runtime.lastError);
            } else {
              console.log(`Window ${targetTab.windowId} focused`);
            }
            window.close();
          });
        } else {
          console.log('Same window, no need to switch');
          window.close();
        }
      });
    });
  });
}

// 从DOM中移除指定的标签页元素
export async function removeTabElements(tabIds) {
  tabIds.forEach(tabId => {
    const element = document.querySelector(`[data-tab-id="${tabId}"]`);
    if (element) {
      element.remove();
    }
  });

  // 同时从历史记录中移除已关闭的标签页
  if (window.tabHistory) {
    await window.tabHistory.removeTabsFromHistory(tabIds);
  }
}

// 关闭选中的标签页或当前节点及其子节点
export async function closeSelectedOrCurrent(node) {
  let tabsToClose = [];

  if (state.selectedTabIds.size > 0) {
    // 如果有选中的标签页，关闭所有选中的标签页
    tabsToClose = Array.from(state.selectedTabIds);
    // 清空选中状态
    state.selectedTabIds.clear();
  } else {
    // 如果没有选中的标签页，关闭当前节点及其子节点
    function collectTabIds(node) {
      tabsToClose.push(node.id);
      node.children.forEach(child => {
        collectTabIds(child);
      });
    }
    collectTabIds(node);
  }

  // 通知后台脚本这些标签页是通过插件关闭的
  try {
    await chrome.runtime.sendMessage({
      action: 'markPluginClosed',
      tabIds: tabsToClose
    });
  } catch (error) {
    console.error('Error notifying plugin close:', error);
  }

  // 关闭标签页
  try {
    await chrome.tabs.remove(tabsToClose);
    // 从DOM中移除已关闭的标签页元素，避免刷新视图
    await removeTabElements(tabsToClose);
  } catch (error) {
    console.warn('Error closing tabs:', error);
  }
}

// 关闭标签页及其所有子节点
export async function closeTabAndChildren(node) {
  const tabsToClose = [];

  function collectTabIds(node) {
    tabsToClose.push(node.id);
    node.children.forEach(child => {
      collectTabIds(child);
    });
  }

  collectTabIds(node);

  // 通知后台脚本这些标签页是通过插件关闭的
  try {
    await chrome.runtime.sendMessage({
      action: 'markPluginClosed',
      tabIds: tabsToClose
    });
  } catch (error) {
    console.error('Error notifying plugin close:', error);
  }

  // 关闭标签页
  try {
    await chrome.tabs.remove(tabsToClose);
    await removeTabElements(tabsToClose);
  } catch (error) {
    console.error('Error closing tabs:', error);
  }
}
