// 存储选中的标签页ID集合
let selectedTabIds = new Set();
let currentTabId = null;

// 验证favicon URL是否安全可用
function isValidFaviconUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  
  // 阻止chrome协议和扩展协议
  if (url.startsWith('chrome://') || 
      url.startsWith('chrome-extension://') ||
      url.startsWith('moz-extension://') ||
      url.startsWith('safari-extension://')) {
    return false;
  }
  
  // 只允许安全的协议
  if (url.startsWith('https://') || 
      url.startsWith('http://') || 
      url.startsWith('data:') ||
      url.startsWith('blob:')) {
    return true;
  }
  
  return false;
}

// ===================
// 文件类型检测系统
// ===================

/**
 * 文件类型配置
 * 每个文件类型包含：检测规则、图标文件名、显示名称、样式配置
 */
const FILE_TYPE_CONFIG = {
  pdf: {
    extensions: ['.pdf'],
    protocols: ['file://', 'chrome-extension://'],
    icon: 'assets/icon-pdf.svg',
    title: 'pdfFile',
    bgColor: 'transparent'
  },
  html: {
    extensions: ['.html', '.htm'],
    protocols: ['file://', 'chrome-extension://'],
    icon: 'assets/icon-html.svg', 
    title: 'htmlFile',
    bgColor: 'transparent'
  },
  png: {
    extensions: ['.png'],
    protocols: ['file://', 'chrome-extension://'],
    icon: 'assets/icon-png.svg',
    title: 'imageFile',
    bgColor: 'transparent'
  },
  jpg: {
    extensions: ['.jpg', '.jpeg'],
    protocols: ['file://', 'chrome-extension://'],
    icon: 'assets/icon-jpg.svg',
    title: 'imageFile',
    bgColor: 'transparent'
  },
  svg: {
    extensions: ['.svg'],
    protocols: ['file://', 'chrome-extension://'],
    icon: 'assets/icon-svg.svg',
    title: 'imageFile',
    bgColor: 'transparent'
  },
  markdown: {
    extensions: ['.md', '.markdown'],
    protocols: ['file://', 'chrome-extension://'],
    icon: 'assets/icon-md.svg',
    title: 'markdownFile',
    bgColor: 'transparent'
  },
  // 🔮 未来可扩展更多格式：
  // doc: { extensions: ['.doc', '.docx'], icon: 'icon-word.svg', title: 'Word文档' },
  // xls: { extensions: ['.xls', '.xlsx'], icon: 'icon-excel.svg', title: 'Excel文档' },
  // ppt: { extensions: ['.ppt', '.pptx'], icon: 'icon-ppt.svg', title: 'PowerPoint文档' }
};

/**
 * 检测URL是否为特定文件类型
 * @param {string} url - 要检测的URL
 * @returns {string|null} 文件类型名称，如果不匹配则返回null
 */
function detectFileType(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }
  
  // 解码URL以处理编码的字符（如中文路径）
  const decodedUrl = decodeURIComponent(url);
  const lowerUrl = decodedUrl.toLowerCase();
  
  // 遍历所有文件类型配置
  for (const [fileType, config] of Object.entries(FILE_TYPE_CONFIG)) {
    // 检查是否有匹配的协议
    const hasMatchingProtocol = config.protocols.some(protocol => 
      lowerUrl.includes(protocol.toLowerCase())
    );
    
    // 检查是否有匹配的扩展名
    const hasMatchingExtension = config.extensions.some(ext => 
      lowerUrl.includes(ext.toLowerCase())
    );
    
    if (hasMatchingProtocol && hasMatchingExtension) {
      return fileType;
    }
  }
  
  return null;
}

/**
 * 获取文件类型配置
 * @param {string} fileType - 文件类型名称
 * @returns {object|null} 文件类型配置对象
 */
function getFileTypeConfig(fileType) {
  return FILE_TYPE_CONFIG[fileType] || null;
}

/**
 * 检测是否为PDF文件（保持向后兼容）
 * @param {string} url - 要检测的URL
 * @returns {boolean} 是否为PDF文件
 */
function isPdfUrl(url) {
  return detectFileType(url) === 'pdf';
}

// 书签状态缓存
const bookmarkCache = new Map();

// 搜索标签与历史
let selectedFilters = { bookmarked: false, recent: false, historyTerm: null, lastRecent: false, };
let searchHistory = [];
let suppressAutoSearchOnce = false; // 防止 load 后 renderTree 再次触发 performSearch 形成循环
let isRefreshingByRecent = false;   // 防止 performSearch 中重复触发 load
let bookmarkedUrlsSet = null; // 懒加载

// 最近标签持久化
async function saveRecentPreference(enabled) {
  try { await chrome.runtime.sendMessage({ action: 'setDefaultRecentFilter', value: !!enabled }); } catch {}
}

async function loadRecentPreference() {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getDefaultRecentFilter' });
    return !!(res && res.value);
  } catch {
    return false;
  }
}

// 渲染输入框内的标签chips
function renderChipsLayer() {
  const chipsLayer = document.getElementById('chipsLayer');
  if (!chipsLayer) return;
  chipsLayer.innerHTML = '';

  const addChip = (label, type) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.textContent = label + ' ';
    const remove = document.createElement('span');
    remove.className = 'remove';
    remove.textContent = '×';
    remove.title = 'Remove';
    remove.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (type === 'bookmarked') selectedFilters.bookmarked = false;
      if (type === 'recent') {
        selectedFilters.recent = false;
        await saveRecentPreference(false);
      }
      if (type === 'history') selectedFilters.historyTerm = null;
      renderChipsLayer();
      performSearch(document.getElementById('searchInput')?.value || '');
    });
    chip.appendChild(remove);
    chipsLayer.appendChild(chip);
  };

  // 显示顺序：最近 → 书签 → 历史
  if (selectedFilters.recent) addChip(i18n('recent2h') || 'Recent', 'recent');
  if (selectedFilters.bookmarked) addChip(i18n('bookmarked') || 'Bookmarked', 'bookmarked');
  if (selectedFilters.historyTerm) addChip(selectedFilters.historyTerm, 'history');

  // 调整输入框左侧内边距，避免光标被chips遮挡
  const input = document.getElementById('searchInput');
  if (input) {
    // 默认左padding为 35px（与CSS保持一致）
    const basePadding = 35;
    const gap = 6;
    // 使用 scrollWidth 以获得内容真实宽度（不被max-width裁切）
    const chipsWidth = chipsLayer.children.length > 0 ? Math.min(chipsLayer.scrollWidth, (input.clientWidth - basePadding - 30)) : 0;
    const newPadding = chipsWidth > 0 ? (basePadding + chipsWidth + gap) : basePadding;
    input.style.paddingLeft = newPadding + 'px';
  }
}

