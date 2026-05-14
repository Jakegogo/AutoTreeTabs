// ===================
// 树加载、构建与渲染
// ===================
import { state } from './state.js';
import { scheduleFaviconHydrate, applyIconBackground } from './favicon-ui.js';
import { detectFileType, getFileTypeConfig } from './file-types.js';
import { getBookmarkInfo } from './bookmarks.js';
import { selectNodeAndChildren } from './selection.js';
import { closeSelectedOrCurrent } from './tab-actions.js';
import { showContextMenu } from './context-menu.js';

// 由 popup-main.js 注册，避免 tree.js 反向依赖 search.js
let _saveSearchHistory = async (_term) => {};
export function registerSearchHistorySaver(fn) {
  _saveSearchHistory = fn;
}

// 拖拽状态（模块级，跨节点共享）
let _draggedTabId = null;
let _draggedNodeElement = null;
let _currentTabRelations = {};

// ── Gutter patch helpers（关闭节点后局部更新，避免全量刷新闪屏）──────────

// 读取节点 gutter 的 depth / parentLines / isLast
function _readGutterInfo(nodeEl) {
  const cols = Array.from(nodeEl.querySelectorAll('.tree-gutter > .tree-col'));
  if (cols.length <= 1) return { depth: 0, parentLines: [], isLast: false };
  const depth = cols.length - 1; // 去掉 icon-col
  const parentLines = [];
  for (let i = 0; i < depth - 1; i++) {
    parentLines.push(cols[i].classList.contains('has-line'));
  }
  const junction = cols[depth - 1]; // junction 是 icon-col 之前的那个 col
  return { depth, parentLines, isLast: junction.classList.contains('is-last') };
}

// 重建节点的 gutter（depth / parentLines / isLast 发生变化时调用）
function _rebuildGutter(nodeEl, depth, parentLines, isLast) {
  const gutter = nodeEl.querySelector('.tree-gutter');
  if (!gutter) return;
  const iconCol = gutter.querySelector('.tree-icon-col');
  Array.from(gutter.children).forEach(c => {
    if (!c.classList.contains('tree-icon-col')) c.remove();
  });
  gutter.style.setProperty('--depth', String(depth));
  for (let i = 0; i < Math.max(0, depth - 1); i++) {
    const col = document.createElement('div');
    col.className = 'tree-col';
    if (parentLines[i]) col.classList.add('has-line');
    gutter.insertBefore(col, iconCol);
  }
  if (depth > 0) {
    const junction = document.createElement('div');
    junction.className = 'tree-col tree-junction';
    junction.classList.add(isLast ? 'is-last' : 'is-tee');
    gutter.insertBefore(junction, iconCol);
  }
}

// 递归更新子树所有节点的 gutter
function _patchSubtreeGutter(node, depth, parentLines, isLast) {
  const el = document.querySelector(`[data-tab-id="${node.id}"]`);
  if (el) _rebuildGutter(el, depth, parentLines, isLast);
  const childParentLines = [...parentLines];
  if (depth > 0) childParentLines[depth - 1] = !isLast;
  node.children.forEach((child, idx, arr) => {
    _patchSubtreeGutter(child, depth + 1, childParentLines, idx === arr.length - 1);
  });
}

