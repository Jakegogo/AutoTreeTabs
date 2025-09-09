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
    icon: 'icon-pdf.svg',
    title: 'pdfFile',
    bgColor: 'transparent'
  },
  html: {
    extensions: ['.html', '.htm'],
    protocols: ['file://', 'chrome-extension://'],
    icon: 'icon-html.svg', 
    title: 'htmlFile',
    bgColor: 'transparent'
  },
  png: {
    extensions: ['.png'],
    protocols: ['file://', 'chrome-extension://'],
    icon: 'icon-png.svg',
    title: 'imageFile',
    bgColor: 'transparent'
  },
  jpg: {
    extensions: ['.jpg', '.jpeg'],
    protocols: ['file://', 'chrome-extension://'],
    icon: 'icon-jpg.svg',
    title: 'imageFile',
    bgColor: 'transparent'
  },
  svg: {
    extensions: ['.svg'],
    protocols: ['file://', 'chrome-extension://'],
    icon: 'icon-svg.svg',
    title: 'imageFile',
    bgColor: 'transparent'
  },
  markdown: {
    extensions: ['.md', '.markdown'],
    protocols: ['file://', 'chrome-extension://'],
    icon: 'icon-md.svg',
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
  
  // 立即刷新并加载树形结构
  await loadTabTree();
  
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
  
  // 绑定导出按钮事件
  document.getElementById('exportBtn').addEventListener('click', async () => {
    await exportTabTree();
  });
  
  // 绑定自动整理按钮事件
  document.getElementById('organizeBtn').addEventListener('click', async () => {
    // 检查AutoOrganizer类或实例是否可用
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
  // 滚动到当前标签页
  scrollToCurrentTab();
  // 初始化导航按钮状态
  updateNavigationButtons();
  // 初始化国际化
  initI18n();
});



// 防止频繁恢复关系
let lastRestoreTime = 0;
const RESTORE_COOLDOWN = 3000; // 3秒冷却时间

// 全局置顶标签页缓存
let pinnedTabsCache = {};

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
    
    // 构建树结构
    const tree = buildTabTree(tabs, tabRelations);
    
    // 渲染树
    renderTree(tree);
  } catch (error) {
    console.error('Error loading tab tree:', error);
  }
}

// 构建标签页树结构
function buildTabTree(tabs, tabRelations) {
  const tabMap = new Map();
  const rootTabs = [];
  const pinnedTabs = [];
  const normalTabs = [];
  
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
  
  // 对置顶标签页按照置顶时间排序（最新置顶的在前）
  pinnedTabs.sort((a, b) => {
    const aTimestamp = pinnedTabsCache[a.id]?.timestamp || 0;
    const bTimestamp = pinnedTabsCache[b.id]?.timestamp || 0;
    return bTimestamp - aTimestamp;
  });
  
  // 对普通标签页按照索引排序
  normalTabs.sort((a, b) => a.index - b.index);
  
  // 置顶标签页在前，普通标签页在后
  return [...pinnedTabs, ...normalTabs];
}

// 渲染树结构
function renderTree(tree) {
  const container = document.getElementById('treeContainer');
  container.innerHTML = '';
  
  // 分离置顶标签页和普通标签页
  const pinnedTabs = tree.filter(node => pinnedTabsCache && pinnedTabsCache[node.id]);
  const normalTabs = tree.filter(node => !pinnedTabsCache || !pinnedTabsCache[node.id]);
  
  // 渲染置顶标签页
  pinnedTabs.forEach((node, index, array) => {
    renderNode(node, container, 0, [], false); // 置顶标签页不显示为最后一个
  });
  
  // 如果有置顶标签页，添加分隔线
  if (pinnedTabs.length > 0 && normalTabs.length > 0) {
    const separator = document.createElement('div');
    separator.className = 'pinned-separator';
    separator.innerHTML = '<div class="separator-line"></div>';
    container.appendChild(separator);
  }
  
  // 渲染普通标签页
  normalTabs.forEach((node, index, array) => {
    renderNode(node, container, 0, [], index === array.length - 1);
  });

  
  // 重新应用搜索过滤（如果有搜索词）
  if (currentSearchTerm) {
    setTimeout(() => performSearch(currentSearchTerm), 30);
  }
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
  nodeElement.addEventListener('click', (e) => {
    e.stopPropagation();
    console.log(`Node clicked: ${node.id} - ${node.title}`);
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
    const nodeTop = currentNode.offsetTop;
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
function performSearch(searchTerm) {
  currentSearchTerm = normalizeText(searchTerm);
  const treeContainer = document.getElementById('treeContainer');
  
  // 调试信息
  console.log('🔍 Search debug:', {
    original: searchTerm,
    normalized: currentSearchTerm,
    length: currentSearchTerm.length
  });
  
  if (!searchTerm) {
    // 清空搜索，显示所有节点
    showAllNodes();
    removeNoResultsMessage();
    return;
  }
  
  // 搜索和过滤节点
  const hasResults = filterNodes();
  
  if (!hasResults) {
    showNoResultsMessage();
  } else {
    removeNoResultsMessage();
  }
}

// 过滤节点
function filterNodes() {
  const allNodes = document.querySelectorAll('.tree-node');
  let hasVisibleResults = false;
  let hasPinnedResults = false;
  let hasNormalResults = false;
  
  allNodes.forEach((node, index) => {
    const tabTitle = node.querySelector('.tree-title');
    const tabUrl = node.getAttribute('data-tab-url') || '';
    const titleText = tabTitle ? normalizeText(tabTitle.textContent) : '';
    const tabId = parseInt(node.getAttribute('data-tab-id'));
    
    // 检查标题和URL是否匹配搜索词
    const titleMatches = titleText.includes(currentSearchTerm);
    const urlMatches = normalizeText(tabUrl).includes(currentSearchTerm);
    const matches = titleMatches || urlMatches;
    
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
  
  // 智能显示/隐藏分隔线
  const separator = document.querySelector('.pinned-separator');
  if (separator) {
    // 只有当置顶和普通标签页都有匹配结果时才显示分隔线
    if (hasPinnedResults && hasNormalResults) {
      separator.style.display = 'flex';
    } else {
      separator.style.display = 'none';
    }
  }
  
  return hasVisibleResults;
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
  
  // 显示分隔线
  const separator = document.querySelector('.pinned-separator');
  if (separator) {
    separator.style.display = 'flex';
  }
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
  const availableHeight = popupHeight - usedHeight - 30;
  
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
    getIconUrl: () => chrome.runtime.getURL('icon-pdf.svg'),
    testUrls: () => {
      const testUrls = [
        'chrome-extension://oemmndcbldboiebfnladdacbdfmadadm/file:///Users/jake/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/%E6%8A%80%E6%9C%AF/%E6%8A%80%E6%9C%AF%E5%A4%A7%E4%BC%9A/qc5.pdf',
        'file:///Users/jake/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/%E6%8A%80%E6%9C%AF/%E6%8A%80%E6%9C%.pdf',
        'https://example.com/document.pdf',
        'https://google.com',
        'file:///path/to/document.txt'
      ];
      
      console.log('🔍 PDF URL Detection Test:');
      console.log('📄 PDF Icon URL:', chrome.runtime.getURL('icon-pdf.svg'));
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
