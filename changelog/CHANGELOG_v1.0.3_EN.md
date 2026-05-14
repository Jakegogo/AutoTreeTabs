# Auto Tree Tabs v1.0.3 Release Notes

**Release Date**: January 11, 2026  
**Version**: v1.0.3  
**CommitID**: [988fdf4](https://github.com/Jakegogo/AutoTreeTabs/commit/988fdf4794761a4d4206dfa4b4530b22badc4559)

## 🐛 Critical Fixes

### 🔧 Windows / favicon failures causing unstable UI
**Issue**: On Chrome for Windows, when favicons fail to load (e.g. 403/502 or CORS restrictions), parts of the UI could become unstable or produce excessive errors.

**Fixes**:
- **Safe URL decoding**: Added a guard around `decodeURIComponent` to prevent `URIError` from breaking the render flow
- **Favicon failure isolation**: Favicon failures no longer block the main UI rendering

## ✨ Features / Improvements

### 🖼️ Favicon cache (implemented in Popup)
- Added `favicon-cache.js` to centralize favicon fetch/cache/persist logic in a standalone module
- **Caching strategy**:
  - Success: cache as `data:` to reduce repeated network requests
  - CORS-restricted: cache as a displayable URL (prevents repeated fetch + CORS spam)
  - Failure: negative cache to avoid rapid retries
- **Rendering strategy**:
  - Popup first paint uses placeholders (avoids triggering favicon requests immediately)
  - After the tree renders, icons are hydrated asynchronously and the cache is updated as needed

### 🔍 Observability
- Added `data-favicon-source` on `.tree-icon` for quick debugging (cache / network / negative, etc.)

## 🛠️ Developer Improvements

### 📦 Packaging script improvements
- `package-extension.sh` now reads the version from `manifest.json` and generates `auto-tree-tabs-v<version>.zip`
- Added `copy_if_exists` so missing optional files won’t break packaging

## 🔗 Related Links

- **GitHub Repository**: https://github.com/Jakegogo/AutoTreeTabs
- **Issue Tracker**: https://github.com/Jakegogo/AutoTreeTabs/issues
- **Commit Details**: [988fdf4](https://github.com/Jakegogo/AutoTreeTabs/commit/988fdf4794761a4d4206dfa4b4530b22badc4559)

---

## 📞 Support & Feedback

If you encounter any issues or have suggestions for improvement, please contact us:
- **Email**: jakegogogo@gmail.com
- **GitHub Issues**: https://github.com/Jakegogo/AutoTreeTabs/issues

Thank you for using Auto Tree Tabs! 🚀

