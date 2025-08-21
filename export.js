// 构建标签页树结构
function buildTabTree(tabs, tabRelations) {
  const tabMap = new Map();
  const rootTabs = [];
  
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
      rootTabs.push(tabMap.get(tab.id));
    }
  });
  
  return rootTabs;
}

// 导出标签页树为HTML文件
async function exportTabTree() {
  try {
    // 获取当前的树形数据
    const result = await chrome.storage.local.get(['tabRelations']);
    const tabRelations = result.tabRelations || {};
    
    // 获取所有标签页
    const tabs = await chrome.tabs.query({});
    
    // 构建树形结构
    const tree = buildTabTree(tabs, tabRelations);
    
    // 生成HTML内容
    const html = generateHTML(tree);
    
    // 下载HTML文件
    downloadHTML(html);
    
  } catch (error) {
    console.error('Error exporting tab tree:', error);
  }
}

// 生成HTML内容
function generateHTML(tree) {
  const timestamp = new Date().toLocaleString();
  
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Tab Tree Export - ${timestamp}</title>
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
  </style>
</head>
<body>
  <div class="header">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
      <h1 style="margin: 0;">Tab Tree Export</h1>
      <button class="open-all-tabs-btn" onclick="openAllTabs()">Open All Tabs</button>
    </div>
    <p>Exported on: ${timestamp}</p>
    <p>Click links to open tabs. For parent nodes with children, click "Open All" to open all child tabs. Use "Open All Tabs" to open every single tab.</p>
  </div>
  
  <div class="tree-container">
    ${generateTreeHTML(tree)}
  </div>
  
  <script>
    // 全局变量：存储所有标签页URL
    const allTabUrls = ${JSON.stringify(collectAllUrls(tree))};
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
      if (confirm('Are you sure you want to open all ' + allTabUrls.length + ' tabs? This might open a lot of browser windows.')) {
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
            button.textContent = 'Opening ' + progress + '/' + allTabUrls.length + '...';
            
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
          button.textContent = 'Completed!';
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
function generateTreeHTML(nodes, depth = 0, parentLines = []) {
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
      openAllButton = `<button class="open-children-btn" onclick="openAllChildren([${allUrls.map(url => `&quot;${url.replace(/"/g, '&quot;')}&quot;`).join(',')}])">Open All</button>`;
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
    
    html += `
      <div class="tree-node">
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
      html += generateTreeHTML(node.children, depth + 1, currentLines);
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
