import { tabSnapshotExecutor } from './instances.js';

// 存储标签页状态，用于在关闭时恢复顺序信息
let tabIndexSnapshot = new Map();

// 标签页关闭方向追踪（简单索引方案）
let tabCloseDirection = {
    lastCloseTabIndex: -1,        // 上一次关闭的标签页索引
    beforeLastCloseTabIndex: -1,  // 上上次关闭的标签页索引
    currentDirection: 'right'     // 当前方向：'left' 或 'right'
};

// 构建标签页树结构（AutoBackTrack 内部使用）
function buildTabTree(tabs, tabRelations) {
  const tabMap = new Map();
  const rootTabs = [];

  tabs.forEach(tab => {
    tabMap.set(tab.id, { ...tab, children: [] });
  });

  tabs.forEach(tab => {
    const parentId = tabRelations[tab.id];
    if (parentId && tabMap.has(parentId)) {
      tabMap.get(parentId).children.push(tabMap.get(tab.id));
    } else {
      rootTabs.push(tabMap.get(tab.id));
    }
  });

  return rootTabs;
}

// 更新标签页位置快照
export async function updateTabSnapshot() {
    try {
        const tabs = await chrome.tabs.query({});
        tabs.forEach(tab => {
            tabIndexSnapshot.set(tab.id, { index: tab.index, windowId: tab.windowId });
        });
    } catch (error) {
        console.error('Error updating tab snapshot:', error);
    }
}

// 删除指定标签页的快照记录
export function deleteTabSnapshot(tabId) {
    tabIndexSnapshot.delete(tabId);
}

// 添加快照更新事件（延迟合并）
export function scheduleSnapshotUpdate() {
    tabSnapshotExecutor.addEvent(updateTabSnapshot, []);
}

// 查找下一个要激活的标签页（智能方向检测 - 基于索引）
export function findNextTabToActivate(closedTabId, tabRelations, allTabs) {
    // 检测关闭方向（基于索引）
    const direction = detectCloseDirectionFromIndex();
    console.log(`🧭 Using direction: ${direction.toUpperCase()} for sibling search`);

    const tabMap = new Map();

    // 创建标签页映射
    allTabs.forEach(tab => {
      tabMap.set(tab.id, tab);
    });

    // 构建树结构
    const tree = buildTabTree(allTabs, tabRelations);

    // 查找被关闭标签页的父节点ID
    const parentId = tabRelations[closedTabId];

    if (parentId && tabMap.has(parentId)) {
      // 找到父节点，查找同级节点
      const siblings = allTabs.filter(tab => tabRelations[tab.id] === parentId);

      // 根据检测到的方向优先查找兄弟节点
      if (direction === 'right') {
        // 优先查找下一个兄弟节点（往右）
        const nextSibling = findNextSibling(closedTabId, siblings);
        if (nextSibling) {
          console.log(`Found next sibling (RIGHT): ${nextSibling.id}`);
          return nextSibling.id;
        }

        // 没有下一个兄弟节点，查找前一个兄弟节点
        const previousSibling = findPreviousSibling(closedTabId, siblings);
        if (previousSibling) {
          console.log(`No next sibling, found previous sibling (fallback): ${previousSibling.id}`);
          return previousSibling.id;
        }
      } else {
        // 优先查找前一个兄弟节点（往左）
        const previousSibling = findPreviousSibling(closedTabId, siblings);
        if (previousSibling) {
          console.log(`Found previous sibling (LEFT): ${previousSibling.id}`);
          return previousSibling.id;
        }

        // 没有前一个兄弟节点，查找下一个兄弟节点
        const nextSibling = findNextSibling(closedTabId, siblings);
        if (nextSibling) {
          console.log(`No previous sibling, found next sibling (fallback): ${nextSibling.id}`);
          return nextSibling.id;
        }
      }

      // 没有找到任何兄弟节点，返回父节点
      console.log(`No siblings found, activating parent: ${parentId}`);
      return parentId;
    } else {
      // 是根节点，查找同级的根节点
      const rootTabs = allTabs.filter(tab => !tabRelations[tab.id]);

      // 根据方向优先查找根节点兄弟
      if (direction === 'right') {
        // 优先查找下一个根兄弟节点
        const nextRoot = findNextSibling(closedTabId, rootTabs);
        if (nextRoot) {
          console.log(`Found next root sibling (RIGHT): ${nextRoot.id}`);
          return nextRoot.id;
        }

        // 没有下一个根兄弟节点，查找前一个根兄弟节点
        const previousRoot = findPreviousSibling(closedTabId, rootTabs);
        if (previousRoot) {
          console.log(`No next root sibling, found previous root sibling (fallback): ${previousRoot.id}`);
          return previousRoot.id;
        }
      } else {
        // 优先查找前一个根兄弟节点
        const previousRoot = findPreviousSibling(closedTabId, rootTabs);
        if (previousRoot) {
          console.log(`Found previous root sibling (LEFT): ${previousRoot.id}`);
          return previousRoot.id;
        }

        // 没有前一个根兄弟节点，查找下一个根兄弟节点
        const nextRoot = findNextSibling(closedTabId, rootTabs);
        if (nextRoot) {
          console.log(`No previous root sibling, found next root sibling (fallback): ${nextRoot.id}`);
          return nextRoot.id;
        }
      }
    }

    return null;
  }


