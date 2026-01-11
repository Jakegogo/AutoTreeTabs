#!/bin/bash

# Auto Tree Tabs 扩展打包脚本
# 使用方法: ./package-extension.sh

echo "🚀 开始打包 Auto Tree Tabs 扩展..."

# 创建临时打包目录
TEMP_DIR="./build-temp"
VERSION="$(node -p "require('./manifest.json').version")"
ZIP_NAME="auto-tree-tabs-v${VERSION}.zip"

# 清理之前的构建
if [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
fi

# 创建构建目录
mkdir -p "$TEMP_DIR"

echo "📂 复制扩展文件..."

# 安全复制：文件不存在时不失败（避免打包中断）
copy_if_exists() {
  local src="$1"
  local dst="$2"
  if [ -f "$src" ]; then
    cp "$src" "$dst"
  else
    echo "⚠️  $src 不存在，跳过"
  fi
}

# 复制核心文件
copy_if_exists manifest.json "$TEMP_DIR/"
copy_if_exists popup.html "$TEMP_DIR/"
copy_if_exists popup.js "$TEMP_DIR/"
copy_if_exists options.html "$TEMP_DIR/"
copy_if_exists options.js "$TEMP_DIR/"
copy_if_exists background.js "$TEMP_DIR/"
copy_if_exists content.js "$TEMP_DIR/"
copy_if_exists history.js "$TEMP_DIR/"
copy_if_exists auto-organize.js "$TEMP_DIR/"
copy_if_exists export.js "$TEMP_DIR/"
copy_if_exists i18n.js "$TEMP_DIR/"
copy_if_exists popup-init.js "$TEMP_DIR/"
copy_if_exists options-init.js "$TEMP_DIR/"
copy_if_exists favicon-cache.js "$TEMP_DIR/"

# 复制新增的源码文件（供 background.js 通过 importScripts 加载）
mkdir -p "$TEMP_DIR/src/background"
cp src/background/PinnedTabPersistentStorage.js "$TEMP_DIR/src/background/" 2>/dev/null || echo "⚠️  src/background/PinnedTabPersistentStorage.js 不存在，跳过"
cp src/background/DelayedMergeExecutor.js "$TEMP_DIR/src/background/" 2>/dev/null || echo "⚠️  src/background/DelayedMergeExecutor.js 不存在，跳过"
cp src/background/SettingsCache.js "$TEMP_DIR/src/background/" 2>/dev/null || echo "⚠️  src/background/SettingsCache.js 不存在，跳过"
cp src/background/StorageManager.js "$TEMP_DIR/src/background/" 2>/dev/null || echo "⚠️  src/background/StorageManager.js 不存在，跳过"
cp src/background/tools.js "$TEMP_DIR/src/background/" 2>/dev/null || echo "⚠️  src/background/tools.js 不存在，跳过"
cp src/background/AutoBackTrack.js "$TEMP_DIR/src/background/" 2>/dev/null || echo "⚠️  src/background/AutoBackTrack.js 不存在，跳过"

# 在打包阶段将 importScripts 的依赖合并为一个文件，并内联到 background.js
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

# 去除 background.js 中的 importScripts 行
sed "/importScripts('src\\/background\\//d" "$TEMP_DIR/background.js" > "$TEMP_DIR/background.without_imports.js"

# 生成打包用的 background.js（bundle + 去除import的主体）
cat "$BUNDLE_FILE" "$TEMP_DIR/background.without_imports.js" > "$PACKED_BG"
mv "$PACKED_BG" "$TEMP_DIR/background.js"
rm -f "$TEMP_DIR/background.without_imports.js" "$BUNDLE_FILE"

# 打包产物中不再需要分散的依赖文件
rm -rf "$TEMP_DIR/src/background"

# 复制国际化文件
cp -r _locales "$TEMP_DIR/" 2>/dev/null || echo "⚠️  _locales目录不存在，跳过国际化文件"

# 复制资源文件（icons与svg等都在assets内）
cp -r assets "$TEMP_DIR/" 2>/dev/null || echo "⚠️  assets目录不存在，请先生成资源文件"

# 排除不需要的文件
echo "🗑️  清理不需要的文件..."

# 进入构建目录
cd "$TEMP_DIR"

# 创建ZIP文件
echo "📦 创建ZIP包..."
zip -r "../$ZIP_NAME" . -x "*.DS_Store" "*.git*" "node_modules/*" "*.log"

# 返回根目录
cd ..

# 清理临时目录
rm -rf "$TEMP_DIR"

echo "✅ 打包完成！"
echo "📦 文件位置: ./$ZIP_NAME"
echo "📊 文件大小: $(du -h "$ZIP_NAME" | cut -f1)"
echo ""
echo "🎯 下一步："
echo "1. 登录 Chrome Web Store Developer Dashboard"
echo "2. 上传 $ZIP_NAME 文件"
echo "3. 填写商店信息和截图"
echo "4. 提交审核"
echo ""
echo "🔗 Chrome Web Store Developer Dashboard:"
echo "https://chrome.google.com/webstore/devconsole/"
