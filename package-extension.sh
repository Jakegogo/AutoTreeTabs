#!/bin/bash

# Auto Tree Tabs 扩展打包脚本
# 使用方法:
#   ./package-extension.sh        # 生产版（压缩，无 sourcemap）
#   ./package-extension.sh --dev  # 开发版（含 sourcemap，ZIP 名加 -dev 后缀）

DEV=false
for arg in "$@"; do
  [ "$arg" = "--dev" ] && DEV=true
done

echo "🚀 开始打包 Auto Tree Tabs 扩展..."

# 构建 popup bundle
if [ "$DEV" = true ]; then
  echo "🔨 构建 popup bundle（开发版，含 sourcemap）..."
  npm run build
else
  echo "🔨 构建 popup bundle（生产版，压缩）..."
  npm run build:prod
fi

# 创建临时打包目录
TEMP_DIR="./build-temp"
VERSION="$(node -p "require('./manifest.json').version")"
SUFFIX=""
[ "$DEV" = true ] && SUFFIX="-dev"
ZIP_NAME="auto-tree-tabs-v${VERSION}${SUFFIX}.zip"
DIST_DIR="./dist"

# 清理之前的构建
if [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
fi

# 创建构建目录和 dist 目录
mkdir -p "$TEMP_DIR"
mkdir -p "$DIST_DIR"

echo "📂 复制扩展文件..."

# 复制根配置文件
cp manifest.json "$TEMP_DIR/"

# 复制源码目录（保留完整结构）
cp -r src "$TEMP_DIR/"

# 在打包阶段将 background 依赖合并内联，生成单文件 background.js
echo "🔗 合并 background 依赖为单文件..."
BUNDLE_FILE="$TEMP_DIR/background.bundle.js"
PACKED_BG="$TEMP_DIR/background.packed.js"

# 按依赖顺序生成 bundle（先类/工具，再主逻辑）
cat \
  "$TEMP_DIR/src/background/PinnedTabPersistentStorage.js" \
  "$TEMP_DIR/src/background/DelayedMergeExecutor.js" \
  "$TEMP_DIR/src/background/SettingsCache.js" \
  "$TEMP_DIR/src/background/StorageManager.js" \
  "$TEMP_DIR/src/background/tools.js" \
  "$TEMP_DIR/src/background/AutoBackTrack.js" \
  > "$BUNDLE_FILE"

# 去除 background.js 中的 importScripts 行，合并为单文件
grep -v "^importScripts(" "$TEMP_DIR/src/background/background.js" > "$TEMP_DIR/background.without_imports.js"
cat "$BUNDLE_FILE" "$TEMP_DIR/background.without_imports.js" > "$PACKED_BG"
mv "$PACKED_BG" "$TEMP_DIR/src/background/background.js"
rm -f "$TEMP_DIR/background.without_imports.js" "$BUNDLE_FILE"

# 打包产物中移除已内联的依赖文件（background.js 已包含所有逻辑）
rm -f \
  "$TEMP_DIR/src/background/PinnedTabPersistentStorage.js" \
  "$TEMP_DIR/src/background/DelayedMergeExecutor.js" \
  "$TEMP_DIR/src/background/SettingsCache.js" \
  "$TEMP_DIR/src/background/StorageManager.js" \
  "$TEMP_DIR/src/background/tools.js" \
  "$TEMP_DIR/src/background/AutoBackTrack.js"

# 移除 popup 源模块（popup.js 已包含编译后的所有逻辑）
rm -rf "$TEMP_DIR/src/popup/modules"
rm -f  "$TEMP_DIR/src/popup/popup-main.js"

# 生产版：移除 sourcemap（开发版保留）
if [ "$DEV" = false ]; then
  rm -f "$TEMP_DIR/src/popup/popup.js.map"
fi

# 复制国际化文件
cp -r _locales "$TEMP_DIR/" 2>/dev/null || echo "⚠️  _locales目录不存在，跳过国际化文件"

# 复制资源文件（icons与svg等都在assets内）
cp -r assets "$TEMP_DIR/" 2>/dev/null || echo "⚠️  assets目录不存在，请先生成资源文件"

# 排除不需要的文件
echo "🗑️  清理不需要的文件..."

# 进入构建目录
cd "$TEMP_DIR"

# 创建ZIP文件（输出到 dist/）
echo "📦 创建ZIP包..."
zip -r "../$DIST_DIR/$ZIP_NAME" . -x "*.DS_Store" "*.git*" "node_modules/*" "*.log"

# 返回根目录
cd ..

# 清理临时目录
rm -rf "$TEMP_DIR"

if [ "$DEV" = true ]; then
  echo "✅ 打包完成！[开发版，含 sourcemap]"
else
  echo "✅ 打包完成！[生产版]"
fi
echo "📦 文件位置: $DIST_DIR/$ZIP_NAME"
echo "📊 文件大小: $(du -h "$DIST_DIR/$ZIP_NAME" | cut -f1)"

if [ "$DEV" = false ]; then
  echo ""
  echo "🎯 下一步："
  echo "1. 登录 Chrome Web Store Developer Dashboard"
  echo "2. 上传 $DIST_DIR/$ZIP_NAME 文件"
  echo "3. 填写商店信息和截图"
  echo "4. 提交审核"
  echo ""
  echo "🔗 Chrome Web Store Developer Dashboard:"
  echo "https://chrome.google.com/webstore/devconsole/"
fi
