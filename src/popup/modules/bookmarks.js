// ===================
// 书签查询
// ===================
import { state } from './state.js';

export async function getAllBookmarkedUrlSet() {
  if (state.bookmarkedUrlsSet) return state.bookmarkedUrlsSet;
  try {
    const tree = await chrome.bookmarks.getTree();
    const set = new Set();
    const stack = [...tree];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      if (node.url) {
        try {
          const u = new URL(node.url); u.hash = ''; set.add(u.href);
        } catch {
          set.add((node.url || '').split('#')[0]);
        }
      }
      if (node.children) stack.push(...node.children);
    }
    state.bookmarkedUrlsSet = set;
    return set;
  } catch (e) {
    state.bookmarkedUrlsSet = new Set();
    return state.bookmarkedUrlsSet;
  }
}

// 获取书签直接上级文件夹名称
export async function getBookmarkFolderPath(parentId) {
  if (!parentId) return null;

  try {
    const folders = await chrome.bookmarks.get(parentId);
    if (!folders || folders.length === 0) return null;

    const folder = folders[0];

    // 跳过根文件夹（"书签栏"、"其他书签"等），返回null
    if (!folder.title || !folder.parentId) {
      return null;
    }

    return folder.title;
  } catch (error) {
    console.log('Error getting bookmark folder path:', error.message);
    return null;
  }
}

// 获取书签信息（包含状态、标题和文件夹路径）
export async function getBookmarkInfo(url, isCurrentTab = false) {
  if (!url) return { isBookmarked: false, title: null, folderPath: null };

  // 当前页面不查缓存，直接查询
  if (isCurrentTab) {
    try {
      const bookmarks = await chrome.bookmarks.search({ url: url });
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
      console.log('Error searching bookmarks:', error.message);
      return { isBookmarked: false, title: null, folderPath: null };
    }
  }

  // 其他页面先查缓存
  if (state.bookmarkCache.has(url)) {
    const cachedInfo = state.bookmarkCache.get(url);
    // 兼容旧格式缓存（boolean）和新格式缓存（object）
    if (typeof cachedInfo === 'boolean') {
      return { isBookmarked: cachedInfo, title: null, folderPath: null };
    } else {
      return {
        isBookmarked: cachedInfo.isBookmarked || false,
        title: cachedInfo.title || null,
        folderPath: cachedInfo.folderPath || null
      };
    }
  }

  // 缓存未命中，查询API并缓存结果
  try {
    const bookmarks = await chrome.bookmarks.search({ url: url });
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
    console.log('Error searching bookmarks:', error.message);
    const errorInfo = { isBookmarked: false, title: null, folderPath: null };
    state.bookmarkCache.set(url, errorInfo);
    return errorInfo;
  }
}