// 渲染搜索框下方的标签建议
function renderTagSuggestions() {
  const container = document.getElementById('tagSuggestions');
  if (!container) return;
  container.innerHTML = '';

  const makeChip = (text, onClick) => {
    const el = document.createElement('span');
    el.className = 'tag-chip';
    el.textContent = text;
    el.addEventListener('mousedown', async (e) => { // 使用 mousedown 以便在失焦前触发
      e.preventDefault();
      await onClick();
    });
    return el;
  };

  container.appendChild(makeChip(i18n('recent2h') || 'Recent 2h', async () => {
    selectedFilters.recent = !selectedFilters.recent;
    await saveRecentPreference(selectedFilters.recent);
    // 触发一次 load，但避免 renderTree 的回调重复搜索
    suppressAutoSearchOnce = true;
    // await loadTabTree();
    renderChipsLayer();
    performSearch(document.getElementById('searchInput')?.value || '');
  }));

  container.appendChild(makeChip(i18n('bookmarked') || 'Bookmarked', async () => {
    selectedFilters.bookmarked = !selectedFilters.bookmarked;
    renderChipsLayer();
    performSearch(document.getElementById('searchInput')?.value || '');
  }));

  // 加载历史
  loadSearchHistory().then(() => {
    // 最近输入的搜索历史 (最多3个)
    (searchHistory || []).slice(0, 6).forEach(term => {
      if (!term) return;
      container.appendChild(makeChip(term, () => {
        selectedFilters.historyTerm = term;
        const input = document.getElementById('searchInput');
        if (input) input.value = '';
        renderChipsLayer();
        performSearch('');
      }));
    });
  });
  container.style.display = 'flex';
}


async function loadSearchHistory() {
  try {
    const store = await chrome.storage.local.get('searchHistory');
    searchHistory = Array.isArray(store.searchHistory) ? store.searchHistory : [];
  } catch (e) {
    searchHistory = [];
  }
}

async function saveSearchHistory(term) {
  const t = (term || '').trim();
  if (!t) return;
  // 排重并将最新放前
  searchHistory = [t, ...searchHistory.filter(x => x !== t)].slice(0, 10);
  try { await chrome.storage.local.set({ searchHistory }); } catch {}
}

async function getAllBookmarkedUrlSet() {
  if (bookmarkedUrlsSet) return bookmarkedUrlsSet;
  try {
    const tree = await chrome.bookmarks.getTree();
    const set = new Set();
    const stack = [...tree];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      if (node.url) {
        try {
          const u = new URL(node.url); u.hash = ''; set.add(u.href);
        } catch {
          set.add((node.url || '').split('#')[0]);
        }
      }
      if (node.children) stack.push(...node.children);
    }
    bookmarkedUrlsSet = set;
    return set;
  } catch (e) {
    bookmarkedUrlsSet = new Set();
    return bookmarkedUrlsSet;
  }
}

// 获取书签直接上级文件夹名称
async function getBookmarkFolderPath(parentId) {
  if (!parentId) return null;
  
  try {
    const folders = await chrome.bookmarks.get(parentId);
    if (!folders || folders.length === 0) return null;
    
    const folder = folders[0];
    
    // 跳过根文件夹（"书签栏"、"其他书签"等），返回null
    if (!folder.title || !folder.parentId) {
      return null;
    }
    
    return folder.title;
  } catch (error) {
    console.log('Error getting bookmark folder path:', error.message);
    return null;
  }
}



// 获取书签信息（包含状态、标题和文件夹路径）
async function getBookmarkInfo(url, isCurrentTab = false) {
  if (!url) return { isBookmarked: false, title: null, folderPath: null };
  
  // 当前页面不查缓存，直接查询
  if (isCurrentTab) {
    try {
      const bookmarks = await chrome.bookmarks.search({ url: url });
      const isBookmarked = bookmarks && bookmarks.length > 0;
      let bookmarkTitle = null;
      let folderPath = null;
      
      if (isBookmarked) {
        const bookmark = bookmarks[0];
        bookmarkTitle = bookmark.title;
        
        // 获取文件夹路径
        folderPath = await getBookmarkFolderPath(bookmark.parentId);
      }
      
      const bookmarkInfo = { isBookmarked, title: bookmarkTitle, folderPath };
      bookmarkCache.set(url, bookmarkInfo);
      
      return bookmarkInfo;
    } catch (error) {
      console.log('Error searching bookmarks:', error.message);
      return { isBookmarked: false, title: null, folderPath: null };
    }
  }
  
  // 其他页面先查缓存
  if (bookmarkCache.has(url)) {
    const cachedInfo = bookmarkCache.get(url);
    // 兼容旧格式缓存（boolean）和新格式缓存（object）
    if (typeof cachedInfo === 'boolean') {
      return { isBookmarked: cachedInfo, title: null, folderPath: null };
    } else {
      // 确保返回的对象包含folderPath字段（向后兼容）
      return {
        isBookmarked: cachedInfo.isBookmarked || false,
        title: cachedInfo.title || null,
        folderPath: cachedInfo.folderPath || null
      };
    }
  }
  
  // 缓存未命中，查询API并缓存结果
  try {
    const bookmarks = await chrome.bookmarks.search({ url: url });
    const isBookmarked = bookmarks && bookmarks.length > 0;
    let bookmarkTitle = null;
    let folderPath = null;
    
    if (isBookmarked) {
      const bookmark = bookmarks[0];
      bookmarkTitle = bookmark.title;
      
      // 获取文件夹路径
      folderPath = await getBookmarkFolderPath(bookmark.parentId);
    }
    
    const bookmarkInfo = { isBookmarked, title: bookmarkTitle, folderPath };
    bookmarkCache.set(url, bookmarkInfo);
    
    return bookmarkInfo;
  } catch (error) {
    console.log('Error searching bookmarks:', error.message);
    const errorInfo = { isBookmarked: false, title: null, folderPath: null };
    bookmarkCache.set(url, errorInfo);
    return errorInfo;
  }
}

