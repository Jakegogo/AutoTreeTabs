// ===================
// 布局：计算 tree-container 高度
// ===================

export function calculateTreeHeight() {
  const treeContainer = document.getElementById('treeContainer');
  if (!treeContainer) return;

  const bodyHasScrollbar = document.body.scrollHeight > document.body.clientHeight + 10;
  console.log('bodyScrollHeight', document.body.scrollHeight, 'bodyClientHeight', document.body.clientHeight);
  const htmlHasScrollbar = document.documentElement.scrollHeight > document.documentElement.clientHeight + 10;
  console.log('htmlScrollHeight', document.documentElement.scrollHeight, 'htmlClientHeight', document.documentElement.clientHeight);

  if (!bodyHasScrollbar && !htmlHasScrollbar) {
    console.log('📏 No scrollbar detected, skipping height calculation');
    return;
  }

  console.log('📏 Scrollbar detected, calculating optimal height...');

  const popupHeight = window.innerHeight || document.body.offsetHeight || 600;
  let usedHeight = 0;

  const bodyStyle = getComputedStyle(document.body);
  usedHeight += parseInt(bodyStyle.paddingTop) + parseInt(bodyStyle.paddingBottom);

  const header = document.querySelector('.header');
  if (header) {
    usedHeight += header.offsetHeight;
    const headerStyle = getComputedStyle(header);
    usedHeight += parseInt(headerStyle.marginBottom) + parseInt(headerStyle.paddingBottom);
  }

  const searchContainer = document.querySelector('.search-container');
  if (searchContainer) {
    usedHeight += searchContainer.offsetHeight;
    const searchStyle = getComputedStyle(searchContainer);
    usedHeight += parseInt(searchStyle.marginBottom);
  }

  const availableHeight = popupHeight - usedHeight - 30 - 24;
  const finalHeight = Math.max(200, Math.min(500, availableHeight));

  treeContainer.style.maxHeight = `${finalHeight}px`;

  console.log('📐 Height calculation:', {
    popupHeight,
    usedHeight,
    availableHeight,
    finalHeight: finalHeight + 'px'
  });
}
