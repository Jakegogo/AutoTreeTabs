// 构建标签页树结构（包含置顶标签页支持）
function buildTabTreeForExport(tabs, tabRelations, pinnedTabsCache = null) {
  console.log('🏗️ Building tab tree with:', {
    tabsCount: tabs.length,
    relationsCount: Object.keys(tabRelations || {}).length,
    pinnedCount: Object.keys(pinnedTabsCache || {}).length
  });
  
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
  
  console.log('📋 Created tab map with', tabMap.size, 'entries');
  
  // 构建父子关系
  let childCount = 0;
  let rootCount = 0;
  
  tabs.forEach(tab => {
    const parentId = tabRelations[tab.id];
    if (parentId && tabMap.has(parentId)) {
      const parent = tabMap.get(parentId);
      const child = tabMap.get(tab.id);
      parent.children.push(child);
      childCount++;
      console.log(`🔗 Added child: ${tab.title} -> ${parent.title}`);
    } else {
      // 没有父节点的作为根节点
      const tabNode = tabMap.get(tab.id);
      rootCount++;
      
      // 检查是否为置顶标签页
      const isPinned = pinnedTabsCache && pinnedTabsCache[tab.id];
      if (isPinned) {
        pinnedTabs.push(tabNode);
        console.log(`📌 Added pinned root: ${tab.title}`);
      } else {
        normalTabs.push(tabNode);
        console.log(`📄 Added normal root: ${tab.title}`);
      }
    }
  });
  
  console.log(`🔢 Tree statistics: ${childCount} children, ${rootCount} roots (${pinnedTabs.length} pinned, ${normalTabs.length} normal)`);
  
  // 对置顶标签页按照置顶时间排序（最新置顶的在前）
  pinnedTabs.sort((a, b) => {
    const aTimestamp = pinnedTabsCache[a.id]?.timestamp || 0;
    const bTimestamp = pinnedTabsCache[b.id]?.timestamp || 0;
    return bTimestamp - aTimestamp;
  });
  
  // 对普通标签页按照索引排序
  normalTabs.sort((a, b) => a.index - b.index);
  
  // 置顶标签页在前，普通标签页在后
  const result = [...pinnedTabs, ...normalTabs];
  console.log('✅ Final tree structure:', result.length, 'root nodes');
  
  return result;
}

// 获取国际化文本
async function getI18nMessages() {
  const messages = {};
  const keys = [
    'exportPageTitle', 'exportedOn', 'totalTabs', 'pinnedTabs', 'normalTabs',
    'exportInstructions', 'openAllTabsBtn', 'openAllBtn', 'pinnedTabsSection',
    'confirmOpenAllTabs', 'openingProgress', 'openingCompleted'
  ];
  
  for (const key of keys) {
    try {
      messages[key] = chrome.i18n.getMessage(key) || key;
    } catch (error) {
      messages[key] = key;
    }
  }
  
  return messages;
}

// 导出标签页树为HTML文件
async function exportTabTree() {
  try {
    console.log('🚀 Starting export process...');
    
    // 获取国际化文本
    const i18nMessages = await getI18nMessages();
    console.log('🌐 Retrieved i18n messages:', Object.keys(i18nMessages).length);
    
    // 获取所有标签页
    const tabs = await chrome.tabs.query({});
    console.log('📋 Retrieved tabs:', tabs.length);
    
    // 获取当前的标签页关系数据
    let tabRelations = {};
    try {
      tabRelations = await chrome.runtime.sendMessage({ action: 'getTabRelations' });
      console.log('🔗 Retrieved tab relations:', Object.keys(tabRelations || {}).length);
    } catch (error) {
      console.warn('Failed to get tab relations:', error);
      tabRelations = {};
    }
    
    // 获取置顶标签页缓存
    let pinnedTabsCache = {};
    try {
      pinnedTabsCache = await chrome.runtime.sendMessage({ action: 'getPinnedTabIdsCache' });
      console.log('📌 Retrieved pinned tabs cache:', Object.keys(pinnedTabsCache || {}).length);
    } catch (error) {
      console.warn('Failed to get pinned tabs cache:', error);
      pinnedTabsCache = {};
    }
    
    // 构建树形结构（包含置顶标签页）
    const tree = buildTabTreeForExport(tabs, tabRelations, pinnedTabsCache);
    console.log('🌳 Built tree structure:', tree.length, 'root nodes');
    
    // 生成HTML内容
    const html = generateHTML(tree, pinnedTabsCache, i18nMessages);
    console.log('📄 Generated HTML content');
    
    // 下载HTML文件
    downloadHTML(html);
    console.log('⬇️ Download initiated');
    
  } catch (error) {
    console.error('Error exporting tab tree:', error);
  }
}