// 激活标签页并切换到对应窗口
function activateTabAndWindow(tabId) {
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


// 关闭选中的标签页或当前节点及其子节点
async function closeSelectedOrCurrent(node) {
  let tabsToClose = [];
  
  if (selectedTabIds.size > 0) {
    // 如果有选中的标签页，关闭所有选中的标签页
    tabsToClose = Array.from(selectedTabIds);
    
    // 清空选中状态
    selectedTabIds.clear();
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

// DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', async () => {
  // 获取当前活动标签页
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab) {
    currentTabId = activeTab.id;
  }

  // 读取"最近"默认偏好并应用
  let preferRecent = false;
  try {
    preferRecent = await loadRecentPreference();
  } catch {}
  
  if (preferRecent) {
    selectedFilters.recent = true;
    renderChipsLayer();
    await performSearch(document.getElementById('searchInput')?.value || '');
  } else {
    // 立即刷新并加载树形结构
    await loadTabTree();
    // 立即搜索
    performSearch('');
  }
  
  // 绑定前进后退按钮事件
  document.getElementById('backBtn').addEventListener('click', async () => {
    if (window.tabHistory) {      
      const prevTabId = await window.tabHistory.getPreviousTab();
      if (prevTabId) {
        activateTabAndWindow(prevTabId);
      }
    }
  });
  
  document.getElementById('forwardBtn').addEventListener('click', async () => {
    if (window.tabHistory) {
      const nextTabId = await window.tabHistory.getNextTab();
      if (nextTabId) {
        activateTabAndWindow(nextTabId);
      }
    }
  });
  
  // 刷新按钮：重新加载树结构
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      await loadTabTree();
    });
  }
  
  // 绑定导出按钮事件
  document.getElementById('exportBtn').addEventListener('click', async () => {
    try {
      if (!window.__exportModuleLoaded) {
        await loadScriptOnce('export.js');
        window.__exportModuleLoaded = true;
      }
      await exportTabTree();
    } catch (e) {
      console.error('Failed to load export module:', e);
    }
  });
  
  // 绑定自动整理按钮事件
  document.getElementById('organizeBtn').addEventListener('click', async () => {
    // 检查AutoOrganizer类或实例是否可用
    try {
      if (!window.AutoOrganizer && !window.autoOrganizer) {
        if (!window.__organizeModuleLoaded) {
          await loadScriptOnce('auto-organize.js');
          window.__organizeModuleLoaded = true;
        }
      }
    } catch (e) {
      console.error('Failed to load auto-organize module:', e);
    }
    const AutoOrganizerClass = window.AutoOrganizer;
    const autoOrganizerInstance = window.autoOrganizer;
    
    if (AutoOrganizerClass) {
      // 如果类可用，创建新实例
      const organizer = new AutoOrganizerClass();
      await organizer.organizeTabsByDomain();
      await loadTabTree(); // 重新加载树形结构
    } else if (autoOrganizerInstance) {
      // 如果实例可用，直接使用
      await autoOrganizerInstance.organizeTabsByDomain();
      await loadTabTree(); // 重新加载树形结构
    } else {
      console.error('AutoOrganizer not loaded. Available window objects:', Object.keys(window).filter(key => key.toLowerCase().includes('organ')));
    }
  });
  
  // 计算树形结构高度
  calculateTreeHeight();
  // 初始化导航按钮状态
  updateNavigationButtons();
  // 初始化国际化
  initI18n();

  // 搜索框交互：聚焦时显示tag建议，失焦时隐藏（延迟以允许点击）
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('focus', () => {
      renderTagSuggestions();
    });

    // 回车保存历史
    searchInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        await saveSearchHistory(searchInput.value);
        renderTagSuggestions();
      }
      // 退格行为：当输入为空时，依次删除最后一个标签（历史 → 最近2h → 已收藏）
      if (e.key === 'Backspace' && (searchInput.value || '').trim() === '') {
        let removed = false;
        if (selectedFilters.historyTerm) {
          selectedFilters.historyTerm = null;
          removed = true;
        } else if (selectedFilters.recent) {
          selectedFilters.recent = false;
          removed = true;
        } else if (selectedFilters.bookmarked) {
          selectedFilters.bookmarked = false;
          removed = true;
        }
        if (removed) {
          e.preventDefault();
          renderChipsLayer();
          await performSearch('');
        }
      }
    });
  }

});



// 防止频繁恢复关系
let lastRestoreTime = 0;
const RESTORE_COOLDOWN = 3000; // 3秒冷却时间

// 全局置顶标签页缓存
let pinnedTabsCache = {};
// 全局标签组信息缓存（在 loadTabTree 中填充）
let tabGroupInfo = {};

// 加载标签页树结构
async function loadTabTree() {
  try {
    // 防止频繁恢复关系
    const now = Date.now();
    if (now - lastRestoreTime > RESTORE_COOLDOWN) {
      lastRestoreTime = now;
      try {
        await chrome.runtime.sendMessage({ action: 'restoreRelations' });
      } catch (error) {
        console.log('Could not trigger restore (background script may be inactive)');
      }
    }
    
    // 通过消息获取标签页关系缓存
    // 轮询获取tabRelations，直到background初始化完成
    let tabRelations = {};
    let attempts = 0;
    const maxAttempts = 10; // 最多尝试10次 (2秒)
    
    while (attempts < maxAttempts) {
      try {
        tabRelations = await chrome.runtime.sendMessage({ action: 'getTabRelations' });
        
        if (tabRelations !== undefined) {
          console.log(`🎯 Background ready after ${attempts + 1} attempts, got ${Object.keys(tabRelations).length} relations`);
          break;
        } else {
          attempts++;
          if (attempts < maxAttempts) {
            console.log(`⏳ Background not ready yet, attempt ${attempts}/${maxAttempts}, retrying in 100ms...`);
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
      } catch (error) {
        attempts++;
        console.log(`❌ Error getting tab relations, attempt ${attempts}/${maxAttempts}:`, error);
        if (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
    }
    
    // 确保 tabRelations 是对象
    tabRelations = tabRelations || {};
    
    if (attempts >= maxAttempts) {
      console.warn('⚠️ Background may not be ready after maximum attempts, proceeding with empty relations');
    }
    
    console.log('🔄 getTabRelations gets:', Object.keys(tabRelations).length);
    
    // 一次性获取所有置顶标签页数据（转换为tabId映射）
    try {
      pinnedTabsCache = await chrome.runtime.sendMessage({ action: 'getPinnedTabIdsCache' }) || {};
      console.log('📌 Loaded pinned tabs cache:', Object.keys(pinnedTabsCache).length);
    } catch (error) {
      console.log('Could not load pinned tabs cache:', error);
      pinnedTabsCache = {};
    }
    
    // 获取当前所有标签页
    const tabs = await chrome.tabs.query({});

    // 预取分组信息（基于设置与权限），失败则忽略
    tabGroupInfo = {};
    const enableGroups = await chrome.runtime.sendMessage({ action: 'isFeatureEnabled', feature: 'showTabGroups' }).catch(() => false);
    if (enableGroups && chrome.tabGroups && typeof chrome.tabGroups.get === 'function') {
      try {
        const groupIds = Array.from(new Set((tabs || []).map(t => t.groupId).filter(id => typeof id === 'number' && id >= 0)));
        for (const gid of groupIds) {
          try {
            const info = await chrome.tabGroups.get(gid);
            tabGroupInfo[gid] = info || {};
          } catch (e) {
            tabGroupInfo[gid] = {};
          }
        }
      } catch (e) {
        tabGroupInfo = {};
      }
    }
    
    // 构建树结构
    const tree = buildTabTree(tabs, tabRelations);
    
    // 渲染树
    renderTree(tree);

  } catch (error) {
    console.error('Error loading tab tree:', error);
  }
}
// 动态按需加载脚本（只加载一次）
async function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-dynamic="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.defer = true;
    s.dataset.dynamic = src;
    s.onload = () => resolve();
    s.onerror = (e) => reject(e);
    document.body.appendChild(s);
  });
}

// 构建标签页树结构
function buildTabTree(tabs, tabRelations) {
  const tabMap = new Map();
  const rootTabs = [];
  const pinnedTabs = [];
  const normalTabs = [];
  
  // 如果启用"最近"筛选：
  // - 当未启用分组时，按 lastAccessed 倒序全局排序并截取前30
  // - 当启用分组时，保留原列表，稍后在组内进行按时间排序
  if (selectedFilters && selectedFilters.recent) {
    const hasGroupInfo = tabGroupInfo && Object.keys(tabGroupInfo).length > 0;
    if (!hasGroupInfo) {
      tabs = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)).slice(0, 30);
    }
  }

  // 创建标签页映射
  tabs.forEach(tab => {
    tabMap.set(tab.id, {
      ...tab,
      children: []
    });
  });
  
  // 构建父子关系
  tabs.forEach(tab => {
    const parentId = tabRelations[tab.id];
    if (parentId && tabMap.has(parentId)) {
      const parent = tabMap.get(parentId);
      const child = tabMap.get(tab.id);
      parent.children.push(child);
    } else {
      // 没有父节点的作为根节点
      const tabNode = tabMap.get(tab.id);
      
      // 检查是否为置顶标签页
      const isPinned = pinnedTabsCache && pinnedTabsCache[tab.id];
      if (isPinned) {
        pinnedTabs.push(tabNode);
      } else {
        normalTabs.push(tabNode);
      }
    }
  });
  
  // 普通排序逻辑
  if (!selectedFilters || !selectedFilters.recent) {
    // 置顶：按置顶时间（新→旧）
    pinnedTabs.sort((a, b) => {
      const aTimestamp = pinnedTabsCache[a.id]?.timestamp || 0;
      const bTimestamp = pinnedTabsCache[b.id]?.timestamp || 0;
      return bTimestamp - aTimestamp;
    });
    // 普通：按 windowId + index 组合排序
    normalTabs.sort((a, b) => {
      if (a.windowId !== b.windowId) return a.windowId - b.windowId;
      return a.index - b.index;
    });
  } else {
    // 启用"最近"筛选时，如有分组，则先按分组聚合，再在组内按时间倒序
    const hasGroupInfo = tabGroupInfo && Object.keys(tabGroupInfo).length > 0;
    if (hasGroupInfo) {
      normalTabs.sort((a, b) => {
        const aGroup = (typeof a.groupId === 'number' && a.groupId >= 0) ? a.groupId : Number.MAX_SAFE_INTEGER;
        const bGroup = (typeof b.groupId === 'number' && b.groupId >= 0) ? b.groupId : Number.MAX_SAFE_INTEGER;
        if (aGroup !== bGroup) return aGroup - bGroup; // 分组优先
        const aTime = a.lastAccessed || 0;
        const bTime = b.lastAccessed || 0;
        return bTime - aTime; // 组内按时间倒序
      });
    } else {
      // 无分组则保持原来的时间倒序即可（此时 tabs 已全局截断为30）
      normalTabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    }
  }
  
  // 置顶标签页在前，普通标签页在后
  return [...pinnedTabs, ...normalTabs];
}

