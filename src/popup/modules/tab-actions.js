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

// 关闭当前单个标签页，并将其子节点挂到当前节点的父节点下
export async function closeSingleTabReparentChildren(node, parentTabId) {
  // 先将所有子节点重新挂到祖父节点下（在关闭前操作，避免 onRemoved 清理子节点的父指针）
  for (const child of node.children) {
    try {
      if (parentTabId != null) {
        await chrome.runtime.sendMessage({
          action: 'setTabParent',
          childTabId: child.id,
          parentTabId: parentTabId
        });
      }
      // 如果没有祖父节点，onRemoved 触发时会自动清理子节点的父指针，子节点变为根节点
    } catch (err) {
      console.error('Error re-parenting child tab:', err);
    }
  }

  // 只关闭当前节点
  try {
    await chrome.runtime.sendMessage({
      action: 'markPluginClosed',
      tabIds: [node.id]
    });
  } catch (error) {
    console.error('Error notifying plugin close:', error);
  }

  try {
    await chrome.tabs.remove(node.id);
    await removeTabElements([node.id]);
  } catch (error) {
    console.warn('Error closing tab:', error);
  }
}

// 关闭选中的标签页，或仅关闭当前标签页并将子节点挂到其父节点下
export async function closeSelectedOrCurrent(node, parentTabId) {
  if (state.selectedTabIds.size > 0) {
    // 有多选时：关闭所有选中的标签页（保留原有逻辑）
    const tabsToClose = Array.from(state.selectedTabIds);
    state.selectedTabIds.clear();

    try {
      await chrome.runtime.sendMessage({
        action: 'markPluginClosed',
        tabIds: tabsToClose
      });
    } catch (error) {
      console.error('Error notifying plugin close:', error);
    }

    try {
      await chrome.tabs.remove(tabsToClose);
      await removeTabElements(tabsToClose);
    } catch (error) {
      console.warn('Error closing tabs:', error);
    }
  } else {
    // 无多选时：只关闭当前节点，子节点上移到父节点
    await closeSingleTabReparentChildren(node, parentTabId);
  }
}

// 移动标签页到新窗口
export async function moveTabToNewWindow(tabId) {
  try {
    await chrome.windows.create({ tabId });
  } catch (error) {
    console.error('Error moving tab to new window:', error);
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
