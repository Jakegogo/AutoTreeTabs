// 按需注入content script的函数
async function injectContentScript(tabId) {
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
        files: ['content.js']
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


