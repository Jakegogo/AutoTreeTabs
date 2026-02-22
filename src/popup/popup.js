(() => {
  // src/popup/modules/state.js
  var state = {
    // 多选
    selectedTabIds: /* @__PURE__ */ new Set(),
    currentTabId: null,
    // 树加载控制
    lastRestoreTime: 0,
    RESTORE_COOLDOWN: 3e3,
    // 缓存
    pinnedTabsCache: {},
    tabGroupInfo: {},
    bookmarkCache: /* @__PURE__ */ new Map(),
    bookmarkedUrlsSet: null,
    // 过滤器与搜索
    selectedFilters: { bookmarked: false, recent: false, historyTerm: null, lastRecent: false },
    searchHistory: [],
    suppressAutoSearchOnce: false,
    isRefreshingByRecent: false,
    currentSearchTerm: "",
    // favicon
    __faviconHydrateScheduled: false
  };

  // src/popup/modules/layout.js
  function calculateTreeHeight() {
    const treeContainer = document.getElementById("treeContainer");
    if (!treeContainer) return;
    const bodyHasScrollbar = document.body.scrollHeight > document.body.clientHeight + 10;
    console.log("bodyScrollHeight", document.body.scrollHeight, "bodyClientHeight", document.body.clientHeight);
    const htmlHasScrollbar = document.documentElement.scrollHeight > document.documentElement.clientHeight + 10;
    console.log("htmlScrollHeight", document.documentElement.scrollHeight, "htmlClientHeight", document.documentElement.clientHeight);
    if (!bodyHasScrollbar && !htmlHasScrollbar) {
      console.log("\u{1F4CF} No scrollbar detected, skipping height calculation");
      return;
    }
    console.log("\u{1F4CF} Scrollbar detected, calculating optimal height...");
    const popupHeight = window.innerHeight || document.body.offsetHeight || 600;
    let usedHeight = 0;
    const bodyStyle = getComputedStyle(document.body);
    usedHeight += parseInt(bodyStyle.paddingTop) + parseInt(bodyStyle.paddingBottom);
    const header = document.querySelector(".header");
    if (header) {
      usedHeight += header.offsetHeight;
      const headerStyle = getComputedStyle(header);
      usedHeight += parseInt(headerStyle.marginBottom) + parseInt(headerStyle.paddingBottom);
    }
    const searchContainer = document.querySelector(".search-container");
    if (searchContainer) {
      usedHeight += searchContainer.offsetHeight;
      const searchStyle = getComputedStyle(searchContainer);
      usedHeight += parseInt(searchStyle.marginBottom);
    }
    const availableHeight = popupHeight - usedHeight - 30 - 24;
    const finalHeight = Math.max(200, Math.min(500, availableHeight));
    treeContainer.style.maxHeight = `${finalHeight}px`;
    console.log("\u{1F4D0} Height calculation:", {
      popupHeight,
      usedHeight,
      availableHeight,
      finalHeight: finalHeight + "px"
    });
  }

  // src/popup/modules/favicon-ui.js
  function isValidFaviconUrl(url) {
    if (!url || typeof url !== "string") {
      return false;
    }
    if (url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("moz-extension://") || url.startsWith("safari-extension://")) {
      return false;
    }
    if (url.startsWith("https://") || url.startsWith("http://") || url.startsWith("data:") || url.startsWith("blob:")) {
      return true;
    }
    return false;
  }
  function setIconPlaceholder(iconEl, enabled) {
    if (!iconEl) return;
    if (enabled) {
      iconEl.classList.add("icon-placeholder");
      iconEl.style.backgroundColor = "";
    } else {
      iconEl.classList.remove("icon-placeholder");
    }
  }
  function applyIconBackground(iconEl, url, source, bgColor = "transparent") {
    if (!iconEl) return;
    if (source) iconEl.dataset.faviconSource = source;
    if (!url || !isValidFaviconUrl(url)) {
      setIconPlaceholder(iconEl, true);
      iconEl.style.backgroundImage = "";
      return;
    }
    setIconPlaceholder(iconEl, true);
    const img = new Image();
    img.onload = () => {
      if (!iconEl.isConnected) return;
      iconEl.style.backgroundImage = `url("${url}")`;
      iconEl.style.backgroundColor = bgColor || "transparent";
      setIconPlaceholder(iconEl, false);
    };
    img.onerror = () => {
      if (!iconEl.isConnected) return;
      iconEl.style.backgroundImage = "";
      setIconPlaceholder(iconEl, true);
    };
    img.src = url;
  }
  async function hydrateIconsAfterFaviconCacheLoaded() {
    const cache = window.FaviconCacheV1;
    if (!cache) return;
    await cache.ensureLoaded();
    const nodes = document.querySelectorAll(".tree-node");
    for (const nodeEl of nodes) {
      const iconEl = nodeEl.querySelector(".tree-icon");
      if (!iconEl) continue;
      if (iconEl.dataset.faviconSource === "filetype") continue;
      const tabUrl = nodeEl.dataset.tabUrl || "";
      const favIconUrl = nodeEl.dataset.favIconUrl || "";
      const entry = await cache.getCachedEntryForPageUrl(tabUrl);
      const hasFreshData = entry && !entry.negative && entry.dataUrl && entry.dataUrl.startsWith("data:") && Date.now() - (entry.ts || 0) <= cache.TTL_MS;
      if (hasFreshData && isValidFaviconUrl(entry.dataUrl)) {
        applyIconBackground(iconEl, entry.dataUrl, "storage_data");
        continue;
      }
      if (favIconUrl && isValidFaviconUrl(favIconUrl)) {
        applyIconBackground(iconEl, favIconUrl, "favIconUrl");
      } else {
        iconEl.dataset.faviconSource = iconEl.dataset.faviconSource || "placeholder";
        iconEl.classList.add("icon-placeholder");
      }
      iconEl.dataset.faviconSource = iconEl.dataset.faviconSource || "requested";
      const result = await cache.getFaviconDataUrl(tabUrl, favIconUrl || null);
      iconEl.dataset.faviconSource = result?.source || "unknown";
      if (result?.dataUrl && isValidFaviconUrl(result.dataUrl) && iconEl.isConnected) {
        applyIconBackground(iconEl, result.dataUrl, result.source || "unknown");
      }
    }
  }
  function scheduleFaviconHydrate() {
    if (state.__faviconHydrateScheduled) return;
    state.__faviconHydrateScheduled = true;
    setTimeout(async () => {
      state.__faviconHydrateScheduled = false;
      try {
        await hydrateIconsAfterFaviconCacheLoaded();
      } catch (e) {
        console.warn("Favicon hydrate failed:", e);
      }
    }, 0);
  }

  // src/popup/modules/file-types.js
  var FILE_TYPE_CONFIG = {
    pdf: {
      extensions: [".pdf"],
      protocols: ["file://", "chrome-extension://"],
      icon: "assets/icon-pdf.svg",
      title: "pdfFile",
      bgColor: "transparent"
    },
    html: {
      extensions: [".html", ".htm"],
      protocols: ["file://", "chrome-extension://"],
      icon: "assets/icon-html.svg",
      title: "htmlFile",
      bgColor: "transparent"
    },
    png: {
      extensions: [".png"],
      protocols: ["file://", "chrome-extension://"],
      icon: "assets/icon-png.svg",
      title: "imageFile",
      bgColor: "transparent"
    },
    jpg: {
      extensions: [".jpg", ".jpeg"],
      protocols: ["file://", "chrome-extension://"],
      icon: "assets/icon-jpg.svg",
      title: "imageFile",
      bgColor: "transparent"
    },
    svg: {
      extensions: [".svg"],
      protocols: ["file://", "chrome-extension://"],
      icon: "assets/icon-svg.svg",
      title: "imageFile",
      bgColor: "transparent"
    },
    markdown: {
      extensions: [".md", ".markdown"],
      protocols: ["file://", "chrome-extension://"],
      icon: "assets/icon-md.svg",
      title: "markdownFile",
      bgColor: "transparent"
    }
  };
  function detectFileType(url) {
    if (!url || typeof url !== "string") {
      return null;
    }
    let decodedUrl = url;
    try {
      decodedUrl = decodeURIComponent(url);
    } catch {
      decodedUrl = url;
    }
    const lowerUrl = decodedUrl.toLowerCase();
    for (const [fileType, config] of Object.entries(FILE_TYPE_CONFIG)) {
      const hasMatchingProtocol = config.protocols.some(
        (protocol) => lowerUrl.includes(protocol.toLowerCase())
      );
      const hasMatchingExtension = config.extensions.some(
        (ext) => lowerUrl.includes(ext.toLowerCase())
      );
      if (hasMatchingProtocol && hasMatchingExtension) {
        return fileType;
      }
    }
    return null;
  }
  function getFileTypeConfig(fileType) {
    return FILE_TYPE_CONFIG[fileType] || null;
  }
  function isPdfUrl(url) {
    return detectFileType(url) === "pdf";
  }

  // src/popup/modules/bookmarks.js
  async function getAllBookmarkedUrlSet() {
    if (state.bookmarkedUrlsSet) return state.bookmarkedUrlsSet;
    try {
      const tree = await chrome.bookmarks.getTree();
      const set = /* @__PURE__ */ new Set();
      const stack = [...tree];
      while (stack.length) {
        const node = stack.pop();
        if (!node) continue;
        if (node.url) {
          try {
            const u = new URL(node.url);
            u.hash = "";
            set.add(u.href);
          } catch {
            set.add((node.url || "").split("#")[0]);
          }
        }
        if (node.children) stack.push(...node.children);
      }
      state.bookmarkedUrlsSet = set;
      return set;
    } catch (e) {
      state.bookmarkedUrlsSet = /* @__PURE__ */ new Set();
      return state.bookmarkedUrlsSet;
    }
  }
  async function getBookmarkFolderPath(parentId) {
    if (!parentId) return null;
    try {
      const folders = await chrome.bookmarks.get(parentId);
      if (!folders || folders.length === 0) return null;
      const folder = folders[0];
      if (!folder.title || !folder.parentId) {
        return null;
      }
      return folder.title;
    } catch (error) {
      console.log("Error getting bookmark folder path:", error.message);
      return null;
    }
  }
  async function getBookmarkInfo(url, isCurrentTab = false) {
    if (!url) return { isBookmarked: false, title: null, folderPath: null };
    if (isCurrentTab) {
      try {
        const bookmarks = await chrome.bookmarks.search({ url });
        const isBookmarked = bookmarks && bookmarks.length > 0;
        let bookmarkTitle = null;
        let folderPath = null;
        if (isBookmarked) {
          const bookmark = bookmarks[0];
          bookmarkTitle = bookmark.title;
          folderPath = await getBookmarkFolderPath(bookmark.parentId);
        }
        const bookmarkInfo = { isBookmarked, title: bookmarkTitle, folderPath };
        state.bookmarkCache.set(url, bookmarkInfo);
        return bookmarkInfo;
      } catch (error) {
        console.log("Error searching bookmarks:", error.message);
        return { isBookmarked: false, title: null, folderPath: null };
      }
    }
    if (state.bookmarkCache.has(url)) {
      const cachedInfo = state.bookmarkCache.get(url);
      if (typeof cachedInfo === "boolean") {
        return { isBookmarked: cachedInfo, title: null, folderPath: null };
      } else {
        return {
          isBookmarked: cachedInfo.isBookmarked || false,
          title: cachedInfo.title || null,
          folderPath: cachedInfo.folderPath || null
        };
      }
    }
    try {
      const bookmarks = await chrome.bookmarks.search({ url });
      const isBookmarked = bookmarks && bookmarks.length > 0;
      let bookmarkTitle = null;
      let folderPath = null;
      if (isBookmarked) {
        const bookmark = bookmarks[0];
        bookmarkTitle = bookmark.title;
        folderPath = await getBookmarkFolderPath(bookmark.parentId);
      }
      const bookmarkInfo = { isBookmarked, title: bookmarkTitle, folderPath };
      state.bookmarkCache.set(url, bookmarkInfo);
      return bookmarkInfo;
    } catch (error) {
      console.log("Error searching bookmarks:", error.message);
      const errorInfo = { isBookmarked: false, title: null, folderPath: null };
      state.bookmarkCache.set(url, errorInfo);
      return errorInfo;
    }
  }

  // src/popup/modules/selection.js
  function selectNodeAndChildren(node, nodeElement) {
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
    node.children.forEach((child) => {
      selectNodeAndChildrenRecursive(child);
    });
  }
  function deselectNodeAndChildren(node) {
    state.selectedTabIds.delete(node.id);
    node.children.forEach((child) => {
      deselectNodeAndChildren(child);
    });
  }
  function updateSelectionUI() {
    document.querySelectorAll(".tree-node").forEach((nodeElement) => {
      const tabId = parseInt(nodeElement.dataset.tabId);
      if (state.selectedTabIds.has(tabId)) {
        nodeElement.classList.add("selected");
      } else {
        nodeElement.classList.remove("selected");
      }
    });
  }
  function scrollToCurrentTab() {
    if (!state.currentTabId) return;
    const currentNode = document.querySelector(`[data-tab-id="${state.currentTabId}"]`);
    if (currentNode) {
      const container = document.getElementById("treeContainer");
      const nodeTop = currentNode.offsetTop - currentNode.parentElement.offsetTop;
      const containerHeight = container.clientHeight;
      const nodeHeight = currentNode.offsetHeight;
      if (nodeTop < container.scrollTop || nodeTop + nodeHeight > container.scrollTop + containerHeight) {
        const targetScrollTop = nodeTop - containerHeight / 2 + nodeHeight / 2;
        container.scrollTop = Math.max(0, targetScrollTop);
      }
    }
  }

  // src/popup/modules/tab-actions.js
  function activateTabAndWindow(tabId) {
    console.log(`Attempting to activate tab ${tabId}`);
    chrome.tabs.update(tabId, { active: true }, () => {
      if (chrome.runtime.lastError) {
        console.error("Error activating tab:", chrome.runtime.lastError);
        return;
      }
      console.log(`Tab ${tabId} activated`);
      chrome.tabs.get(tabId, (targetTab) => {
        if (chrome.runtime.lastError) {
          console.error("Error getting target tab:", chrome.runtime.lastError);
          window.close();
          return;
        }
        chrome.tabs.query({ active: true, currentWindow: true }, (currentTabs) => {
          if (chrome.runtime.lastError || !currentTabs[0]) {
            console.log("Could not get current window info, activating target window");
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
                console.error("Error focusing window:", chrome.runtime.lastError);
              } else {
                console.log(`Window ${targetTab.windowId} focused`);
              }
              window.close();
            });
          } else {
            console.log("Same window, no need to switch");
            window.close();
          }
        });
      });
    });
  }
  async function removeTabElements(tabIds) {
    tabIds.forEach((tabId) => {
      const element = document.querySelector(`[data-tab-id="${tabId}"]`);
      if (element) {
        element.remove();
      }
    });
    if (window.tabHistory) {
      await window.tabHistory.removeTabsFromHistory(tabIds);
    }
  }
  async function closeSelectedOrCurrent(node) {
    let tabsToClose = [];
    if (state.selectedTabIds.size > 0) {
      tabsToClose = Array.from(state.selectedTabIds);
      state.selectedTabIds.clear();
    } else {
      let collectTabIds = function(node2) {
        tabsToClose.push(node2.id);
        node2.children.forEach((child) => {
          collectTabIds(child);
        });
      };
      collectTabIds(node);
    }
    try {
      await chrome.runtime.sendMessage({
        action: "markPluginClosed",
        tabIds: tabsToClose
      });
    } catch (error) {
      console.error("Error notifying plugin close:", error);
    }
    try {
      await chrome.tabs.remove(tabsToClose);
      await removeTabElements(tabsToClose);
    } catch (error) {
      console.warn("Error closing tabs:", error);
    }
  }

  // src/popup/modules/tree.js
  var _saveSearchHistory = async (_term) => {
  };
  function registerSearchHistorySaver(fn) {
    _saveSearchHistory = fn;
  }
  async function updateNavigationButtons() {
    if (!window.tabHistory) return;
    const backBtn = document.getElementById("backBtn");
    const forwardBtn = document.getElementById("forwardBtn");
    if (!backBtn && !forwardBtn) return;
    const data = await window.tabHistory.getHistoryData();
    if (backBtn) backBtn.disabled = data.currentIndex <= 0;
    if (forwardBtn) forwardBtn.disabled = data.currentIndex >= data.history.length - 1;
    console.log("\u{1F4DA} Navigation status:", {
      history: data.history,
      currentIndex: data.currentIndex,
      canGoBack: data.currentIndex > 0,
      canGoForward: data.currentIndex < data.history.length - 1
    });
  }
  function updateSeparatorVisibility() {
    const container = document.getElementById("treeContainer");
    if (!container) return;
    const separators = Array.from(container.querySelectorAll(".pinned-separator"));
    const hasAnyGroupHeader = !!container.querySelector('.pinned-separator[data-separator-type="group-header"]');
    separators.forEach((sep) => {
      const type = sep.dataset.separatorType || "";
      if (type === "group-tail" && !hasAnyGroupHeader) {
        sep.style.display = "none";
        return;
      }
      if (type === "group-header" || type === "pinned-header" || type === "") {
        const headerGroupId = sep.dataset.groupId || null;
        let sibling = sep.nextElementSibling;
        let hasVisible = false;
        while (sibling) {
          if (sibling.classList && sibling.classList.contains("pinned-separator")) break;
          if (sibling.classList && sibling.classList.contains("tree-node") && !sibling.classList.contains("hidden")) {
            if (type === "group-header") {
              const nodeGroupId = sibling.dataset && sibling.dataset.groupId;
              if (nodeGroupId === headerGroupId) {
                hasVisible = true;
                break;
              }
            } else {
              hasVisible = true;
              break;
            }
          }
          sibling = sibling.nextElementSibling;
        }
        sep.style.display = hasVisible ? "flex" : "none";
      } else if (type === "group-tail") {
        const tailGroupId = sep.dataset.groupId || null;
        let sibling = sep.previousElementSibling;
        let hasVisible = false;
        while (sibling) {
          if (sibling.classList && sibling.classList.contains("pinned-separator")) break;
          if (sibling.classList && sibling.classList.contains("tree-node") && !sibling.classList.contains("hidden")) {
            const nodeGroupId = sibling.dataset && sibling.dataset.groupId;
            if (nodeGroupId === tailGroupId) {
              hasVisible = true;
              break;
            }
          }
          sibling = sibling.previousElementSibling;
        }
        sep.style.display = hasVisible ? "flex" : "none";
      }
    });
  }
  async function loadTabTree() {
    console.log("\u{1F504} loading TabTree...");
    try {
      const now = Date.now();
      if (now - state.lastRestoreTime > state.RESTORE_COOLDOWN) {
        state.lastRestoreTime = now;
        try {
          await chrome.runtime.sendMessage({ action: "restoreRelations" });
        } catch (error) {
          console.log("Could not trigger restore (background script may be inactive)");
        }
      }
      let tabRelations = {};
      let attempts = 0;
      const maxAttempts = 10;
      while (attempts < maxAttempts) {
        try {
          tabRelations = await chrome.runtime.sendMessage({ action: "getTabRelations" });
          if (tabRelations !== void 0) {
            console.log(`\u{1F3AF} Background ready after ${attempts + 1} attempts, got ${Object.keys(tabRelations).length} relations`);
            break;
          } else {
            if (attempts === 0) {
              try {
                await chrome.runtime.sendMessage({ action: "restoreRelations" });
              } catch {
              }
            }
            attempts++;
            if (attempts < maxAttempts) {
              console.log(`\u23F3 Background not ready yet, attempt ${attempts}/${maxAttempts}, retrying in 100ms...`);
              await new Promise((resolve) => setTimeout(resolve, 200));
            }
          }
        } catch (error) {
          attempts++;
          console.log(`\u274C Error getting tab relations, attempt ${attempts}/${maxAttempts}:`, error);
          if (attempts < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }
      }
      tabRelations = tabRelations || {};
      if (attempts >= maxAttempts) {
        console.warn("\u26A0\uFE0F Background may not be ready after maximum attempts, proceeding with empty relations");
      }
      console.log("\u{1F504} getTabRelations gets:", Object.keys(tabRelations).length);
      try {
        state.pinnedTabsCache = await chrome.runtime.sendMessage({ action: "getPinnedTabIdsCache" }) || {};
        console.log("\u{1F4CC} Loaded pinned tabs cache:", Object.keys(state.pinnedTabsCache).length);
      } catch (error) {
        console.log("Could not load pinned tabs cache:", error);
        state.pinnedTabsCache = {};
      }
      const tabs = await chrome.tabs.query({});
      state.tabGroupInfo = {};
      const enableGroups = await chrome.runtime.sendMessage({ action: "isFeatureEnabled", feature: "showTabGroups" }).catch(() => false);
      if (enableGroups && chrome.tabGroups && typeof chrome.tabGroups.get === "function") {
        try {
          const groupIds = Array.from(new Set((tabs || []).map((t) => t.groupId).filter((id) => typeof id === "number" && id >= 0)));
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
      const tree = buildTabTree(tabs, tabRelations);
      renderTree(tree);
      scheduleFaviconHydrate();
    } catch (error) {
      console.error("Error loading tab tree:", error);
    }
  }
  function buildTabTree(tabs, tabRelations) {
    const tabMap = /* @__PURE__ */ new Map();
    const pinnedTabs = [];
    const normalTabs = [];
    if (state.selectedFilters && state.selectedFilters.recent) {
      const hasGroupInfo = state.tabGroupInfo && Object.keys(state.tabGroupInfo).length > 0;
      if (!hasGroupInfo) {
        tabs = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
        const hasSearch = !!(state.currentSearchTerm || state.selectedFilters.historyTerm);
        if (!hasSearch) {
          tabs = tabs.slice(0, 30);
        }
      }
    }
    tabs.forEach((tab) => {
      tabMap.set(tab.id, {
        ...tab,
        children: []
      });
    });
    tabs.forEach((tab) => {
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
          const aGroup = typeof a.groupId === "number" && a.groupId >= 0 ? a.groupId : Number.MAX_SAFE_INTEGER;
          const bGroup = typeof b.groupId === "number" && b.groupId >= 0 ? b.groupId : Number.MAX_SAFE_INTEGER;
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
  function renderTree(tree) {
    const container = document.getElementById("treeContainer");
    container.innerHTML = "";
    let pinnedTabs = tree.filter((node) => state.pinnedTabsCache && state.pinnedTabsCache[node.id]);
    let normalTabs = tree.filter((node) => !state.pinnedTabsCache || !state.pinnedTabsCache[node.id]);
    if (pinnedTabs.length > 0) {
      const header = document.createElement("div");
      header.className = "pinned-separator";
      header.dataset.separatorType = "pinned-header";
      const label = document.createElement("span");
      label.className = "separator-label";
      label.textContent = i18n("pinnedTabs") || "\u{1F4CC}";
      const line = document.createElement("div");
      line.className = "separator-line";
      header.appendChild(label);
      header.appendChild(line);
      container.appendChild(header);
    }
    pinnedTabs.forEach((node) => {
      node.groupId = -1;
      renderNode(node, container, 0, [], false);
    });
    const hasGroupInfo = state.tabGroupInfo && Object.keys(state.tabGroupInfo).length > 0;
    let prevGroupId = null;
    let prevWindowId = null;
    normalTabs.forEach((node, index, array) => {
      const currGroupId = typeof node.groupId === "number" ? node.groupId : -1;
      const currWindowId = node.windowId;
      const currIsGrouped = currGroupId !== -1;
      const windowChanged = index > 0 && currWindowId !== prevWindowId;
      const groupChanged = index === 0 ? false : windowChanged || currGroupId !== prevGroupId;
      if (hasGroupInfo && currIsGrouped && (index === 0 || groupChanged)) {
        const header = document.createElement("div");
        header.className = "pinned-separator";
        header.dataset.separatorType = "group-header";
        header.dataset.groupId = String(currGroupId);
        const label = document.createElement("span");
        label.className = "separator-label";
        const title = state.tabGroupInfo[currGroupId] && state.tabGroupInfo[currGroupId].title ? state.tabGroupInfo[currGroupId].title : i18n("tabGroup") || "Group";
        label.textContent = title;
        const line = document.createElement("div");
        line.className = "separator-line";
        header.appendChild(label);
        header.appendChild(line);
        container.appendChild(header);
      }
      renderNode(node, container, 0, [], index === array.length - 1);
      prevGroupId = currGroupId;
      prevWindowId = currWindowId;
    });
    if (hasGroupInfo && normalTabs.length > 0) {
      const lastNode = normalTabs[normalTabs.length - 1];
      const lastGroupId = typeof lastNode.groupId === "number" ? lastNode.groupId : -1;
      if (lastGroupId !== -1) {
        const tail = document.createElement("div");
        tail.className = "pinned-separator";
        tail.dataset.separatorType = "group-tail";
        tail.dataset.groupId = String(lastGroupId);
        const tailLine = document.createElement("div");
        tailLine.className = "separator-line";
        tail.appendChild(tailLine);
        container.appendChild(tail);
      }
    }
    updateSeparatorVisibility();
    scheduleFaviconHydrate();
  }
  function renderNode(node, container, depth, parentLines = [], isLast = false) {
    const nodeElement = document.createElement("div");
    nodeElement.className = "tree-node";
    nodeElement.dataset.tabId = node.id;
    nodeElement.dataset.tabUrl = node.url || "";
    nodeElement.dataset.favIconUrl = node.favIconUrl || "";
    nodeElement.dataset.groupId = typeof node.groupId === "number" && node.groupId >= 0 ? String(node.groupId) : "-1";
    if (node.id === state.currentTabId) {
      nodeElement.classList.add("current-tab");
    }
    if (node.discarded || node.status === "unloaded") {
      nodeElement.classList.add("unloaded");
    }
    const isPinned = state.pinnedTabsCache && state.pinnedTabsCache[node.id];
    if (isPinned) {
      nodeElement.classList.add("pinned-tab");
      console.log("\u{1F4CC} Applied pinned styling to tab:", node.id, node.title);
    }
    const icon = document.createElement("div");
    icon.className = "tree-icon";
    icon.dataset.faviconSource = "init";
    icon.classList.add("icon-placeholder");
    const fileType = detectFileType(node.url);
    if (fileType) {
      const config = getFileTypeConfig(fileType);
      if (config) {
        const iconUrl = chrome.runtime.getURL(config.icon);
        applyIconBackground(icon, iconUrl, "filetype", config.bgColor || "transparent");
        icon.style.backgroundSize = "contain";
        icon.style.backgroundRepeat = "no-repeat";
        icon.style.backgroundPosition = "center";
        icon.style.width = "16px";
        icon.style.height = "16px";
        icon.innerHTML = "";
        icon.title = i18n(config.title);
      }
      icon.dataset.faviconSource = "filetype";
    } else {
      icon.style.backgroundImage = "";
      icon.style.backgroundColor = "";
      icon.dataset.faviconSource = "pending";
    }
    const gutter = document.createElement("div");
    gutter.className = "tree-gutter";
    gutter.style.setProperty("--depth", String(depth));
    for (let i = 0; i < Math.max(0, depth - 1); i++) {
      const col = document.createElement("div");
      col.className = "tree-col";
      if (i < parentLines.length && parentLines[i]) {
        col.classList.add("has-line");
      }
      gutter.appendChild(col);
    }
    if (depth > 0) {
      const junction = document.createElement("div");
      junction.className = "tree-col tree-junction";
      junction.classList.add(isLast ? "is-last" : "is-tee");
      gutter.appendChild(junction);
    }
    const iconCol = document.createElement("div");
    iconCol.className = "tree-col tree-icon-col";
    iconCol.appendChild(icon);
    gutter.appendChild(iconCol);
    nodeElement.appendChild(gutter);
    const title = document.createElement("div");
    title.className = "tree-title";
    title.textContent = node.title || node.url;
    title.title = `${node.title}

${node.url}`;
    nodeElement.appendChild(title);
    const statusContainer = document.createElement("div");
    statusContainer.className = "tab-status-container";
    if (node.audible) {
      const audioStatus = document.createElement("span");
      audioStatus.textContent = "\u266A";
      audioStatus.className = "tab-status playing";
      audioStatus.title = i18n("audioPlaying");
      statusContainer.appendChild(audioStatus);
    } else if (node.mutedInfo && node.mutedInfo.muted) {
      const mutedStatus = document.createElement("span");
      mutedStatus.textContent = "\xD7";
      mutedStatus.className = "tab-status muted";
      mutedStatus.title = i18n("audioMuted");
      statusContainer.appendChild(mutedStatus);
    }
    const isCurrentTab = node.id === state.currentTabId;
    getBookmarkInfo(node.url, isCurrentTab).then((bookmarkInfo) => {
      let tooltipText = `${node.title}`;
      if (bookmarkInfo.isBookmarked && bookmarkInfo.title && bookmarkInfo.title.trim()) {
        title.textContent = bookmarkInfo.title;
        if (node.title === bookmarkInfo.title) {
          tooltipText = `\u{1F4C4} ${i18n("tooltipTitleLabel")}: ${node.title}`;
        } else {
          tooltipText = `\u{1F4C4} ${i18n("tooltipTitleLabel")}: ${node.title}
\u{1F4D6} ${i18n("tooltipBookmarkLabel")}: ${bookmarkInfo.title}`;
        }
      }
      if (bookmarkInfo.isBookmarked && bookmarkInfo.folderPath) {
        tooltipText += `
\u{1F4C1} ${i18n("tooltipFolderLabel")}: ${bookmarkInfo.folderPath}`;
      }
      title.title = tooltipText + `

${node.url}`;
      if (bookmarkInfo.isBookmarked) {
        const bookmarkStatus = document.createElement("span");
        bookmarkStatus.textContent = "\u2605";
        bookmarkStatus.className = "tab-status bookmarked";
        bookmarkStatus.title = i18n("bookmarkAdded");
        statusContainer.appendChild(bookmarkStatus);
      }
    }).catch((error) => {
      console.log("Error getting bookmark info:", error.message);
    });
    nodeElement.appendChild(statusContainer);
    const actionsContainer = document.createElement("div");
    actionsContainer.className = "tree-actions";
    const selectBtnContainer = document.createElement("div");
    selectBtnContainer.className = "select-btn-container";
    const selectBtn = document.createElement("button");
    selectBtn.className = "select-btn";
    selectBtn.textContent = "\u2713";
    selectBtn.title = i18n("selectNode");
    const selectOverlay = document.createElement("div");
    selectOverlay.className = "select-btn-overlay";
    selectOverlay.addEventListener("click", (e) => {
      e.stopPropagation();
      selectNodeAndChildren(node, nodeElement);
    });
    selectBtnContainer.appendChild(selectBtn);
    selectBtnContainer.appendChild(selectOverlay);
    const pinBtnContainer = document.createElement("div");
    pinBtnContainer.className = "pin-btn-container";
    const pinBtn = document.createElement("button");
    pinBtn.className = "pin-btn";
    const pinIcon = document.createElement("span");
    pinIcon.className = "pin-icon";
    const isPinnedForButton = state.pinnedTabsCache && state.pinnedTabsCache[node.id];
    if (isPinnedForButton) {
      pinIcon.textContent = "\u{1F4CC}";
      pinBtn.title = i18n("unpinFromTop") || "Unpin from top";
    } else {
      pinIcon.textContent = "\u2B06";
      pinBtn.title = i18n("pinToTop") || "Pin to top";
    }
    pinBtn.appendChild(pinIcon);
    const pinOverlay = document.createElement("div");
    pinOverlay.className = "pin-btn-overlay";
    pinOverlay.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        const isCurrentlyPinned = state.pinnedTabsCache && state.pinnedTabsCache[node.id];
        if (isCurrentlyPinned) {
          await chrome.runtime.sendMessage({ action: "removePinnedTab", tabId: node.id });
          delete state.pinnedTabsCache[node.id];
          console.log(`\u{1F4CC} Unpinned tab: ${node.id}`);
        } else {
          await chrome.tabs.move(node.id, { index: 0 });
          try {
            await chrome.runtime.sendMessage({ action: "removeTabRelationsFor", tabId: node.id });
          } catch (remErr) {
            console.warn("Failed to remove relations for pinned tab:", remErr);
          }
          const tabInfo = {
            url: node.url,
            title: node.title
          };
          await chrome.runtime.sendMessage({
            action: "addPinnedTab",
            tabId: node.id,
            tabInfo
          });
          state.pinnedTabsCache[node.id] = {
            ...tabInfo,
            timestamp: Date.now()
          };
          console.log(`\u{1F4CC} Pinned tab: ${node.id} - ${node.title}`);
        }
        await loadTabTree();
      } catch (err) {
        console.error("Error toggling pin state:", err);
      }
    });
    pinBtnContainer.appendChild(pinBtn);
    pinBtnContainer.appendChild(pinOverlay);
    const closeBtnContainer = document.createElement("div");
    closeBtnContainer.className = "close-btn-container";
    const closeBtn = document.createElement("button");
    closeBtn.className = "close-btn";
    closeBtn.textContent = "\xD7";
    const closeOverlay = document.createElement("div");
    closeOverlay.className = "close-btn-overlay";
    closeOverlay.addEventListener("click", (e) => {
      e.stopPropagation();
      closeSelectedOrCurrent(node);
    });
    closeOverlay.addEventListener("mouseenter", () => {
      if (state.selectedTabIds.size > 0) {
        closeBtn.title = i18n("closeSelectedTabs", [state.selectedTabIds.size.toString()]);
      } else {
        closeBtn.title = i18n("closeNode");
      }
    });
    closeBtnContainer.appendChild(closeBtn);
    closeBtnContainer.appendChild(closeOverlay);
    actionsContainer.appendChild(selectBtnContainer);
    actionsContainer.appendChild(pinBtnContainer);
    actionsContainer.appendChild(closeBtnContainer);
    nodeElement.appendChild(actionsContainer);
    nodeElement.addEventListener("click", async (e) => {
      e.stopPropagation();
      console.log(`Node clicked: ${node.id} - ${node.title}`);
      try {
        const input = document.getElementById("searchInput");
        const term = input && input.value ? input.value.trim() : "";
        if (term) {
          await _saveSearchHistory(term);
        }
      } catch (_) {
      }
      activateTabAndWindowFn(node.id);
    });
    container.appendChild(nodeElement);
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
  var activateTabAndWindowFn = (_tabId) => {
  };
  function registerActivateTabFn(fn) {
    activateTabAndWindowFn = fn;
  }

  // src/popup/modules/search.js
  async function saveRecentPreference(enabled) {
    try {
      await chrome.runtime.sendMessage({ action: "setDefaultRecentFilter", value: !!enabled });
    } catch {
    }
  }
  async function loadRecentPreference() {
    try {
      const res = await chrome.runtime.sendMessage({ action: "getDefaultRecentFilter" });
      return !!(res && res.value);
    } catch {
      return false;
    }
  }
  async function loadSearchHistory() {
    try {
      const store = await chrome.storage.local.get("searchHistory");
      state.searchHistory = Array.isArray(store.searchHistory) ? store.searchHistory : [];
    } catch (e) {
      state.searchHistory = [];
    }
  }
  async function saveSearchHistory(term) {
    const t = (term || "").trim();
    if (!t) return;
    state.searchHistory = [t, ...state.searchHistory.filter((x) => x !== t)].slice(0, 10);
    try {
      await chrome.storage.local.set({ searchHistory: state.searchHistory });
    } catch {
    }
  }
  function renderChipsLayer() {
    const chipsLayer = document.getElementById("chipsLayer");
    if (!chipsLayer) return;
    chipsLayer.innerHTML = "";
    const addChip = (label, type) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = label + " ";
      const remove = document.createElement("span");
      remove.className = "remove";
      remove.textContent = "\xD7";
      remove.title = "Remove";
      remove.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (type === "bookmarked") state.selectedFilters.bookmarked = false;
        if (type === "recent") {
          state.selectedFilters.recent = false;
          await saveRecentPreference(false);
        }
        if (type === "history") state.selectedFilters.historyTerm = null;
        renderChipsLayer();
        performSearch(document.getElementById("searchInput")?.value || "");
      });
      chip.appendChild(remove);
      chipsLayer.appendChild(chip);
    };
    if (state.selectedFilters.recent) addChip(i18n("recent2h") || "Recent", "recent");
    if (state.selectedFilters.bookmarked) addChip(i18n("bookmarked") || "Bookmarked", "bookmarked");
    if (state.selectedFilters.historyTerm) addChip(state.selectedFilters.historyTerm, "history");
    const input = document.getElementById("searchInput");
    if (input) {
      const basePadding = 35;
      const gap = 6;
      const chipsWidth = chipsLayer.children.length > 0 ? Math.min(chipsLayer.scrollWidth, input.clientWidth - basePadding - 30) : 0;
      const newPadding = chipsWidth > 0 ? basePadding + chipsWidth + gap : basePadding;
      input.style.paddingLeft = newPadding + "px";
    }
  }
  function renderTagSuggestions() {
    const container = document.getElementById("tagSuggestions");
    if (!container) return;
    container.innerHTML = "";
    const makeChip = (text, onClick) => {
      const el = document.createElement("span");
      el.className = "tag-chip";
      el.textContent = text;
      el.addEventListener("mousedown", async (e) => {
        e.preventDefault();
        await onClick();
      });
      return el;
    };
    container.appendChild(makeChip(i18n("recent2h") || "Recent 2h", async () => {
      state.selectedFilters.recent = !state.selectedFilters.recent;
      await saveRecentPreference(state.selectedFilters.recent);
      state.suppressAutoSearchOnce = true;
      renderChipsLayer();
      performSearch(document.getElementById("searchInput")?.value || "");
    }));
    container.appendChild(makeChip(i18n("bookmarked") || "Bookmarked", async () => {
      state.selectedFilters.bookmarked = !state.selectedFilters.bookmarked;
      renderChipsLayer();
      performSearch(document.getElementById("searchInput")?.value || "");
    }));
    loadSearchHistory().then(() => {
      (state.searchHistory || []).slice(0, 6).forEach((term) => {
        if (!term) return;
        container.appendChild(makeChip(term, () => {
          state.selectedFilters.historyTerm = term;
          const input = document.getElementById("searchInput");
          if (input) input.value = "";
          renderChipsLayer();
          performSearch("");
        }));
      });
    });
    container.style.display = "flex";
  }
  function normalizeText(text) {
    if (!text) return "";
    return text.toLowerCase().replace(/[\uff01-\uff5e]/g, function(ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 65248);
    }).replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();
  }
  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function highlightText(element, searchTerm) {
    removeHighlight(element);
    if (!searchTerm) return;
    const text = element.textContent;
    const normalizedText = normalizeText(text);
    const normalizedSearchTerm = normalizeText(searchTerm);
    const index = normalizedText.indexOf(normalizedSearchTerm);
    if (index !== -1) {
      let originalIndex = index;
      let originalLength = normalizedSearchTerm.length;
      if (normalizedText !== text.toLowerCase()) {
        const pattern = new RegExp(escapeRegExp(searchTerm), "i");
        const match = text.match(pattern);
        if (match) {
          originalIndex = match.index;
          originalLength = match[0].length;
        }
      }
      const beforeText = text.substring(0, originalIndex);
      const matchText = text.substring(originalIndex, originalIndex + originalLength);
      const afterText = text.substring(originalIndex + originalLength);
      element.innerHTML = beforeText + '<span class="search-highlight">' + matchText + "</span>" + afterText;
    }
  }
  function removeHighlight(nodeOrElement) {
    const element = nodeOrElement.querySelector ? nodeOrElement.querySelector(".tree-title") : nodeOrElement;
    if (element) {
      const highlights = element.querySelectorAll(".search-highlight");
      highlights.forEach((highlight) => {
        const text = highlight.textContent;
        highlight.replaceWith(document.createTextNode(text));
      });
      element.normalize();
    }
  }
  function showParentNodes(node) {
    let parent = node.parentElement;
    while (parent && parent.classList.contains("tree-node")) {
      parent.classList.remove("hidden");
      parent = parent.parentElement;
    }
  }
  function showAllNodes() {
    const allNodes = document.querySelectorAll(".tree-node");
    allNodes.forEach((node) => {
      node.classList.remove("hidden");
      removeHighlight(node);
    });
    const separators = document.querySelectorAll(".pinned-separator");
    separators.forEach((sep) => sep.style.display = "flex");
    updateSeparatorVisibility();
  }
  function showNoResultsMessage() {
    removeNoResultsMessage();
    const treeContainer = document.getElementById("treeContainer");
    const noResults = document.createElement("div");
    noResults.className = "no-results";
    noResults.id = "noResults";
    noResults.textContent = `No tabs found matching "${state.currentSearchTerm}"`;
    treeContainer.appendChild(noResults);
  }
  function removeNoResultsMessage() {
    const existing = document.getElementById("noResults");
    if (existing) {
      existing.remove();
    }
  }
  async function filterNodesWithTags() {
    const allNodes = document.querySelectorAll(".tree-node");
    let hasVisibleResults = false;
    let hasPinnedResults = false;
    let hasNormalResults = false;
    allNodes.forEach((node, index) => {
      const tabTitle = node.querySelector(".tree-title");
      const tabUrl = node.getAttribute("data-tab-url") || "";
      const titleText = tabTitle ? normalizeText(tabTitle.textContent) : "";
      const tabId = parseInt(node.getAttribute("data-tab-id"));
      const titleMatches = state.currentSearchTerm ? titleText.includes(state.currentSearchTerm) : true;
      const urlMatches = state.currentSearchTerm ? normalizeText(tabUrl).includes(state.currentSearchTerm) : true;
      let matches = titleMatches || urlMatches;
      if (matches && state.selectedFilters.historyTerm && !state.currentSearchTerm) {
        const hist = normalizeText(state.selectedFilters.historyTerm);
        matches = titleText.includes(hist) || normalizeText(tabUrl).includes(hist);
      }
      if (matches && state.selectedFilters.bookmarked) {
        const normalize = (u) => {
          try {
            const x = new URL(u);
            x.hash = "";
            return x.href;
          } catch {
            return (u || "").split("#")[0];
          }
        };
        const norm = normalize(tabUrl);
        if (!state.bookmarkedUrlsSet || !state.bookmarkedUrlsSet.has(norm)) {
          matches = false;
        }
      }
      if (index < 3 && state.currentSearchTerm) {
        console.log(`\u{1F50D} Node ${index} debug:`, {
          originalTitle: tabTitle ? tabTitle.textContent : "No title",
          normalizedTitle: titleText,
          searchTerm: state.currentSearchTerm,
          titleMatches,
          urlMatches,
          matches
        });
      }
      if (matches) {
        node.classList.remove("hidden");
        showParentNodes(node);
        hasVisibleResults = true;
        const isPinned = state.pinnedTabsCache && state.pinnedTabsCache[tabId];
        if (isPinned) {
          hasPinnedResults = true;
        } else {
          hasNormalResults = true;
        }
        if (titleMatches && tabTitle) {
          highlightText(tabTitle, state.currentSearchTerm);
        }
      } else {
        node.classList.add("hidden");
      }
    });
    updateSeparatorVisibility();
    return hasVisibleResults;
  }
  async function performSearch(searchTerm) {
    state.currentSearchTerm = normalizeText(searchTerm);
    console.log("\u{1F50D} Search debug:", {
      original: searchTerm,
      normalized: state.currentSearchTerm,
      length: state.currentSearchTerm.length
    });
    if (state.selectedFilters.recent && !state.isRefreshingByRecent) {
      try {
        state.isRefreshingByRecent = true;
        await loadTabTree();
      } finally {
        state.isRefreshingByRecent = false;
      }
      state.selectedFilters.lastRecent = state.selectedFilters.recent;
    }
    if (!searchTerm && !state.selectedFilters.bookmarked && !state.selectedFilters.recent && !state.selectedFilters.historyTerm) {
      showAllNodes();
      removeNoResultsMessage();
      scrollToCurrentTab();
      return;
    }
    if (state.selectedFilters.bookmarked && !state.bookmarkedUrlsSet) {
      await getAllBookmarkedUrlSet();
    }
    const hasResults = await filterNodesWithTags();
    if (!hasResults) {
      showNoResultsMessage();
    } else {
      removeNoResultsMessage();
    }
    scrollToCurrentTab();
  }
  function clearSearch() {
    const searchInput = document.getElementById("searchInput");
    const clearBtn = document.getElementById("clearSearchBtn");
    if (searchInput) {
      searchInput.value = "";
      searchInput.focus();
    }
    if (clearBtn) {
      clearBtn.classList.remove("visible");
    }
    state.currentSearchTerm = "";
    showAllNodes();
    removeNoResultsMessage();
    renderChipsLayer();
  }
  function initializeSearch() {
    const searchInput = document.getElementById("searchInput");
    const clearSearchBtn = document.getElementById("clearSearchBtn");
    if (!searchInput || !clearSearchBtn) return;
    searchInput.addEventListener("input", (e) => {
      const searchTerm = e.target.value.trim();
      const clearBtn = document.getElementById("clearSearchBtn");
      if (searchTerm) {
        clearBtn.classList.add("visible");
      } else {
        clearBtn.classList.remove("visible");
      }
      performSearch(searchTerm);
    });
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        clearSearch();
      }
    });
    clearSearchBtn.addEventListener("click", clearSearch);
    setTimeout(() => {
      searchInput.focus();
    }, 100);
  }

  // src/popup/modules/debug.js
  var NavigationHelper = {
    async isNavigating() {
      try {
        const historyData = await chrome.runtime.sendMessage({ action: "getHistoryData" });
        return historyData ? historyData.currentIndex == historyData.history.length - 1 : false;
      } catch (error) {
        console.error("Error getting navigation state:", error);
        return false;
      }
    }
  };
  function normalizeText2(text) {
    if (!text) return "";
    return text.toLowerCase().replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 65248)).replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();
  }
  function installDebugGlobals(performSearch2) {
    window.debugSearch = {
      testNormalize: (text) => {
        console.log("\u{1F4DD} Text normalization test:", {
          original: text,
          normalized: normalizeText2(text)
        });
        return normalizeText2(text);
      },
      testSearch: (searchTerm) => {
        console.log("\u{1F50D} Testing search for:", searchTerm);
        performSearch2(searchTerm);
      },
      getAllTitles: () => {
        const titles = [];
        document.querySelectorAll(".tree-title").forEach((el, index) => {
          const original = el.textContent;
          const normalized = normalizeText2(original);
          titles.push({ index, original, normalized });
        });
        console.table(titles);
        return titles;
      }
    };
    window.debugPopup = {
      testNormalize: (text) => normalizeText2(text),
      testSearch: (term) => performSearch2(term),
      getAllTitles: () => {
        const titles = [];
        document.querySelectorAll(".tree-title").forEach((el) => {
          titles.push(el.textContent);
        });
        return titles;
      },
      adjustHeight: () => calculateTreeHeight(),
      getHeightInfo: () => {
        const body = document.body;
        const html = document.documentElement;
        const treeContainer = document.getElementById("treeContainer");
        return {
          bodyScrollHeight: body.scrollHeight,
          bodyClientHeight: body.clientHeight,
          htmlScrollHeight: html.scrollHeight,
          htmlClientHeight: html.clientHeight,
          treeMaxHeight: treeContainer ? treeContainer.style.maxHeight : "not found"
        };
      },
      navigation: {
        isNavigating: () => NavigationHelper.isNavigating()
      },
      pdf: {
        isPdf: (url) => isPdfUrl(url),
        getIconUrl: () => chrome.runtime.getURL("assets/icon-pdf.svg"),
        testUrls: () => {
          const testUrls = [
            "chrome-extension://oemmndcbldboiebfnladdacbdfmadadm/file:///Users/jake/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/%E6%8A%80%E6%9C%AF/%E6%8A%80%E6%9C%AF%E5%A4%A7%E4%BC%9A/qc5.pdf",
            "file:///Users/jake/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/%E6%8A%80%E6%9C%AF/%E6%8A%80%E6%9C%.pdf",
            "https://example.com/document.pdf",
            "https://google.com",
            "file:///path/to/document.txt"
          ];
          console.log("\u{1F50D} PDF URL Detection Test:");
          console.log("\u{1F4C4} PDF Icon URL:", chrome.runtime.getURL("assets/icon-pdf.svg"));
          testUrls.forEach((url) => {
            const result = isPdfUrl(url);
            console.log(`${result ? "\u2705" : "\u274C"} ${url} \u2192 ${result}`);
          });
          return testUrls.map((url) => ({ url, isPdf: isPdfUrl(url) }));
        }
      },
      tabStatus: {
        checkAllTabs: async () => {
          try {
            const tabs = await chrome.tabs.query({});
            const statusInfo = tabs.map((tab) => ({
              id: tab.id,
              title: tab.title,
              url: tab.url,
              active: tab.active,
              discarded: tab.discarded,
              status: tab.status,
              loaded: tab.status === "complete"
            }));
            console.log("\u{1F504} All tabs status:");
            console.table(statusInfo);
            const unloadedTabs = statusInfo.filter((tab) => tab.discarded || tab.status === "unloaded");
            console.log("\u{1F4F4} Unloaded tabs count:", unloadedTabs.length);
            return statusInfo;
          } catch (error) {
            console.error("Error checking tab status:", error);
            return [];
          }
        },
        checkUnloadedNodes: () => {
          const unloadedNodes = document.querySelectorAll(".tree-node.unloaded");
          const allNodes = document.querySelectorAll(".tree-node");
          console.log("\u{1F3A8} Unloaded nodes in DOM:", unloadedNodes.length, "/", allNodes.length);
          const unloadedInfo = Array.from(unloadedNodes).map((node) => ({
            tabId: node.dataset.tabId,
            title: node.querySelector(".tree-title")?.textContent,
            url: node.dataset.tabUrl
          }));
          console.table(unloadedInfo);
          return unloadedInfo;
        },
        refreshUnloadedStatus: async () => {
          console.log("\u{1F504} Refreshing unloaded status...");
          await loadTabTree();
        }
      }
    };
  }

  // src/popup/popup-main.js
  registerSearchHistorySaver(saveSearchHistory);
  registerActivateTabFn(activateTabAndWindow);
  document.addEventListener("DOMContentLoaded", async () => {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      state.currentTabId = activeTab.id;
    }
    let preferRecent = false;
    try {
      preferRecent = await loadRecentPreference();
    } catch {
    }
    if (preferRecent) {
      state.selectedFilters.recent = true;
      renderChipsLayer();
      await performSearch(document.getElementById("searchInput")?.value || "");
    } else {
      await loadTabTree();
      performSearch("");
    }
    document.getElementById("backBtn").addEventListener("click", async () => {
      if (window.tabHistory) {
        const prevTabId = await window.tabHistory.getPreviousTab();
        if (prevTabId) {
          activateTabAndWindow(prevTabId);
        }
        await updateNavigationButtons();
      }
    });
    document.getElementById("forwardBtn").addEventListener("click", async () => {
      if (window.tabHistory) {
        const nextTabId = await window.tabHistory.getNextTab();
        if (nextTabId) {
          activateTabAndWindow(nextTabId);
        }
        await updateNavigationButtons();
      }
    });
    const refreshBtn = document.getElementById("refreshBtn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        await loadTabTree();
      });
    }
    document.getElementById("exportBtn").addEventListener("click", async () => {
      try {
        if (!window.__exportModuleLoaded) {
          await loadScriptOnce("../shared/export.js");
          window.__exportModuleLoaded = true;
        }
        await exportTabTree();
      } catch (e) {
        console.error("Failed to load export module:", e);
      }
    });
    document.getElementById("organizeBtn").addEventListener("click", async () => {
      try {
        if (!window.AutoOrganizer && !window.autoOrganizer) {
          if (!window.__organizeModuleLoaded) {
            await loadScriptOnce("../shared/auto-organize.js");
            window.__organizeModuleLoaded = true;
          }
        }
      } catch (e) {
        console.error("Failed to load auto-organize module:", e);
      }
      const AutoOrganizerClass = window.AutoOrganizer;
      const autoOrganizerInstance = window.autoOrganizer;
      if (AutoOrganizerClass) {
        const organizer = new AutoOrganizerClass();
        await organizer.organizeTabsByDomain();
        await loadTabTree();
      } else if (autoOrganizerInstance) {
        await autoOrganizerInstance.organizeTabsByDomain();
        await loadTabTree();
      } else {
        console.error("AutoOrganizer not loaded. Available window objects:", Object.keys(window).filter((key) => key.toLowerCase().includes("organ")));
      }
    });
    calculateTreeHeight();
    await updateNavigationButtons();
    initI18n();
    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
      searchInput.addEventListener("focus", () => {
        renderTagSuggestions();
      });
      const ensureTagSuggestions = () => {
        try {
          renderTagSuggestions();
        } catch {
        }
      };
      searchInput.addEventListener("mousedown", ensureTagSuggestions);
      searchInput.addEventListener("click", ensureTagSuggestions);
      ensureTagSuggestions();
      searchInput.addEventListener("keydown", async (e) => {
        if (e.key === "Enter") {
          await saveSearchHistory(searchInput.value);
          renderTagSuggestions();
        }
        if (e.key === "Backspace" && (searchInput.value || "").trim() === "") {
          let removed = false;
          if (state.selectedFilters.historyTerm) {
            state.selectedFilters.historyTerm = null;
            removed = true;
          } else if (state.selectedFilters.recent) {
            state.selectedFilters.recent = false;
            removed = true;
          } else if (state.selectedFilters.bookmarked) {
            state.selectedFilters.bookmarked = false;
            removed = true;
          }
          if (removed) {
            e.preventDefault();
            renderChipsLayer();
            await performSearch("");
          }
        }
      });
    }
    initializeSearch();
    installDebugGlobals(performSearch);
  });
  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-dynamic="${src}"]`)) {
        resolve();
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.defer = true;
      s.dataset.dynamic = src;
      s.onload = () => resolve();
      s.onerror = (e) => reject(e);
      document.body.appendChild(s);
    });
  }
})();
//# sourceMappingURL=popup.js.map