// 关闭节点后，局部 patch 其子节点的 gutter（closed 节点此时已从 DOM 移除）
// 返回 true 表示成功；返回 null 表示需要回退到 loadTabTree()
function _patchChildrenGutterAfterClose(closedNode, parentTabId, closedGutterInfo) {
  if (closedNode.children.length === 0) return true; // 无子节点，无需 patch

  let childDepth, childParentLines;

  if (parentTabId != null) {
    const gpEl = document.querySelector(`[data-tab-id="${parentTabId}"]`);
    if (!gpEl) return null; // 祖父节点不在 DOM 中，回退到全量刷新
    const gpInfo = _readGutterInfo(gpEl);
    childDepth = gpInfo.depth + 1; // 与 closed 节点原深度相同
    // 与 renderNode 处理子节点时计算 newParentLines 的逻辑完全一致
    childParentLines = [...gpInfo.parentLines];
    if (gpInfo.depth > 0) childParentLines[gpInfo.depth - 1] = !gpInfo.isLast;
  } else {
    // 无祖父：子节点提升为根节点
    childDepth = 0;
    childParentLines = [];
  }

  const numChildren = closedNode.children.length;
  closedNode.children.forEach((child, idx) => {
    // 只有 closed 节点原本是最后一个子节点，且当前 child 也是最后一个，才继承 isLast
    const isLastChild = closedGutterInfo.isLast && (idx === numChildren - 1);
    _patchSubtreeGutter(child, childDepth, childParentLines, isLastChild);
  });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────

// 检查 targetId 是否是 ancestorId 的后代（防止循环依赖）
function _isDescendant(targetId, ancestorId) {
  let current = targetId;
  const visited = new Set();
  while (current !== undefined && current !== null) {
    if (visited.has(current)) break; // 防止死循环
    visited.add(current);
    const parent = _currentTabRelations[current];
    if (parent === ancestorId) return true;
    current = parent;
  }
  return false;
}

// 更新导航按钮状态（单次 getHistoryData 调用，避免多次后台通信）
export async function updateNavigationButtons() {
  if (!window.tabHistory) return;
  const backBtn = document.getElementById('backBtn');
  const forwardBtn = document.getElementById('forwardBtn');
  if (!backBtn && !forwardBtn) return;

  const data = await window.tabHistory.getHistoryData();
  if (backBtn) backBtn.disabled = data.currentIndex <= 0;
  if (forwardBtn) forwardBtn.disabled = data.currentIndex >= data.history.length - 1;

  console.log('📚 Navigation status:', {
    history: data.history,
    currentIndex: data.currentIndex,
    canGoBack: data.currentIndex > 0,
    canGoForward: data.currentIndex < data.history.length - 1,
  });
}

// 根据过滤结果更新分隔符可见性
export function updateSeparatorVisibility() {
  const container = document.getElementById('treeContainer');
  if (!container) return;
  const separators = Array.from(container.querySelectorAll('.pinned-separator'));
  const hasAnyGroupHeader = !!container.querySelector('.pinned-separator[data-separator-type="group-header"]');
  separators.forEach(sep => {
    const type = sep.dataset.separatorType || '';
    if (type === 'group-tail' && !hasAnyGroupHeader) {
      sep.style.display = 'none';
      return;
    }
    if (type === 'group-header' || type === 'pinned-header' || type === '' || type === 'window-header') {
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

// 动态按需加载脚本（只加载一次）
export async function loadScriptOnce(src) {
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

// 加载标签页树结构
export async function loadTabTree() {
  console.log('🔄 loading TabTree...');
  try {
    const now = Date.now();
    if (now - state.lastRestoreTime > state.RESTORE_COOLDOWN) {
      state.lastRestoreTime = now;
      try {
        await chrome.runtime.sendMessage({ action: 'restoreRelations' });
      } catch (error) {
        console.log('Could not trigger restore (background script may be inactive)');
      }
    }

    // 轮询获取tabRelations，直到background初始化完成
    let tabRelations = {};
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      try {
        tabRelations = await chrome.runtime.sendMessage({ action: 'getTabRelations' });

        if (tabRelations !== undefined) {
          console.log(`🎯 Background ready after ${attempts + 1} attempts, got ${Object.keys(tabRelations).length} relations`);
          break;
        } else {
          if (attempts === 0) {
            try { await chrome.runtime.sendMessage({ action: 'restoreRelations' }); } catch {}
          }
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

    tabRelations = tabRelations || {};

    if (attempts >= maxAttempts) {
      console.warn('⚠️ Background may not be ready after maximum attempts, proceeding with empty relations');
    }

    _currentTabRelations = tabRelations;
    console.log('🔄 getTabRelations gets:', Object.keys(tabRelations).length);

    // 一次性获取所有置顶标签页数据
    try {
      state.pinnedTabsCache = await chrome.runtime.sendMessage({ action: 'getPinnedTabIdsCache' }) || {};
      console.log('📌 Loaded pinned tabs cache:', Object.keys(state.pinnedTabsCache).length);
    } catch (error) {
      console.log('Could not load pinned tabs cache:', error);
      state.pinnedTabsCache = {};
    }

    // 获取当前所有标签页
    const tabs = await chrome.tabs.query({});

    // 预取分组信息
    state.tabGroupInfo = {};
    const enableGroups = await chrome.runtime.sendMessage({ action: 'isFeatureEnabled', feature: 'showTabGroups' }).catch(() => false);
    if (enableGroups && chrome.tabGroups && typeof chrome.tabGroups.get === 'function') {
      try {
        const groupIds = Array.from(new Set((tabs || []).map(t => t.groupId).filter(id => typeof id === 'number' && id >= 0)));
        for (const gid of groupIds) {
          try {
            const info = await chrome.tabGroups.get(gid);
            state.tabGroupInfo[gid] = info || {};
          } catch (e) {
            state.tabGroupInfo[gid] = {};
          }
        }
      } catch (e) {
        state.tabGroupInfo = {};
      }
    }

    // 构建树结构
    const tree = buildTabTree(tabs, tabRelations);

    // 渲染树
    renderTree(tree);
    // 渲染完成后再补图标（异步，不阻塞）
    scheduleFaviconHydrate();

  } catch (error) {
    console.error('Error loading tab tree:', error);
  }
}

// 构建标签页树结构
export function buildTabTree(tabs, tabRelations) {
  const tabMap = new Map();
  const pinnedTabs = [];
  const normalTabs = [];

  // 如果启用"最近"筛选：
  if (state.selectedFilters && state.selectedFilters.recent) {
    const hasGroupInfo = state.tabGroupInfo && Object.keys(state.tabGroupInfo).length > 0;
    if (!hasGroupInfo) {
      tabs = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
      // 有搜索词时全量搜索（不截断），无搜索词时才截取最近30条
      const hasSearch = !!(state.currentSearchTerm || state.selectedFilters.historyTerm);
      if (!hasSearch) {
        tabs = tabs.slice(0, 30);
      }
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
      const tabNode = tabMap.get(tab.id);
      const isPinned = state.pinnedTabsCache && state.pinnedTabsCache[tab.id];
      if (isPinned) {
        pinnedTabs.push(tabNode);
      } else {
        normalTabs.push(tabNode);
      }
    }
  });

  // 排序逻辑
  if (!state.selectedFilters || !state.selectedFilters.recent) {
    pinnedTabs.sort((a, b) => {
      const aTimestamp = state.pinnedTabsCache[a.id]?.timestamp || 0;
      const bTimestamp = state.pinnedTabsCache[b.id]?.timestamp || 0;
      return bTimestamp - aTimestamp;
    });
    normalTabs.sort((a, b) => {
      if (a.windowId !== b.windowId) return a.windowId - b.windowId;
      return a.index - b.index;
    });
  } else {
    const hasGroupInfo = state.tabGroupInfo && Object.keys(state.tabGroupInfo).length > 0;
    if (hasGroupInfo) {
      normalTabs.sort((a, b) => {
        const aGroup = (typeof a.groupId === 'number' && a.groupId >= 0) ? a.groupId : Number.MAX_SAFE_INTEGER;
        const bGroup = (typeof b.groupId === 'number' && b.groupId >= 0) ? b.groupId : Number.MAX_SAFE_INTEGER;
        if (aGroup !== bGroup) return aGroup - bGroup;
        const aTime = a.lastAccessed || 0;
        const bTime = b.lastAccessed || 0;
        return bTime - aTime;
      });
    } else {
      normalTabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    }
  }

  return [...pinnedTabs, ...normalTabs];
}

// 渲染树结构
export function renderTree(tree) {
  const container = document.getElementById('treeContainer');
  container.innerHTML = '';

  let pinnedTabs = tree.filter(node => state.pinnedTabsCache && state.pinnedTabsCache[node.id]);
  let normalTabs = tree.filter(node => !state.pinnedTabsCache || !state.pinnedTabsCache[node.id]);

  // 置顶标题分隔符
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
  pinnedTabs.forEach((node) => {
    node.groupId = -1;
    renderNode(node, container, 0, [], false);
  });

  // 渲染普通标签页（在组/窗口前插入分隔符与标签）
  const hasGroupInfo = state.tabGroupInfo && Object.keys(state.tabGroupInfo).length > 0;
  const isRecentMode = !!(state.selectedFilters && state.selectedFilters.recent);

  // 构建窗口序号映射（仅在非最近模式、非分组模式、多窗口时展示窗口标识）
  let windowOrderMap = new Map();
  if (!hasGroupInfo && !isRecentMode) {
    let order = 1;
    normalTabs.forEach(node => {
      if (!windowOrderMap.has(node.windowId)) {
        windowOrderMap.set(node.windowId, order++);
      }
    });
    if (windowOrderMap.size <= 1) windowOrderMap = new Map(); // 单窗口不显示
  }

  let prevGroupId = null;
  let prevWindowId = null;
  normalTabs.forEach((node, index, array) => {
    const currGroupId = (typeof node.groupId === 'number') ? node.groupId : -1;
    const currWindowId = node.windowId;
    const currIsGrouped = currGroupId !== -1;

    const windowChanged = index > 0 && currWindowId !== prevWindowId;
    const groupChanged = index === 0 ? false : (windowChanged || currGroupId !== prevGroupId);

    // 窗口分隔符（多窗口 + 非分组 + 非最近模式）
    if (windowOrderMap.size > 0 && (index === 0 || windowChanged)) {
      const winNum = windowOrderMap.get(currWindowId);
      const winSep = document.createElement('div');
      winSep.className = 'pinned-separator';
      winSep.dataset.separatorType = 'window-header';
      winSep.dataset.windowId = String(currWindowId);
      const winLabel = document.createElement('span');
      winLabel.className = 'separator-label';
      winLabel.textContent = `${i18n('window') || 'Window'} ${winNum}`;
      const winLine = document.createElement('div');
      winLine.className = 'separator-line';
      winSep.appendChild(winLabel);
      winSep.appendChild(winLine);
      container.appendChild(winSep);
    }

    // 分组分隔符
    if (hasGroupInfo && currIsGrouped && ((index === 0) || groupChanged)) {
      const header = document.createElement('div');
      header.className = 'pinned-separator';
      header.dataset.separatorType = 'group-header';
      header.dataset.groupId = String(currGroupId);

      const label = document.createElement('span');
      label.className = 'separator-label';
      const title = (state.tabGroupInfo[currGroupId] && state.tabGroupInfo[currGroupId].title) ? state.tabGroupInfo[currGroupId].title : (i18n('tabGroup') || 'Group');
      label.textContent = title;

      const line = document.createElement('div');
      line.className = 'separator-line';

      header.appendChild(label);
      header.appendChild(line);
      container.appendChild(header);
    }

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

  // 渲染完成后更新一次分隔符可见性
  updateSeparatorVisibility();
  // 渲染完成后再异步补图标
  scheduleFaviconHydrate();
}

// 渲染单个节点
export function renderNode(node, container, depth, parentLines = [], isLast = false) {
  const nodeElement = document.createElement('div');
  nodeElement.className = 'tree-node';
  nodeElement.dataset.tabId = node.id;
  nodeElement.dataset.tabUrl = node.url || '';
  nodeElement.dataset.favIconUrl = node.favIconUrl || '';
  nodeElement.dataset.groupId = (typeof node.groupId === 'number' && node.groupId >= 0) ? String(node.groupId) : '-1';

  if (node.id === state.currentTabId) {
    nodeElement.classList.add('current-tab');
  }

  if (node.discarded || node.status === 'unloaded') {
    nodeElement.classList.add('unloaded');
  }

  const isPinned = state.pinnedTabsCache && state.pinnedTabsCache[node.id];
  if (isPinned) {
    nodeElement.classList.add('pinned-tab');
    console.log('📌 Applied pinned styling to tab:', node.id, node.title);
  }

  // 图标
  const icon = document.createElement('div');
  icon.className = 'tree-icon';
  icon.dataset.faviconSource = 'init';
  icon.classList.add('icon-placeholder');

  const fileType = detectFileType(node.url);
  if (fileType) {
    const config = getFileTypeConfig(fileType);
    if (config) {
      const iconUrl = chrome.runtime.getURL(config.icon);
      applyIconBackground(icon, iconUrl, 'filetype', config.bgColor || 'transparent');
      icon.style.backgroundSize = 'contain';
      icon.style.backgroundRepeat = 'no-repeat';
      icon.style.backgroundPosition = 'center';
      icon.style.width = '16px';
      icon.style.height = '16px';
      icon.innerHTML = '';
      icon.title = i18n(config.title);
    }
    icon.dataset.faviconSource = 'filetype';
  } else {
    icon.style.backgroundImage = '';
    icon.style.backgroundColor = '';
    icon.dataset.faviconSource = 'pending';
  }

  // 图形化树形结构 gutter
  const gutter = document.createElement('div');
  gutter.className = 'tree-gutter';
  gutter.style.setProperty('--depth', String(depth));

  for (let i = 0; i < Math.max(0, depth - 1); i++) {
    const col = document.createElement('div');
    col.className = 'tree-col';
    if (i < parentLines.length && parentLines[i]) {
      col.classList.add('has-line');
    }
    gutter.appendChild(col);
  }

  if (depth > 0) {
    const junction = document.createElement('div');
    junction.className = 'tree-col tree-junction';
    junction.classList.add(isLast ? 'is-last' : 'is-tee');
    gutter.appendChild(junction);
  }

  const iconCol = document.createElement('div');
  iconCol.className = 'tree-col tree-icon-col';
  iconCol.appendChild(icon);
  gutter.appendChild(iconCol);

  nodeElement.appendChild(gutter);

  // 标题
  const title = document.createElement('div');
  title.className = 'tree-title';
  title.textContent = node.title || node.url;
  title.title = `${node.title}\n\n${node.url}`;
  nodeElement.appendChild(title);

  // 状态显示容器
  const statusContainer = document.createElement('div');
  statusContainer.className = 'tab-status-container';

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

  // 异步获取书签信息
  const isCurrentTab = node.id === state.currentTabId;
  getBookmarkInfo(node.url, isCurrentTab).then(bookmarkInfo => {
    let tooltipText = `${node.title}`;

    if (bookmarkInfo.isBookmarked && bookmarkInfo.title && bookmarkInfo.title.trim()) {
      title.textContent = bookmarkInfo.title;

      if (node.title === bookmarkInfo.title) {
        tooltipText = `📄 ${i18n('tooltipTitleLabel')}: ${node.title}`;
      } else {
        tooltipText = `📄 ${i18n('tooltipTitleLabel')}: ${node.title}\n📖 ${i18n('tooltipBookmarkLabel')}: ${bookmarkInfo.title}`;
      }
    }

    if (bookmarkInfo.isBookmarked && bookmarkInfo.folderPath) {
      tooltipText += `\n📁 ${i18n('tooltipFolderLabel')}: ${bookmarkInfo.folderPath}`;
    }

    title.title = tooltipText + `\n\n${node.url}`;

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

  // 操作区域容器
  const actionsContainer = document.createElement('div');
  actionsContainer.className = 'tree-actions';

  // 拖拽按钮容器
  const dragBtnContainer = document.createElement('div');
  dragBtnContainer.className = 'drag-btn-container';

  const dragBtn = document.createElement('button');
  dragBtn.className = 'drag-btn';
  dragBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="17" viewBox="0.5 0.5 7 11"><circle cx="2" cy="2" r="1.4" fill="currentColor"/><circle cx="6" cy="2" r="1.4" fill="currentColor"/><circle cx="2" cy="6" r="1.4" fill="currentColor"/><circle cx="6" cy="6" r="1.4" fill="currentColor"/><circle cx="2" cy="10" r="1.4" fill="currentColor"/><circle cx="6" cy="10" r="1.4" fill="currentColor"/></svg>';
  dragBtn.title = i18n('dragToReparent') || 'Drag to set as child';

  const dragOverlay = document.createElement('div');
  dragOverlay.className = 'drag-btn-overlay';
  dragOverlay.draggable = true;

  dragOverlay.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    _draggedTabId = node.id;
    _draggedNodeElement = nodeElement;
    nodeElement.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(node.id));
  });

  dragOverlay.addEventListener('dragend', () => {
    if (_draggedNodeElement) {
      _draggedNodeElement.classList.remove('dragging');
    }
    _draggedTabId = null;
    _draggedNodeElement = null;
    document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
  });

  dragBtnContainer.appendChild(dragBtn);
  dragBtnContainer.appendChild(dragOverlay);

  // 当前节点作为拖拽目标：dragover / dragleave / drop
  nodeElement.addEventListener('dragover', (e) => {
    if (_draggedTabId === null || _draggedTabId === node.id) return;
    if (_isDescendant(node.id, _draggedTabId)) return; // 防止循环
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
    nodeElement.classList.add('drop-target');
  });

  nodeElement.addEventListener('dragleave', (e) => {
    // 只在真正离开当前节点时移除（排除进入子元素的 dragleave）
    if (!nodeElement.contains(e.relatedTarget)) {
      nodeElement.classList.remove('drop-target');
    }
  });

  nodeElement.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    nodeElement.classList.remove('drop-target');

    const childTabId = _draggedTabId;
    if (_draggedNodeElement) {
      _draggedNodeElement.classList.remove('dragging');
    }
    _draggedTabId = null;
    _draggedNodeElement = null;

    if (childTabId === null || childTabId === node.id) return;
    if (_isDescendant(node.id, childTabId)) return;

    try {
      await chrome.runtime.sendMessage({
        action: 'setTabParent',
        childTabId,
        parentTabId: node.id
      });
      await loadTabTree();
    } catch (err) {
      console.error('Error setting tab parent via drag:', err);
    }
  });

  // 选择按钮容器
  const selectBtnContainer = document.createElement('div');
  selectBtnContainer.className = 'select-btn-container';

  const selectBtn = document.createElement('button');
  selectBtn.className = 'select-btn';
  selectBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="15" viewBox="0 0 11 10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="0.5,5 4,9 10.5,1"/></svg>';
  selectBtn.title = i18n('selectNode');

  const selectOverlay = document.createElement('div');
  selectOverlay.className = 'select-btn-overlay';
  selectOverlay.addEventListener('click', (e) => {
    e.stopPropagation();
    selectNodeAndChildren(node, nodeElement);
  });

  selectBtnContainer.appendChild(selectBtn);
  selectBtnContainer.appendChild(selectOverlay);

  // 置顶按钮容器
  const pinBtnContainer = document.createElement('div');
  pinBtnContainer.className = 'pin-btn-container';

  const pinBtn = document.createElement('button');
  pinBtn.className = 'pin-btn';
  const pinIcon = document.createElement('span');
  pinIcon.className = 'pin-icon';

  const isPinnedForButton = state.pinnedTabsCache && state.pinnedTabsCache[node.id];
  if (isPinnedForButton) {
    // 已置顶：实心菱形图钉，表示"点击取消置顶"
    pinIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="1.5 0.5 7 11"><path fill="currentColor" d="M5.5,0.5 L9,4.5 L5.5,8 L2,4.5 Z"/><line x1="5.5" y1="8" x2="5.5" y2="11.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
    pinBtn.title = i18n('unpinFromTop') || 'Unpin from top';
  } else {
    // 未置顶：向上箭头+底线，表示"置顶"
    pinIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="1.5 2 7 8.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><line x1="5.5" y1="9" x2="5.5" y2="3"/><polyline points="2.5,5.5 5.5,2.5 8.5,5.5"/><line x1="2" y1="9.5" x2="9" y2="9.5"/></svg>';
    pinBtn.title = i18n('pinToTop') || 'Pin to top';
  }

  pinBtn.appendChild(pinIcon);

  const pinOverlay = document.createElement('div');
  pinOverlay.className = 'pin-btn-overlay';
  pinOverlay.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const isCurrentlyPinned = state.pinnedTabsCache && state.pinnedTabsCache[node.id];

      if (isCurrentlyPinned) {
        await chrome.runtime.sendMessage({ action: 'removePinnedTab', tabId: node.id });
        delete state.pinnedTabsCache[node.id];
        console.log(`📌 Unpinned tab: ${node.id}`);
      } else {
        await chrome.tabs.move(node.id, { index: 0 });

        try {
          await chrome.runtime.sendMessage({ action: 'removeTabRelationsFor', tabId: node.id });
        } catch (remErr) {
          console.warn('Failed to remove relations for pinned tab:', remErr);
        }

        const tabInfo = {
          url: node.url,
          title: node.title
        };
        await chrome.runtime.sendMessage({
          action: 'addPinnedTab',
          tabId: node.id,
          tabInfo: tabInfo
        });

        state.pinnedTabsCache[node.id] = {
          ...tabInfo,
          timestamp: Date.now()
        };
        console.log(`📌 Pinned tab: ${node.id} - ${node.title}`);
      }

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

  const closeBtn = document.createElement('button');
  closeBtn.className = 'close-btn';
  closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="1.5 1.5 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="1.5" y1="1.5" x2="8.5" y2="8.5"/><line x1="8.5" y1="1.5" x2="1.5" y2="8.5"/></svg>';

  const closeOverlay = document.createElement('div');
  closeOverlay.className = 'close-btn-overlay';
  closeOverlay.addEventListener('click', async (e) => {
    e.stopPropagation();
    const parentTabId = _currentTabRelations[node.id] ?? null;
    // 关闭前读取 gutter 信息（关闭后 DOM 元素已移除）
    const closedEl = document.querySelector(`[data-tab-id="${node.id}"]`);
    const closedGutterInfo = closedEl ? _readGutterInfo(closedEl) : null;
    await closeSelectedOrCurrent(node, parentTabId);
    // 局部 patch 子节点 gutter，避免全量刷新闪屏
    if (closedGutterInfo && node.children.length > 0) {
      const ok = _patchChildrenGutterAfterClose(node, parentTabId, closedGutterInfo);
      if (ok === null) await loadTabTree(); // 回退：祖父节点不在 DOM
    }
  });

  closeOverlay.addEventListener('mouseenter', () => {
    if (state.selectedTabIds.size > 0) {
      closeBtn.title = i18n('closeSelectedTabs', [state.selectedTabIds.size.toString()]);
    } else {
      closeBtn.title = i18n('closeTab') || 'Close tab';
    }
  });

  closeBtnContainer.appendChild(closeBtn);
  closeBtnContainer.appendChild(closeOverlay);

  actionsContainer.appendChild(dragBtnContainer);
  actionsContainer.appendChild(pinBtnContainer);
  actionsContainer.appendChild(selectBtnContainer);
  actionsContainer.appendChild(closeBtnContainer);

  nodeElement.appendChild(actionsContainer);

  // 右键菜单
  nodeElement.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(node.id, node.url || '', e.clientX, e.clientY, node);
  });

  // 点击节点事件
  nodeElement.addEventListener('click', async (e) => {
    e.stopPropagation();
    console.log(`Node clicked: ${node.id} - ${node.title}`);
    try {
      const input = document.getElementById('searchInput');
      const term = (input && input.value ? input.value.trim() : '');
      if (term) {
        await _saveSearchHistory(term);
      }
    } catch (_) {}
    // activateTabAndWindow is imported indirectly via popup-main
    activateTabAndWindowFn(node.id);
  });

  container.appendChild(nodeElement);

  // 递归渲染子节点
  if (node.children && node.children.length > 0) {
    const newParentLines = [...parentLines];
    if (depth > 0) {
      newParentLines[depth - 1] = !isLast;
    }

    node.children.forEach((child, index, array) => {
      renderNode(child, container, depth + 1, newParentLines, index === array.length - 1);
    });
  }
}

// activateTabAndWindow 由 popup-main.js 注入，避免循环依赖
let activateTabAndWindowFn = (_tabId) => {};
export function registerActivateTabFn(fn) {
  activateTabAndWindowFn = fn;
}
