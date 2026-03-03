// ===================
// 右键上下文菜单
// ===================
import { moveTabToNewWindow } from './tab-actions.js';

let _contextTabId = null;
let _contextTabUrl = null;

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

}

export function showContextMenu(tabId, tabUrl, x, y) {
  _contextTabId = tabId;
  _contextTabUrl = tabUrl;

  const menu = document.getElementById('contextMenu');
  if (!menu) return;

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
}

function hideContextMenu() {
  const menu = document.getElementById('contextMenu');
  if (menu) menu.classList.remove('visible');
}