// 生成HTML内容
function generateHTML(tree, pinnedTabsCache = null, i18nMessages = {}) {
  const timestamp = new Date().toLocaleString();
  
  console.log('📄 Generating HTML for tree:', tree.length, 'nodes');
  
  // 分离置顶标签页和普通标签页用于显示
  const pinnedTabs = tree.filter(node => pinnedTabsCache && pinnedTabsCache[node.id]);
  const normalTabs = tree.filter(node => !pinnedTabsCache || !pinnedTabsCache[node.id]);
  
  console.log('📊 HTML generation split:', {
    totalNodes: tree.length,
    pinnedNodes: pinnedTabs.length,
    normalNodes: normalTabs.length
  });
  
  // 构建统计文本
  const totalText = `${i18nMessages.totalTabs || 'Total:'} ${tree.length} ${tree.length === 1 ? 'tab' : 'tabs'}`;
  const pinnedText = pinnedTabs.length > 0 ? ` (${pinnedTabs.length} ${i18nMessages.pinnedTabs || 'pinned'}, ${normalTabs.length} ${i18nMessages.normalTabs || 'normal'})` : '';
  
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${i18nMessages.exportPageTitle || 'Tab Tree Export'} - ${timestamp}</title>
  <style>
    body {
      margin: 20px;
      font-family: Arial, sans-serif;
      background-color: #f5f5f5;
    }
    
    .header {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    
    .tree-container {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      font-family: 'Courier New', monospace;
      line-height: 24px;
    }
    
    .tree-node {
      display: flex;
      align-items: center;
      padding: 2px 0;
      cursor: pointer;
      border-radius: 3px;
      position: relative;
      min-height: 24px;
    }
    
    .tree-node:hover {
      background-color: #f0f0f0;
    }
    
    .tree-structure {
      font-family: 'Courier New', monospace;
      color: #666;
      white-space: pre;
      margin-right: 6px;
      flex-shrink: 0;
    }
    
    .tree-icon {
      width: 16px;
      height: 16px;
      margin-right: 6px;
      background-size: contain;
      flex-shrink: 0;
      background-repeat: no-repeat;
      background-position: center;
    }
    
    .tree-title {
      flex-grow: 1;
      color: #1976d2;
      text-decoration: none;
      font-family: Arial, sans-serif;
    }
    
    .tree-title:hover {
      text-decoration: underline;
    }
    
    .tab-status {
      margin-left: 6px;
      font-size: 14px;
      color: #666;
    }
    
    .tab-status.playing {
      color: #4CAF50;
    }
    
    .tab-status.muted {
      color: #f44336;
    }
    
    .open-children-btn {
      margin-left: 8px;
      background: #2196f3;
      color: white;
      border: none;
      padding: 2px 6px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
      opacity: 0;
      transition: opacity 0.2s;
    }
    
    .tree-node:hover .open-children-btn {
      opacity: 1;
    }
    
    .open-children-btn:hover {
      background: #1976d2;
    }
    
    .open-all-tabs-btn {
      background: #ff9800;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      font-weight: bold;
    }
    
    .open-all-tabs-btn:hover {
      background: #f57c00;
    }
    
    /* 置顶标签页样式 */
    .tree-node.pinned-tab {
      background-color: rgba(255, 215, 0, 0.1);
      border-left: 3px solid #ffd700;
      padding-left: 5px;
      position: relative;
    }
    
    .tree-node.pinned-tab .tree-title {
      font-weight: 600;
      color: #b8860b;
    }
    
    .tree-node.pinned-tab::before {
      content: '📌';
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 12px;
      opacity: 0.7;
    }
    
    /* 置顶分隔线样式 */
    .pinned-separator {
      margin: 8px 0;
      display: flex;
      align-items: center;
      position: relative;
    }
    
    .separator-line {
      flex: 1;
      height: 1px;
      background: linear-gradient(90deg, transparent, #ffd700, transparent);
      position: relative;
    }
    
    .separator-line::before {
      content: '${i18nMessages.pinnedTabsSection || '📌 Pinned Tabs'}';
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      background: white;
      padding: 0 12px;
      font-size: 11px;
      color: #b8860b;
      font-weight: 600;
      white-space: nowrap;
    }
  </style>
</head>
<body>
  <div class="header">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
      <h1 style="margin: 0;">${i18nMessages.exportPageTitle || 'Tab Tree Export'}</h1>
      <button class="open-all-tabs-btn" onclick="openAllTabs()">${i18nMessages.openAllTabsBtn || 'Open All Tabs'}</button>
    </div>
    <p>${i18nMessages.exportedOn || 'Exported on:'} ${timestamp}</p>
    <p>${totalText}${pinnedText}</p>
    <p>${i18nMessages.exportInstructions || 'Click links to open tabs. For parent nodes with children, click "Open All" to open all child tabs. Use "Open All Tabs" to open every single tab.'}</p>
  </div>
  
  <div class="tree-container">
    ${pinnedTabs.length > 0 ? generateTreeHTML(pinnedTabs, 0, [], pinnedTabsCache, i18nMessages) : ''}
    ${pinnedTabs.length > 0 && normalTabs.length > 0 ? '<div class="pinned-separator"><div class="separator-line"></div></div>' : ''}
    ${normalTabs.length > 0 ? generateTreeHTML(normalTabs, 0, [], pinnedTabsCache, i18nMessages) : ''}
  </div>
  
  <script>
    // 全局变量：存储所有标签页URL和国际化文本
    const allTabUrls = ${JSON.stringify(collectAllUrls(tree))};
    const i18n = ${JSON.stringify(i18nMessages)};
    // 收集所有子节点的URL
    function collectChildUrls(node) {
      const urls = [];
      if (node.url) {
        urls.push(node.url);
      }
      if (node.children) {
        node.children.forEach(child => {
          urls.push(...collectChildUrls(child));
        });
      }
      return urls;
    }
    
    // 打开单个标签页
    function openTab(url) {
      window.open(url, '_blank');
    }
    
    // 打开所有子标签页
    function openAllChildren(urls) {
      urls.forEach(url => {
        if (url) {
          window.open(url, '_blank');
        }
      });
    }
    
    // 打开所有标签页（分批处理，避免浏览器阻塞）
    async function openAllTabs() {
      const confirmMsg = (i18n.confirmOpenAllTabs || 'Are you sure you want to open all {count} tabs? This might open a lot of browser windows.').replace('{count}', allTabUrls.length);
      if (confirm(confirmMsg)) {
        const batchSize = 10;
        const delay = 100; // 100毫秒
        
        // 更新按钮文本显示进度
        const button = document.querySelector('.open-all-tabs-btn');
        const originalText = button.textContent;
        
        try {
          for (let i = 0; i < allTabUrls.length; i += batchSize) {
            const batch = allTabUrls.slice(i, i + batchSize);
            const progress = i + batch.length;
            
            // 更新进度显示
            const progressMsg = (i18n.openingProgress || 'Opening {current}/{total}...').replace('{current}', progress).replace('{total}', allTabUrls.length);
            button.textContent = progressMsg;
            
            // 打开当前批次的标签页
            batch.forEach(url => {
              if (url) {
                window.open(url, '_blank');
              }
            });
            
            // 如果还有更多标签页要打开，等待100毫秒
            if (i + batchSize < allTabUrls.length) {
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
          
          // 完成后恢复按钮文本
          button.textContent = i18n.openingCompleted || 'Completed!';
          setTimeout(() => {
            button.textContent = originalText;
          }, 2000);
          
          console.log('Finished opening all', allTabUrls.length, 'tabs');
          
        } catch (error) {
          console.error('Error opening tabs:', error);
          button.textContent = originalText;
        }
      }
    }
  </script>
</body>
</html>`;
  
  return html;
}

// 收集所有子节点的URL
function collectChildUrls(node) {
  const urls = [];
  if (node.url) {
    urls.push(node.url);
  }
  if (node.children) {
    node.children.forEach(child => {
      urls.push(...collectChildUrls(child));
    });
  }
  return urls;
}

// 收集整个树中所有标签页的URL
function collectAllUrls(tree) {
  const urls = [];
  tree.forEach(node => {
    urls.push(...collectChildUrls(node));
  });
  return urls;
}

// 生成树形HTML结构
function generateTreeHTML(nodes, depth = 0, parentLines = [], pinnedTabsCache = null, i18nMessages = {}) {
  if (depth === 0) {
    console.log('🌳 Generating tree HTML for', nodes.length, 'nodes at root level');
  }
  
  let html = '';
  
  nodes.forEach((node, index) => {
    const isLast = index === nodes.length - 1;
    const currentLines = [...parentLines];
    
    // 构建树形结构字符
    let treeStructure = '';
    for (let i = 0; i < depth; i++) {
      if (i < currentLines.length) {
        treeStructure += currentLines[i] ? '│   ' : '    ';
      }
    }
    
    if (depth > 0) {
      treeStructure += isLast ? '└── ' : '├── ';
    }
    
    // 生成状态图标
    let statusIcon = '';
    if (node.audible && !node.mutedInfo?.muted) {
      statusIcon = '<span class="tab-status playing">♪</span>';
    } else if (node.mutedInfo?.muted) {
      statusIcon = '<span class="tab-status muted">×</span>';
    }
    
    // 收集所有子节点URL（用于"打开所有"功能）
    const hasChildren = node.children && node.children.length > 0;
    let openAllButton = '';
    if (hasChildren) {
      const allUrls = collectChildUrls(node);
      const urlsJson = JSON.stringify(allUrls).replace(/"/g, '&quot;');
      const openAllText = (typeof i18nMessages !== 'undefined' && i18nMessages.openAllBtn) || 'Open All';
      openAllButton = `<button class="open-children-btn" onclick="openAllChildren([${allUrls.map(url => `&quot;${url.replace(/"/g, '&quot;')}&quot;`).join(',')}])">${openAllText}</button>`;
    }
    
    // 转义HTML属性中的特殊字符
    const escapedUrl = (node.url || '').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
    const escapedTitle = (node.title || node.url || 'Untitled').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
    // 检查favIconUrl是否有效且不是chrome协议
    let safeFavIconUrl = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="%23ddd"/></svg>';
    if (node.favIconUrl && 
        !node.favIconUrl.startsWith('chrome-extension://') && 
        !node.favIconUrl.startsWith('chrome://')) {
      safeFavIconUrl = node.favIconUrl;
    }
    const escapedFavIcon = safeFavIconUrl.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
    
    // 检查是否为置顶标签页
    const isPinned = pinnedTabsCache && pinnedTabsCache[node.id];
    const pinnedClass = isPinned ? ' pinned-tab' : '';
    
    html += `
      <div class="tree-node${pinnedClass}">
        <span class="tree-structure">${treeStructure}</span>
        <img class="tree-icon" src="${escapedFavIcon}" onerror="this.style.display=&quot;none&quot;">
        <a class="tree-title" href="#" onclick="openTab(&quot;${escapedUrl}&quot;); return false;">${escapedTitle}</a>
        ${statusIcon}
        ${openAllButton}
      </div>
    `;
    
    // 递归处理子节点
    if (hasChildren) {
      currentLines[depth] = !isLast;
      html += generateTreeHTML(node.children, depth + 1, currentLines, pinnedTabsCache, i18nMessages);
    }
  });
  
  return html;
}

// 下载HTML文件
function downloadHTML(html) {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `tab-tree-export-${timestamp}.html`;
  a.style.display = 'none';
  
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  URL.revokeObjectURL(url);
}