// 渲染树结构
function renderTree(tree) {
  const container = document.getElementById('treeContainer');
  container.innerHTML = '';
  
  // 分离置顶标签页和普通标签页
  let pinnedTabs = tree.filter(node => pinnedTabsCache && pinnedTabsCache[node.id]);
  let normalTabs = tree.filter(node => !pinnedTabsCache || !pinnedTabsCache[node.id]);

  // 置顶标题分隔符（在前）
  if (pinnedTabs.length > 0) {
    const header = document.createElement('div');
    header.className = 'pinned-separator';
    header.dataset.separatorType = 'pinned-header';
    const label = document.createElement('span');
    label.className = 'separator-label';
    label.textContent = i18n('pinnedTabs') || '📌';
    const line = document.createElement('div');
    line.className = 'separator-line';
    header.appendChild(label);
    header.appendChild(line);
    container.appendChild(header);
  }
  
  // 渲染置顶标签页
  pinnedTabs.forEach((node, index, array) => {
    node.groupId = -1; // 显式标记置顶不属于任何分组，避免被聚合进分组
    renderNode(node, container, 0, [], false);
  });
  
  // 置顶与普通分组之间不再追加末尾横线
  
  // 渲染普通标签页（在组前插入分隔符与组名）
  const hasGroupInfo = tabGroupInfo && Object.keys(tabGroupInfo).length > 0;
  let prevGroupId = null;
  let prevWindowId = null;
  let seenGrouped = false;
  normalTabs.forEach((node, index, array) => {
    const currGroupId = (typeof node.groupId === 'number') ? node.groupId : -1;
    const currWindowId = node.windowId;
    const currIsGrouped = currGroupId !== -1;

    const windowChanged = index > 0 && currWindowId !== prevWindowId;
    const groupChanged = index === 0 ? false : (windowChanged || currGroupId !== prevGroupId);

    // 在分组切换前，为上一分组插入"尾部分隔符"
    // if (hasGroupInfo && index > 0) {
    //   const prevWasGrouped = prevGroupId !== -1 && prevGroupId !== null;
    //   if (prevWasGrouped && groupChanged) {
    //     const tail = document.createElement('div');
    //     tail.className = 'pinned-separator';
    //     tail.dataset.separatorType = 'group-tail';
    //     const tailLine = document.createElement('div');
    //     tailLine.className = 'separator-line';
    //     tail.appendChild(tailLine);
    //     container.appendChild(tail);
    //   }
    // }

    // 在当前分组的第一个元素之前插入分隔符（含组名）——仅在有分组信息且该节点确属分组时显示
    if (hasGroupInfo && currIsGrouped && ((index === 0) || groupChanged)) {
      const header = document.createElement('div');
      header.className = 'pinned-separator';
      header.dataset.separatorType = 'group-header';
      header.dataset.groupId = String(currGroupId);
      header.dataset.groupId = String(currGroupId);

      const label = document.createElement('span');
      label.className = 'separator-label';
      const title = (tabGroupInfo[currGroupId] && tabGroupInfo[currGroupId].title) ? tabGroupInfo[currGroupId].title : (i18n('tabGroup') || 'Group');
      label.textContent = title;

      const line = document.createElement('div');
      line.className = 'separator-line';

      header.appendChild(label);
      header.appendChild(line);
      container.appendChild(header);
      seenGrouped = true;
    }

    // 未分组区不再强制插入分隔符，由分隔符可见性函数控制

    renderNode(node, container, 0, [], index === array.length - 1);

    prevGroupId = currGroupId;
    prevWindowId = currWindowId;
  });

  // 列表末尾若最后一个是"分组"，补一个尾部分隔符
  if (hasGroupInfo && normalTabs.length > 0) {
    const lastNode = normalTabs[normalTabs.length - 1];
    const lastGroupId = (typeof lastNode.groupId === 'number') ? lastNode.groupId : -1;
    if (lastGroupId !== -1) {
      const tail = document.createElement('div');
      tail.className = 'pinned-separator';
      tail.dataset.separatorType = 'group-tail';
      tail.dataset.groupId = String(lastGroupId);
      const tailLine = document.createElement('div');
      tailLine.className = 'separator-line';
      tail.appendChild(tailLine);
      container.appendChild(tail);
    }
  }

  // 渲染完成后更新一次分隔符可见性，避免初始状态异常
  updateSeparatorVisibility();
}

