// 共享可变状态
export const state = {
  // 多选
  selectedTabIds: new Set(),
  currentTabId: null,

  // 树加载控制
  lastRestoreTime: 0,
  RESTORE_COOLDOWN: 3000,

  // 缓存
  pinnedTabsCache: {},
  tabGroupInfo: {},
  bookmarkCache: new Map(),
  bookmarkedUrlsSet: null,

  // 过滤器与搜索
  selectedFilters: { bookmarked: false, recent: false, historyTerm: null, lastRecent: false },
  searchHistory: [],
  suppressAutoSearchOnce: false,
  isRefreshingByRecent: false,
  currentSearchTerm: '',

  // favicon
  __faviconHydrateScheduled: false,
};
