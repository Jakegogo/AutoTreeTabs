import { storageManager } from './instances.js';

// 按需注入content script的函数
export async function injectContentScript(tabId) {
  try {
    // 检查是否需要注入content script
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => window.autoTreeTabsContentScriptInjected || false
    });

    if (!results[0]?.result) {
      // 注入content script
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['src/content/content.js']
      });

      // 标记已注入
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => { window.autoTreeTabsContentScriptInjected = true; }
      });

      console.log(`Content script injected into tab ${tabId}`);
    }
  } catch (error) {
    console.log(`Failed to inject content script into tab ${tabId}:`, error);
  }
}


// 清理标签页的滚动位置（根据URL）
export async function cleanupScrollPositionForTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.url) {
      await storageManager.removeScrollPosition(tab.url);
      console.log(`🗑️ Removed scroll position for ${tab.url}`);
    }
  } catch (error) {
    // 标签页已关闭，无法获取URL，跳过清理
  }
}