// 从DOM中移除指定的标签页元素
async function removeTabElements(tabIds) {
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

// 更新导航按钮状态
async function updateNavigationButtons() {
  if (window.tabHistory) {
    const backBtn = document.getElementById('backBtn');
    const forwardBtn = document.getElementById('forwardBtn');
    
    if (backBtn) {
      backBtn.disabled = !(await window.tabHistory.canGoBack());
    }
    
    if (forwardBtn) {
      forwardBtn.disabled = !(await window.tabHistory.canGoForward());
    }
    
    // 调试信息
    const status = await window.tabHistory.getStatus();
    console.log('📚 Navigation status:', status);
  }
}

// 渲染单个节点
function renderNode(node, container, depth, parentLines = [], isLast = false) {
  const nodeElement = document.createElement('div');
  nodeElement.className = 'tree-node';
  nodeElement.dataset.tabId = node.id;
  nodeElement.dataset.tabUrl = node.url || '';
  nodeElement.dataset.groupId = (typeof node.groupId === 'number' && node.groupId >= 0) ? String(node.groupId) : '-1';
  
  // 检查是否是当前标签页
  if (node.id === currentTabId) {
    nodeElement.classList.add('current-tab');
  }
  
  // 检查标签页是否未加载
  // Chrome中discarded表示标签页被丢弃（未加载状态）
  // status字段可能为'unloaded'或'loading'
  if (node.discarded || node.status === 'unloaded') {
    nodeElement.classList.add('unloaded');
    // console.log('🔄 Unloaded tab detected:', node.id, node.title, 'discarded:', node.discarded, 'status:', node.status);
  }
  
  // 检查是否为置顶标签页并应用样式（使用缓存数据）
  const isPinned = pinnedTabsCache && pinnedTabsCache[node.id];
  if (isPinned) {
    nodeElement.classList.add('pinned-tab');
    console.log('📌 Applied pinned styling to tab:', node.id, node.title);
  }
  
  // 生成树形结构符号
  const treeStructure = document.createElement('span');
  treeStructure.className = 'tree-structure';
  
  let structureText = '';
  
  // 添加父级的连接线
  for (let i = 0; i < depth; i++) {
    if (i < parentLines.length && parentLines[i]) {
      structureText += '  ';
    } else {
      structureText += '  ';
    }
  }
  
  // 添加当前节点的连接符
  if (depth > 0) {
    structureText += isLast ? '└─' : '├─';
  }
  
  treeStructure.textContent = structureText;
  nodeElement.appendChild(treeStructure);
  
  // 图标
  const icon = document.createElement('div');
  icon.className = 'tree-icon';
  
  // 检查是否为特殊文件类型
  const fileType = detectFileType(node.url);
  if (fileType) {
    const config = getFileTypeConfig(fileType);
    if (config) {
      // 使用对应的文件类型图标
      const iconUrl = chrome.runtime.getURL(config.icon);
      
      icon.style.backgroundImage = `url("${iconUrl}")`;
      icon.style.backgroundColor = config.bgColor || 'transparent';
      icon.style.backgroundSize = 'contain';
      icon.style.backgroundRepeat = 'no-repeat';
      icon.style.backgroundPosition = 'center';
      icon.style.width = '16px';
      icon.style.height = '16px';
      icon.innerHTML = ''; // 清除任何文本内容
      icon.title = i18n(config.title);
      console.log(`🎯 ${fileType.toUpperCase()} icon loaded:`, iconUrl);
    }
  } else if (node.favIconUrl && isValidFaviconUrl(node.favIconUrl)) {
    // 检查favIconUrl是否有效且安全
    icon.style.backgroundImage = `url(${node.favIconUrl})`;
  } else {
    // 使用默认图标
    icon.style.backgroundColor = '#ddd';
    icon.style.borderRadius = '2px';
  }
  nodeElement.appendChild(icon);
  
  // 标题
  const title = document.createElement('div');
  title.className = 'tree-title';
  title.textContent = node.title || node.url;
  title.title = `${node.title}\n\n${node.url}`; // 悬停显示完整URL
  nodeElement.appendChild(title);
  
  // 状态显示容器
  const statusContainer = document.createElement('div');
  statusContainer.className = 'tab-status-container';
  
  // 音频状态
  if (node.audible) {
    const audioStatus = document.createElement('span');
    audioStatus.textContent = '♪';
    audioStatus.className = 'tab-status playing';
    audioStatus.title = i18n('audioPlaying');
    statusContainer.appendChild(audioStatus);
  } else if (node.mutedInfo && node.mutedInfo.muted) {
    const mutedStatus = document.createElement('span');
    mutedStatus.textContent = '×';
    mutedStatus.className = 'tab-status muted';
    mutedStatus.title = i18n('audioMuted');
    statusContainer.appendChild(mutedStatus);
  }
  
  // 异步获取书签信息，同时更新标题和状态
  const isCurrentTab = node.id === currentTabId;
  getBookmarkInfo(node.url, isCurrentTab).then(bookmarkInfo => {
    // 构建完整的tooltip信息
    let tooltipText = `${node.title}`;
    
          // 更新标题（如果有书签标题）
      if (bookmarkInfo.isBookmarked && bookmarkInfo.title && bookmarkInfo.title.trim()) {
        title.textContent = bookmarkInfo.title;
        
        // 如果标题和书签名称相等，只显示标题
        if (node.title === bookmarkInfo.title) {
          tooltipText = `📄 ${i18n('tooltipTitleLabel')}: ${node.title}`;
        } else {
          tooltipText = `📄 ${i18n('tooltipTitleLabel')}: ${node.title}\n📖 ${i18n('tooltipBookmarkLabel')}: ${bookmarkInfo.title}`;
        }
      }
    
    // 添加文件夹路径信息
    if (bookmarkInfo.isBookmarked && bookmarkInfo.folderPath) {
      tooltipText += `\n📁 ${i18n('tooltipFolderLabel')}: ${bookmarkInfo.folderPath}`;
    }
    
    title.title = tooltipText + `\n\n${node.url}`;
    
    // 添加书签状态图标
    if (bookmarkInfo.isBookmarked) {
      const bookmarkStatus = document.createElement('span');
      bookmarkStatus.textContent = '★';
      bookmarkStatus.className = 'tab-status bookmarked';
      bookmarkStatus.title = i18n('bookmarkAdded');
      statusContainer.appendChild(bookmarkStatus);
    }
  }).catch(error => {
    console.log('Error getting bookmark info:', error.message);
  });
  
  nodeElement.appendChild(statusContainer);
  
  // 创建操作区域容器
  const actionsContainer = document.createElement('div');
  actionsContainer.className = 'tree-actions';
  
  // 选择按钮容器
  const selectBtnContainer = document.createElement('div');
  selectBtnContainer.className = 'select-btn-container';
  
  // 选择按钮
  const selectBtn = document.createElement('button');
  selectBtn.className = 'select-btn';
  selectBtn.textContent = '✓';
  selectBtn.title = i18n('selectNode');
  
  // 透明点击区域
  const selectOverlay = document.createElement('div');
  selectOverlay.className = 'select-btn-overlay';
  selectOverlay.addEventListener('click', (e) => {
    e.stopPropagation();
    selectNodeAndChildren(node, nodeElement);
  });
  
  selectBtnContainer.appendChild(selectBtn);
  selectBtnContainer.appendChild(selectOverlay);
  
  // 置顶按钮容器（放在 select 和 close 中间）
  const pinBtnContainer = document.createElement('div');
  pinBtnContainer.className = 'pin-btn-container';
  
  // 置顶按钮
  const pinBtn = document.createElement('button');
  pinBtn.className = 'pin-btn';
  // 使用内嵌span控制视觉高度
  const pinIcon = document.createElement('span');
  pinIcon.className = 'pin-icon';
  
  // 根据置顶状态设置图标和提示文本
  const isPinnedForButton = pinnedTabsCache && pinnedTabsCache[node.id];
  if (isPinnedForButton) {
    pinIcon.textContent = '📌'; // 已置顶状态的图标
    pinBtn.title = i18n('unpinFromTop') || 'Unpin from top';
  } else {
    pinIcon.textContent = '⬆'; // 未置顶状态的图标
    pinBtn.title = i18n('pinToTop') || 'Pin to top';
  }
  
  pinBtn.appendChild(pinIcon);
  
  // 透明点击区域
  const pinOverlay = document.createElement('div');
  pinOverlay.className = 'pin-btn-overlay';
  pinOverlay.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      // 使用缓存检查当前是否已置顶
      const isCurrentlyPinned = pinnedTabsCache && pinnedTabsCache[node.id];
      
      if (isCurrentlyPinned) {
        // 取消置顶
        await chrome.runtime.sendMessage({ action: 'removePinnedTab', tabId: node.id });
        // 更新本地缓存
        delete pinnedTabsCache[node.id];
        console.log(`📌 Unpinned tab: ${node.id}`);
      } else {
        // 置顶操作
        // 将该标签页移动到所在窗口的最前端（index 0）
        await chrome.tabs.move(node.id, { index: 0 });
        
        // 移除该标签页的父子关系（置顶后成为根）
        try {
          await chrome.runtime.sendMessage({ action: 'removeTabRelationsFor', tabId: node.id });
        } catch (remErr) {
          console.warn('Failed to remove relations for pinned tab:', remErr);
        }
        
        // 添加到置顶列表
        const tabInfo = {
          url: node.url,
          title: node.title
        };
        await chrome.runtime.sendMessage({ 
          action: 'addPinnedTab', 
          tabId: node.id,
          tabInfo: tabInfo
        });
        
        // 更新本地缓存（tabId映射）
        pinnedTabsCache[node.id] = {
          ...tabInfo,
          timestamp: Date.now()
        };
        console.log(`📌 Pinned tab: ${node.id} - ${node.title}`);
      }
      
      // 刷新树形结构视图
      await loadTabTree();
    } catch (err) {
      console.error('Error toggling pin state:', err);
    }
  });
  
  pinBtnContainer.appendChild(pinBtn);
  pinBtnContainer.appendChild(pinOverlay);

  // 关闭按钮容器
  const closeBtnContainer = document.createElement('div');
  closeBtnContainer.className = 'close-btn-container';
  
  // 关闭按钮
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close-btn';
  closeBtn.textContent = '×';
  
  // 关闭按钮透明点击区域
  const closeOverlay = document.createElement('div');
  closeOverlay.className = 'close-btn-overlay';
  closeOverlay.addEventListener('click', (e) => {
    e.stopPropagation();
    closeSelectedOrCurrent(node);
  });
  
  // 动态更新关闭按钮的提示文本
  closeOverlay.addEventListener('mouseenter', () => {
    if (selectedTabIds.size > 0) {
      closeBtn.title = i18n('closeSelectedTabs', [selectedTabIds.size.toString()]);
    } else {
      closeBtn.title = i18n('closeNode');
    }
  });
  
  closeBtnContainer.appendChild(closeBtn);
  closeBtnContainer.appendChild(closeOverlay);
  
  // 将按钮容器添加到操作区域
  actionsContainer.appendChild(selectBtnContainer);
  actionsContainer.appendChild(pinBtnContainer);
  actionsContainer.appendChild(closeBtnContainer);
  
  // 将操作区域添加到节点
  nodeElement.appendChild(actionsContainer);
  
  // 点击节点事件 - 切换到该标签页并激活窗口
  nodeElement.addEventListener('click', async (e) => {
    e.stopPropagation();
    console.log(`Node clicked: ${node.id} - ${node.title}`);
    // 若当前有输入文本，且该项为书签，则记录搜索历史
    try {
      const input = document.getElementById('searchInput');
      const term = (input && input.value ? input.value.trim() : '');
      if (term) {
        await saveSearchHistory(term);
      }
    } catch (_) {}
    activateTabAndWindow(node.id);
  });
  
  container.appendChild(nodeElement);
  
  // 递归渲染子节点
  if (node.children && node.children.length > 0) {
    const newParentLines = [...parentLines];
    if (depth >= 0) {
      newParentLines[depth] = !isLast;
    }
    
    node.children.forEach((child, index, array) => {
      renderNode(child, container, depth + 1, newParentLines, index === array.length - 1);
    });
  }
}