// 为了保持向后兼容，创建包装函数
function findPreviousSibling(targetTabId, siblings) {
    return findSibling(targetTabId, siblings, 'previous');
}

function findNextSibling(targetTabId, siblings) {
    return findSibling(targetTabId, siblings, 'next');
}

// 查找兄弟节点（通用方法）
function findSibling(targetTabId, siblings, direction = 'previous') {
    const directionText = direction === 'previous' ? 'previous' : 'next';
    console.log(`Looking for ${directionText} sibling of tab ${targetTabId}`);

    if (!tabIndexSnapshot.has(targetTabId)) {
        console.log(`No snapshot data for target tab ${targetTabId}`);
        return null;
    }

    const closedTabInfo = tabIndexSnapshot.get(targetTabId);
    console.log(`Closed tab ${targetTabId} was at index ${closedTabInfo.index}`);
    console.log(`Available siblings:`, siblings.map(tab => `${tab.id}(${tab.index})`));

    // 重新构建关闭前的完整位置信息
    const reconstructedSiblings = [];

    siblings.forEach(tab => {
        if (tab.index < closedTabInfo.index) {
            reconstructedSiblings.push({ ...tab, originalIndex: tab.index });
        } else {
            reconstructedSiblings.push({ ...tab, originalIndex: tab.index + 1 });
        }
    });

    reconstructedSiblings.push({
        id: targetTabId,
        originalIndex: closedTabInfo.index,
        title: '(closed)'
    });

    reconstructedSiblings.sort((a, b) => a.originalIndex - b.originalIndex);
    console.log(`Reconstructed order:`, reconstructedSiblings.map(tab => `${tab.id}(${tab.originalIndex})`));

    const targetIndex = reconstructedSiblings.findIndex(tab => tab.id === targetTabId);
    console.log(`Target tab was at position: ${targetIndex}`);

    let siblingIndex;
    if (direction === 'previous') {
        if (targetIndex > 0) {
            siblingIndex = targetIndex - 1;
        }
    } else {
        if (targetIndex < reconstructedSiblings.length - 1) {
            siblingIndex = targetIndex + 1;
        }
    }

    if (siblingIndex !== undefined) {
        const sibling = reconstructedSiblings[siblingIndex];
        const existingSibling = siblings.find(tab => tab.id === sibling.id);
        if (existingSibling) {
            console.log(`Found ${directionText} sibling: ${existingSibling.id} (was at original index: ${sibling.originalIndex})`);
            return existingSibling;
        }
    }

    console.log(`No ${directionText} sibling found`);
    return null;
}

// 更新关闭方向索引
export function updateCloseDirectionIndex(closedTabId) {
    try {
        const snapshotInfo = tabIndexSnapshot.get(closedTabId);
        if (!snapshotInfo) {
            console.log(`⚠️ Cannot find closed tab ${closedTabId} in tabIndexSnapshot`);
            return;
        }

        const currentIndex = snapshotInfo.index;

        tabCloseDirection.beforeLastCloseTabIndex = tabCloseDirection.lastCloseTabIndex;
        tabCloseDirection.lastCloseTabIndex = currentIndex;

        console.log(`📍 Updated close indexes: current=${currentIndex}, last=${tabCloseDirection.beforeLastCloseTabIndex}`);
    } catch (error) {
        console.error('❌ Error updating close direction index:', error);
    }
}

// 基于索引检测标签页关闭方向
export function detectCloseDirectionFromIndex() {
    try {
        if (tabCloseDirection.lastCloseTabIndex === -1 || tabCloseDirection.beforeLastCloseTabIndex === -1) {
            console.log('🔍 No sufficient history, using default direction:', tabCloseDirection.currentDirection);
            return tabCloseDirection.currentDirection;
        }

        const lastIndex = tabCloseDirection.lastCloseTabIndex;
        const beforeLastIndex = tabCloseDirection.beforeLastCloseTabIndex;

        console.log(`🔍 Index comparison: before last=${beforeLastIndex}, last=${lastIndex}`);

        if (lastIndex < beforeLastIndex) {
            tabCloseDirection.currentDirection = 'left';
            console.log('🏃‍⬅️ Direction detected: LEFT (closing tabs from right to left)');
        } else {
            tabCloseDirection.currentDirection = 'right';
            console.log('🏃‍➡️ Direction detected: RIGHT (closing tabs from left to right)');
        }

        return tabCloseDirection.currentDirection;
    } catch (error) {
        console.error('❌ Error detecting close direction from index:', error);
        return tabCloseDirection.currentDirection;
    }
}
