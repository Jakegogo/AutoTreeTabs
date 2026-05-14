// ===================
// 多选与滚动逻辑
// ===================
import { state } from './state.js';

// 选中节点及其所有子节点
export function selectNodeAndChildren(node, nodeElement) {
  const isSelected = state.selectedTabIds.has(node.id);

  if (isSelected) {
    deselectNodeAndChildren(node);
  } else {
    selectNodeAndChildrenRecursive(node);
  }

  updateSelectionUI();
}

function selectNodeAndChildrenRecursive(node) {
  state.selectedTabIds.add(node.id);
  node.children.forEach(child => {
    selectNodeAndChildrenRecursive(child);
  });
}

function deselectNodeAndChildren(node) {
  state.selectedTabIds.delete(node.id);
  node.children.forEach(child => {
    deselectNodeAndChildren(child);
  });
}

// 更新选中状态的UI显示
export function updateSelectionUI() {
  document.querySelectorAll('.tree-node').forEach(nodeElement => {
    const tabId = parseInt(nodeElement.dataset.tabId);
    if (state.selectedTabIds.has(tabId)) {
      nodeElement.classList.add('selected');
    } else {
      nodeElement.classList.remove('selected');
    }
  });
}

// 滚动到当前标签页
export function scrollToCurrentTab() {
  if (!state.currentTabId) return;

  const currentNode = document.querySelector(`[data-tab-id="${state.currentTabId}"]`);
  if (currentNode) {
    const container = document.getElementById('treeContainer');

    const nodeTop = currentNode.offsetTop - currentNode.parentElement.offsetTop;
    const containerHeight = container.clientHeight;
    const nodeHeight = currentNode.offsetHeight;

    if (nodeTop < container.scrollTop || nodeTop + nodeHeight > container.scrollTop + containerHeight) {
      const targetScrollTop = nodeTop - (containerHeight / 2) + (nodeHeight / 2);
      container.scrollTop = Math.max(0, targetScrollTop);
    }
  }
}