// 选中节点及其所有子节点
function selectNodeAndChildren(node, nodeElement) {
  // 切换选中状态
  const isSelected = selectedTabIds.has(node.id);
  
  if (isSelected) {
    // 取消选中
    deselectNodeAndChildren(node);
  } else {
    // 选中
    selectNodeAndChildrenRecursive(node);
  }
  
  // 更新UI显示
  updateSelectionUI();
}

// 递归选中节点及其子节点
function selectNodeAndChildrenRecursive(node) {
  selectedTabIds.add(node.id);
  node.children.forEach(child => {
    selectNodeAndChildrenRecursive(child);
  });
}

// 递归取消选中节点及其子节点
function deselectNodeAndChildren(node) {
  selectedTabIds.delete(node.id);
  node.children.forEach(child => {
    deselectNodeAndChildren(child);
  });
}

// 更新选中状态的UI显示
function updateSelectionUI() {
  document.querySelectorAll('.tree-node').forEach(nodeElement => {
    const tabId = parseInt(nodeElement.dataset.tabId);
    if (selectedTabIds.has(tabId)) {
      nodeElement.classList.add('selected');
    } else {
      nodeElement.classList.remove('selected');
    }
  });
}

// 滚动到当前标签页
function scrollToCurrentTab() {
  if (!currentTabId) return;
  
  const currentNode = document.querySelector(`[data-tab-id="${currentTabId}"]`);
  if (currentNode) {
    const container = document.getElementById('treeContainer');
    
    // 计算节点相对于容器的位置
    const nodeTop = currentNode.offsetTop - currentNode.parentElement.offsetTop;
    const containerHeight = container.clientHeight;
    const nodeHeight = currentNode.offsetHeight;
    
    // 如果节点不在可视区域内，直接跳转到节点位置
    if (nodeTop < container.scrollTop || nodeTop + nodeHeight > container.scrollTop + containerHeight) {
      // 将节点滚动到容器中央
      const targetScrollTop = nodeTop - (containerHeight / 2) + (nodeHeight / 2);
      container.scrollTop = Math.max(0, targetScrollTop);
    }
  }
}

// 关闭标签页及其所有子节点
async function closeTabAndChildren(node) {
  const tabsToClose = [];
  
  // 收集要关闭的标签页ID
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
    // 从DOM中移除已关闭的标签页元素，避免刷新视图
    await removeTabElements(tabsToClose);
  } catch (error) {
    console.error('Error closing tabs:', error);
  }
}

// clearAllData函数已移动到options.js

// ===================
// 导航状态管理（基于现有的历史记录接口）
// ===================

/**
 * 导航状态辅助函数 - 通过现有的getHistoryData接口管理导航状态
 */
