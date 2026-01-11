# Auto Tree Tabs v1.0.3 更新日志

**发布日期**: 2026年01月11日  
**版本**: v1.0.3  
**CommitID**: [988fdf4](https://github.com/Jakegogo/AutoTreeTabs/commit/988fdf4794761a4d4206dfa4b4530b22badc4559)

## 🐛 重要修复

### 🔧 Windows / favicon 加载异常导致 UI 不稳定
**问题描述**: 在 Windows 的 Chrome 中，部分站点 favicon 加载失败（如 403/502 或跨域限制）时，可能导致建议区/渲染链路异常或图标大量报错。

**修复内容**:
- **URL 解码容错**: `decodeURIComponent` 增加容错，避免非法 URL 触发 `URIError` 中断渲染流程
- **favicon 失败隔离**: 图标获取失败不再影响主 UI 渲染

## ✨ 新功能 / 改进

### 🖼️ favicon 缓存（Popup 侧实现）
- 新增 `favicon-cache.js`：将 favicon 获取/缓存/落盘集中到独立模块
- **缓存策略**:
  - 成功：缓存为 `data:`（尽量减少网络请求）
  - CORS 受限：缓存为可显示的 URL（避免重复 fetch 刷 CORS 报错）
  - 失败：negative cache（避免短时间内反复重试）
- **渲染策略**:
  - Popup 首屏先占位（避免一打开就触发大量 favicon 网络请求）
  - 渲染完成后异步 hydrate 图标，按需更新缓存

### 🔍 可观测性增强
- `.tree-icon` 增加 `data-favicon-source`，便于在 DevTools 中快速判断图标来源（cache / network / negative 等）

## 🛠️ 开发者改进

### 📦 打包脚本增强
- `package-extension.sh` 改为 **自动从 `manifest.json` 读取版本号** 生成 zip 文件名（避免手工改版本）
- 增加 `copy_if_exists`，缺失文件时不再中断打包流程

## 🔗 相关链接

- **GitHub仓库**: https://github.com/Jakegogo/AutoTreeTabs
- **问题反馈**: https://github.com/Jakegogo/AutoTreeTabs/issues
- **提交详情**: [988fdf4](https://github.com/Jakegogo/AutoTreeTabs/commit/988fdf4794761a4d4206dfa4b4530b22badc4559)

---

## 📞 支持与反馈

如果您在使用过程中遇到任何问题或有改进建议，欢迎通过以下方式联系：
- **邮箱**: jakegogogo@gmail.com
- **GitHub Issues**: https://github.com/Jakegogo/AutoTreeTabs/issues

感谢您的使用和支持！🚀

