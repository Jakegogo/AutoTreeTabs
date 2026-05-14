// ===================
// 调试工具
// ===================
import { state } from './state.js';
import { isPdfUrl } from './file-types.js';
import { calculateTreeHeight } from './layout.js';
import { loadTabTree } from './tree.js';

// ===================
// 导航状态管理
// ===================
export const NavigationHelper = {
  async isNavigating() {
    try {
      const historyData = await chrome.runtime.sendMessage({ action: 'getHistoryData' });
      return historyData ? historyData.currentIndex == historyData.history.length - 1 : false;
    } catch (error) {
      console.error('Error getting navigation state:', error);
      return false;
    }
  }
};

// ===================
// debugSearch — 暴露到 window
// ===================
function normalizeText(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function installDebugGlobals(performSearch) {
  window.debugSearch = {
    testNormalize: (text) => {
      console.log('📝 Text normalization test:', {
        original: text,
        normalized: normalizeText(text)
      });
      return normalizeText(text);
    },
    testSearch: (searchTerm) => {
      console.log('🔍 Testing search for:', searchTerm);
      performSearch(searchTerm);
    },
    getAllTitles: () => {
      const titles = [];
      document.querySelectorAll('.tree-title').forEach((el, index) => {
        const original = el.textContent;
        const normalized = normalizeText(original);
        titles.push({ index, original, normalized });
      });
      console.table(titles);
      return titles;
    }
  };

  window.debugPopup = {
    testNormalize: (text) => normalizeText(text),
    testSearch: (term) => performSearch(term),
    getAllTitles: () => {
      const titles = [];
      document.querySelectorAll('.tree-title').forEach(el => {
        titles.push(el.textContent);
      });
      return titles;
    },
    adjustHeight: () => calculateTreeHeight(),
    getHeightInfo: () => {
      const body = document.body;
      const html = document.documentElement;
      const treeContainer = document.getElementById('treeContainer');
      return {
        bodyScrollHeight: body.scrollHeight,
        bodyClientHeight: body.clientHeight,
        htmlScrollHeight: html.scrollHeight,
        htmlClientHeight: html.clientHeight,
        treeMaxHeight: treeContainer ? treeContainer.style.maxHeight : 'not found'
      };
    },
    navigation: {
      isNavigating: () => NavigationHelper.isNavigating(),
    },
    pdf: {
      isPdf: (url) => isPdfUrl(url),
      getIconUrl: () => chrome.runtime.getURL('assets/icon-pdf.svg'),
      testUrls: () => {
        const testUrls = [
          'chrome-extension://oemmndcbldboiebfnladdacbdfmadadm/file:///Users/jake/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/%E6%8A%80%E6%9C%AF/%E6%8A%80%E6%9C%AF%E5%A4%A7%E4%BC%9A/qc5.pdf',
          'file:///Users/jake/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/%E6%8A%80%E6%9C%AF/%E6%8A%80%E6%9C%.pdf',
          'https://example.com/document.pdf',
          'https://google.com',
          'file:///path/to/document.txt'
        ];
        console.log('🔍 PDF URL Detection Test:');
        console.log('📄 PDF Icon URL:', chrome.runtime.getURL('assets/icon-pdf.svg'));
        testUrls.forEach(url => {
          const result = isPdfUrl(url);
          console.log(`${result ? '✅' : '❌'} ${url} → ${result}`);
        });
        return testUrls.map(url => ({ url, isPdf: isPdfUrl(url) }));
      }
    },
    tabStatus: {
      checkAllTabs: async () => {
        try {
          const tabs = await chrome.tabs.query({});
          const statusInfo = tabs.map(tab => ({
            id: tab.id,
            title: tab.title,
            url: tab.url,
            active: tab.active,
            discarded: tab.discarded,
            status: tab.status,
            loaded: tab.status === 'complete'
          }));
          console.log('🔄 All tabs status:');
          console.table(statusInfo);
          const unloadedTabs = statusInfo.filter(tab => tab.discarded || tab.status === 'unloaded');
          console.log('📴 Unloaded tabs count:', unloadedTabs.length);
          return statusInfo;
        } catch (error) {
          console.error('Error checking tab status:', error);
          return [];
        }
      },
      checkUnloadedNodes: () => {
        const unloadedNodes = document.querySelectorAll('.tree-node.unloaded');
        const allNodes = document.querySelectorAll('.tree-node');
        console.log('🎨 Unloaded nodes in DOM:', unloadedNodes.length, '/', allNodes.length);
        const unloadedInfo = Array.from(unloadedNodes).map(node => ({
          tabId: node.dataset.tabId,
          title: node.querySelector('.tree-title')?.textContent,
          url: node.dataset.tabUrl
        }));
        console.table(unloadedInfo);
        return unloadedInfo;
      },
      refreshUnloadedStatus: async () => {
        console.log('🔄 Refreshing unloaded status...');
        await loadTabTree();
      }
    }
  };
}