const NavigationHelper = {
  /**
   * 检查当前是否处于导航状态
   * @returns {Promise<boolean>} 是否正在导航
   */
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
// 搜索功能实现
// ===================

let currentSearchTerm = '';
let originalTreeData = null; // 存储原始的树数据

// 文本规范化函数 - 处理中文搜索
function normalizeText(text) {
  if (!text) return '';
  
  return text
    .toLowerCase()
    // 将全角字符转换为半角
    .replace(/[\uff01-\uff5e]/g, function(ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    })
    // 将全角空格转换为半角空格
    .replace(/\u3000/g, ' ')
    // 移除多余的空格
    .replace(/\s+/g, ' ')
    .trim();
}

// 初始化搜索功能
function initializeSearch() {
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  
  if (!searchInput || !clearSearchBtn) return;
  
  // 搜索输入事件
  searchInput.addEventListener('input', handleSearchInput);
  searchInput.addEventListener('keydown', handleSearchKeydown);
  
  // 清除搜索按钮事件
  clearSearchBtn.addEventListener('click', clearSearch);
  
  // 默认聚焦到搜索框
  setTimeout(() => {
    searchInput.focus();
  }, 100);
}

// 处理搜索输入
function handleSearchInput(e) {
  const searchTerm = e.target.value.trim();
  const clearBtn = document.getElementById('clearSearchBtn');
  
  // 显示/隐藏清除按钮
  if (searchTerm) {
    clearBtn.classList.add('visible');
  } else {
    clearBtn.classList.remove('visible');
  }
  
  // 执行搜索
  performSearch(searchTerm);
}

// 处理搜索键盘事件
function handleSearchKeydown(e) {
  if (e.key === 'Escape') {
    clearSearch();
  }
}

// 执行搜索
async function performSearch(searchTerm) {
  currentSearchTerm = normalizeText(searchTerm);
  const treeContainer = document.getElementById('treeContainer');
  
  // 调试信息
  console.log('🔍 Search debug:', {
    original: searchTerm,
    normalized: currentSearchTerm,
    length: currentSearchTerm.length
  });

  // 若启用"最近"，为保证顺序（标签打开/访问倒序），主动刷新一次树数据
  // 避免循环：仅当不是由最近刷新触发时才调用
  if ((selectedFilters.recent != selectedFilters.lastRecent) && !isRefreshingByRecent) {
    try {
      isRefreshingByRecent = true;
      await loadTabTree(); // 重建树数据
    } finally {
      isRefreshingByRecent = false;
    }
    selectedFilters.lastRecent = selectedFilters.recent;
  }
  
  // 若没有任何文字与标签过滤，则显示所有
  if (!searchTerm && !selectedFilters.bookmarked && !selectedFilters.recent && !selectedFilters.historyTerm) {
    showAllNodes();
    removeNoResultsMessage();
    // 滚动到当前标签页
    scrollToCurrentTab();
    return;
  }

  // 如需书签过滤则预加载书签集合
  if (selectedFilters.bookmarked && !bookmarkedUrlsSet) {
    await getAllBookmarkedUrlSet();
  }
  
  // 搜索和过滤节点（结合标签过滤）
  const hasResults = await filterNodesWithTags();
  
  if (!hasResults) {
    showNoResultsMessage();
  } else {
    removeNoResultsMessage();
  }
  // 滚动到当前标签页
  scrollToCurrentTab();
}

// 过滤节点（支持标签）
async function filterNodesWithTags() {
  const allNodes = document.querySelectorAll('.tree-node');
  let hasVisibleResults = false;
  let hasPinnedResults = false;
  let hasNormalResults = false;
  
  allNodes.forEach((node, index) => {
    const tabTitle = node.querySelector('.tree-title');
    const tabUrl = node.getAttribute('data-tab-url') || '';
    const titleText = tabTitle ? normalizeText(tabTitle.textContent) : '';
    const tabId = parseInt(node.getAttribute('data-tab-id'));
    
    // 文字匹配
    const titleMatches = currentSearchTerm ? titleText.includes(currentSearchTerm) : true;
    const urlMatches = currentSearchTerm ? normalizeText(tabUrl).includes(currentSearchTerm) : true;
    let matches = titleMatches || urlMatches;

    // 历史词匹配（如果选择了某个历史词，且未输入当前词，则只用历史词过滤）
    if (matches && selectedFilters.historyTerm && !currentSearchTerm) {
      const hist = normalizeText(selectedFilters.historyTerm);
      matches = titleText.includes(hist) || normalizeText(tabUrl).includes(hist);
    }

    // 书签过滤
    if (matches && selectedFilters.bookmarked) {
      const normalize = (u) => { try { const x = new URL(u); x.hash = ''; return x.href; } catch { return (u||'').split('#')[0]; } };
      const norm = normalize(tabUrl);
      if (!bookmarkedUrlsSet || !bookmarkedUrlsSet.has(norm)) {
        matches = false;
      }
    }
    
    // 调试前几个节点的搜索信息
    if (index < 3 && currentSearchTerm) {
      console.log(`🔍 Node ${index} debug:`, {
        originalTitle: tabTitle ? tabTitle.textContent : 'No title',
        normalizedTitle: titleText,
        searchTerm: currentSearchTerm,
        titleMatches,
        urlMatches,
        matches
      });
    }
    
    if (matches) {
      // 显示匹配的节点
      node.classList.remove('hidden');
      showParentNodes(node);
      hasVisibleResults = true;
      
      // 检查是否为置顶标签页
      const isPinned = pinnedTabsCache && pinnedTabsCache[tabId];
      if (isPinned) {
        hasPinnedResults = true;
      } else {
        hasNormalResults = true;
      }
      
      // 高亮匹配的文本
      if (titleMatches && tabTitle) {
        highlightText(tabTitle, currentSearchTerm);
      }
    } else {
      // 隐藏不匹配的节点
      node.classList.add('hidden');
    }
  });
  
  // 智能显示/隐藏分隔线（若分隔符下没有任何可见内容，则隐藏该分隔符）
  updateSeparatorVisibility();
  
  return hasVisibleResults;
}

// 根据过滤结果更新分隔符可见性：若分隔符之后直到下一个分隔符（或容器末尾）之间没有任何可见的节点，则隐藏该分隔符
function updateSeparatorVisibility() {
  const container = document.getElementById('treeContainer');
  if (!container) return;
  const separators = Array.from(container.querySelectorAll('.pinned-separator'));
  const hasAnyGroupHeader = !!container.querySelector('.pinned-separator[data-separator-type="group-header"]');
  separators.forEach(sep => {
    const type = sep.dataset.separatorType || '';
    if (type === 'group-tail' && !hasAnyGroupHeader) {
      // 搜索后无任何分组可见，则隐藏末尾分隔符
      sep.style.display = 'none';
      return;
    }
    // 头部分隔符：检查后向是否有可见节点（仅同组）
    if (type === 'group-header' || type === 'pinned-header' || type === '') {
      const headerGroupId = sep.dataset.groupId || null;
      let sibling = sep.nextElementSibling;
      let hasVisible = false;
      while (sibling) {
        if (sibling.classList && sibling.classList.contains('pinned-separator')) break;
        if (sibling.classList && sibling.classList.contains('tree-node') && !sibling.classList.contains('hidden')) {
          if (type === 'group-header') {
            const nodeGroupId = sibling.dataset && sibling.dataset.groupId;
            if (nodeGroupId === headerGroupId) { hasVisible = true; break; }
          } else {
            hasVisible = true; break;
          }
        }
        sibling = sibling.nextElementSibling;
      }
      sep.style.display = hasVisible ? 'flex' : 'none';
    } else if (type === 'group-tail') {
      // 尾部分隔符：检查前向是否有可见节点（仅同组）
      const tailGroupId = sep.dataset.groupId || null;
      let sibling = sep.previousElementSibling;
      let hasVisible = false;
      while (sibling) {
        if (sibling.classList && sibling.classList.contains('pinned-separator')) break;
        if (sibling.classList && sibling.classList.contains('tree-node') && !sibling.classList.contains('hidden')) {
          const nodeGroupId = sibling.dataset && sibling.dataset.groupId;
          if (nodeGroupId === tailGroupId) { hasVisible = true; break; }
        }
        sibling = sibling.previousElementSibling;
      }
      sep.style.display = hasVisible ? 'flex' : 'none';
    }
  });
}

// 显示节点的所有父节点
function showParentNodes(node) {
  let parent = node.parentElement;
  while (parent && parent.classList.contains('tree-node')) {
    parent.classList.remove('hidden');
    parent = parent.parentElement;
  }
}

// 显示所有节点
function showAllNodes() {
  const allNodes = document.querySelectorAll('.tree-node');
  allNodes.forEach(node => {
    node.classList.remove('hidden');
    // 移除高亮
    removeHighlight(node);
  });
  
  // 先显示所有分隔线，再根据可见内容更新隐藏状态
  const separators = document.querySelectorAll('.pinned-separator');
  separators.forEach(sep => sep.style.display = 'flex');
  updateSeparatorVisibility();
}

// 高亮匹配的文本
function highlightText(element, searchTerm) {
  // 移除之前的高亮
  removeHighlight(element);
  
  if (!searchTerm) return;
  
  const text = element.textContent;
  const normalizedText = normalizeText(text);
  const normalizedSearchTerm = normalizeText(searchTerm);
  const index = normalizedText.indexOf(normalizedSearchTerm);
  
  if (index !== -1) {
    // 找到原始文本中对应的位置和长度
    let originalIndex = index;
    let originalLength = normalizedSearchTerm.length;
    
    // 如果规范化影响了文本，需要重新在原文中定位
    if (normalizedText !== text.toLowerCase()) {
      // 使用简单的模糊匹配来定位原始文本中的位置
      const pattern = new RegExp(escapeRegExp(searchTerm), 'i');
      const match = text.match(pattern);
      if (match) {
        originalIndex = match.index;
        originalLength = match[0].length;
      }
    }
    
    const beforeText = text.substring(0, originalIndex);
    const matchText = text.substring(originalIndex, originalIndex + originalLength);
    const afterText = text.substring(originalIndex + originalLength);
    
    element.innerHTML = beforeText + 
      '<span class="search-highlight">' + matchText + '</span>' + 
      afterText;
  }
}

// 转义正则表达式特殊字符
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 移除高亮
function removeHighlight(nodeOrElement) {
  const element = nodeOrElement.querySelector ? 
    nodeOrElement.querySelector('.tree-title') : nodeOrElement;
  
  if (element) {
    const highlights = element.querySelectorAll('.search-highlight');
    highlights.forEach(highlight => {
      const text = highlight.textContent;
      highlight.replaceWith(document.createTextNode(text));
    });
    element.normalize(); // 合并相邻的文本节点
  }
}

// 显示无结果消息
function showNoResultsMessage() {
  removeNoResultsMessage();
  
  const treeContainer = document.getElementById('treeContainer');
  const noResults = document.createElement('div');
  noResults.className = 'no-results';
  noResults.id = 'noResults';
  noResults.textContent = `No tabs found matching "${currentSearchTerm}"`;
  
  treeContainer.appendChild(noResults);
}

// 移除无结果消息
function removeNoResultsMessage() {
  const existing = document.getElementById('noResults');
  if (existing) {
    existing.remove();
  }
}

// 清除搜索
function clearSearch() {
  const searchInput = document.getElementById('searchInput');
  const clearBtn = document.getElementById('clearSearchBtn');
  
  if (searchInput) {
    searchInput.value = '';
    searchInput.focus();
  }
  
  if (clearBtn) {
    clearBtn.classList.remove('visible');
  }
  
  currentSearchTerm = '';
  showAllNodes();
  removeNoResultsMessage();
  renderChipsLayer();
}

// 重写渲染函数以支持搜索
const originalRenderFunction = window.renderTabTree || (() => {});
function renderTabTreeWithSearch(...args) {
  // 调用原始渲染函数
  const result = originalRenderFunction.apply(this, args);
  
  // 重新应用搜索过滤
  if (currentSearchTerm) {
    setTimeout(() => performSearch(currentSearchTerm), 10);
  }
  
  return result;
}

// 如果存在渲染函数，替换它
if (window.renderTabTree) {
  window.renderTabTree = renderTabTreeWithSearch;
}

// 初始化搜索功能（在DOM就绪后）
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeSearch);
} else {
  initializeSearch();
}

