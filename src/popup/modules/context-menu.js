// ===================
// 右键上下文菜单
// ===================
import { moveTabToNewWindow, closeTabAndChildren } from './tab-actions.js';

let _contextTabId = null;
let _contextTabUrl = null;
let _contextNode = null;

export function initContextMenu() {
  const menu = document.getElementById('contextMenu');
  if (!menu) return;

  // 点击菜单外关闭
  document.addEventListener('click', hideContextMenu);

  // 右键点击非节点区域也关闭
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('.tree-node')) hideContextMenu();
  });

  // 树容器滚动时关闭
  document.getElementById('treeContainer')?.addEventListener('scroll', hideContextMenu);

  // Escape 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideContextMenu();
  });

  // 移动到新窗口
  document.getElementById('ctxMoveToWindow')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    hideContextMenu();
    if (_contextTabId != null) await moveTabToNewWindow(_contextTabId);
  });

  // 复制链接
  document.getElementById('ctxCopyLink')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    hideContextMenu();
    if (_contextTabUrl) {
      try { await navigator.clipboard.writeText(_contextTabUrl); } catch {}
    }
  });

  // 该网站只打开一个标签 - 勾选/取消
  document.getElementById('ctxSingleTab')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    hideContextMenu();
    if (!_contextTabUrl) return;
    const checkEl = document.getElementById('ctxSingleTabCheck');
    const isChecked = checkEl?.textContent === '✓';
    if (isChecked) {
      // 取消规则：找到规则 id 并删除
      try {
        const result = await chrome.runtime.sendMessage({ action: 'matchSingleTabRule', url: _contextTabUrl });
        if (result?.matched && result.ruleId) {
          await chrome.runtime.sendMessage({ action: 'removeSingleTabRule', id: result.ruleId });
        }
      } catch {}
    } else {
      // 添加规则：以主机名为默认 pattern
      try {
        const pattern = new URL(_contextTabUrl).host; // host 含非标准端口，如 localhost:3000
        await chrome.runtime.sendMessage({ action: 'addSingleTabRule', pattern });
      } catch {}
    }
  });

  // 关闭节点及所有子节点
  document.getElementById('ctxCloseWithChildren')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    hideContextMenu();
    if (_contextNode != null) await closeTabAndChildren(_contextNode);
  });

}

export function showContextMenu(tabId, tabUrl, x, y, node) {
  _contextTabId = tabId;
  _contextTabUrl = tabUrl;
  _contextNode = node ?? null;

  const menu = document.getElementById('contextMenu');
  if (!menu) return;

  // 重置单标签勾选状态（先清空，异步查询后更新）
  const checkEl = document.getElementById('ctxSingleTabCheck');
  const singleTabItem = document.getElementById('ctxSingleTab');
  if (checkEl) checkEl.textContent = '';

  // 仅对 http/https 页面显示单标签菜单项
  if (singleTabItem) {
    const isHttp = tabUrl && (tabUrl.startsWith('http://') || tabUrl.startsWith('https://'));
    singleTabItem.style.display = isHttp ? '' : 'none';
    const sep = singleTabItem.previousElementSibling;
    if (sep && sep.classList.contains('context-menu-separator')) sep.style.display = isHttp ? '' : 'none';
  }

  // 先临时显示以便测量实际尺寸
  menu.style.left = '0px';
  menu.style.top = '0px';
  menu.classList.add('visible');

  const menuRect = menu.getBoundingClientRect();
  const winW = window.innerWidth;
  const winH = window.innerHeight;

  let left = x;
  let top = y;
  if (left + menuRect.width > winW) left = winW - menuRect.width - 4;
  if (top + menuRect.height > winH) top = winH - menuRect.height - 4;

  menu.style.left = Math.max(0, left) + 'px';
  menu.style.top = Math.max(0, top) + 'px';

  // 异步查询单标签规则状态
  if (tabUrl && (tabUrl.startsWith('http://') || tabUrl.startsWith('https://'))) {
    chrome.runtime.sendMessage({ action: 'matchSingleTabRule', url: tabUrl }).then(result => {
      if (checkEl) checkEl.textContent = result?.matched ? '✓' : '';
    }).catch(() => {});
  }
}

function hideContextMenu() {
  const menu = document.getElementById('contextMenu');
  if (menu) menu.classList.remove('visible');
}