// 调试函数 - 测试搜索功能
window.debugSearch = {
  // 测试文本规范化
  testNormalize: (text) => {
    console.log('📝 Text normalization test:', {
      original: text,
      normalized: normalizeText(text)
    });
    return normalizeText(text);
  },
  
  // 测试搜索匹配
  testSearch: (searchTerm) => {
    console.log('🔍 Testing search for:', searchTerm);
    performSearch(searchTerm);
  },
  
  // 查看所有标签页标题
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

// 计算合适的tree-container高度
function calculateTreeHeight() {
  const treeContainer = document.getElementById('treeContainer');
  if (!treeContainer) return;

  // 简单判断body是否有滚动条
  const bodyHasScrollbar = document.body.scrollHeight > document.body.clientHeight+10;
  console.log('bodyScrollHeight', document.body.scrollHeight, 'bodyClientHeight', document.body.clientHeight);
  const htmlHasScrollbar = document.documentElement.scrollHeight > document.documentElement.clientHeight+10;
  console.log('htmlScrollHeight', document.documentElement.scrollHeight, 'htmlClientHeight', document.documentElement.clientHeight);

  
  if (!bodyHasScrollbar && !htmlHasScrollbar) {
    console.log('📏 No scrollbar detected, skipping height calculation');
    return;
  }
  
  console.log('📏 Scrollbar detected, calculating optimal height...');
  
  // 获取popup的实际高度（通常是600px）
  const popupHeight = window.innerHeight || document.body.offsetHeight || 600;
  
  // 计算其他元素占用的高度
  let usedHeight = 0;
  
  // body的padding (通常是10px上下)
  const bodyStyle = getComputedStyle(document.body);

  usedHeight += parseInt(bodyStyle.paddingTop) + parseInt(bodyStyle.paddingBottom);
  
  // header高度
  const header = document.querySelector('.header');
  if (header) {
    usedHeight += header.offsetHeight;
    const headerStyle = getComputedStyle(header);
    usedHeight += parseInt(headerStyle.marginBottom) + parseInt(headerStyle.paddingBottom);
  }
  
  // 搜索框高度
  const searchContainer = document.querySelector('.search-container');
  if (searchContainer) {
    usedHeight += searchContainer.offsetHeight;
    const searchStyle = getComputedStyle(searchContainer);
    usedHeight += parseInt(searchStyle.marginBottom);
  }
  
  // 计算可用高度，保留20px安全边距
  const availableHeight = popupHeight - usedHeight - 30 - 24;
  
  // 设置最小高度200px，最大高度500px
  const finalHeight = Math.max(200, Math.min(500, availableHeight));
  
  treeContainer.style.maxHeight = `${finalHeight}px`;
  
  console.log('📐 Height calculation:', {
    popupHeight,
    usedHeight,
    availableHeight,
    finalHeight: finalHeight + 'px'
  });
}

// 为调试添加到全局作用域
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
  // 导航状态调试工具
  navigation: {
    isNavigating: () => NavigationHelper.isNavigating(),
    setNavigating: () => NavigationHelper.setNavigating()
  },
  // PDF检测调试工具
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
  
  // 标签页状态调试工具
  tabStatus: {
    // 检查所有标签页的加载状态
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
    
    // 检查DOM中unloaded类的应用情况
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
    
    // 手动刷新unloaded状态
    refreshUnloadedStatus: async () => {
      console.log('🔄 Refreshing unloaded status...');
      await loadTabTree();
    }
  }
};
