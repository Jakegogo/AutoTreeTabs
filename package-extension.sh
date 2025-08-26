#!/bin/bash

# Auto Tree Tabs 扩展打包脚本
# 使用方法: ./package-extension.sh

echo "🚀 开始打包 Auto Tree Tabs 扩展..."

# 创建临时打包目录
TEMP_DIR="./build-temp"
ZIP_NAME="auto-tree-tabs-v1.0.1.zip"

# 清理之前的构建
if [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
fi

# 创建构建目录
mkdir -p "$TEMP_DIR"

echo "📂 复制扩展文件..."

# 复制核心文件
cp manifest.json "$TEMP_DIR/"
cp popup.html "$TEMP_DIR/"
cp popup.js "$TEMP_DIR/"
cp options.html "$TEMP_DIR/"
cp options.js "$TEMP_DIR/"
cp background.js "$TEMP_DIR/"
cp content.js "$TEMP_DIR/"
cp history.js "$TEMP_DIR/"
cp auto-organize.js "$TEMP_DIR/"
cp export.js "$TEMP_DIR/"
cp i18n.js "$TEMP_DIR/"
cp popup-init.js "$TEMP_DIR/"
cp options-init.js "$TEMP_DIR/"

# 复制国际化文件
cp -r _locales "$TEMP_DIR/" 2>/dev/null || echo "⚠️  _locales目录不存在，跳过国际化文件"

# 复制图标文件
cp -r icons "$TEMP_DIR/" 2>/dev/null || echo "⚠️  icons目录不存在，请先生成图标文件"

# 复制SVG图标
cp icon-*.svg "$TEMP_DIR/" 2>/dev/null || echo "⚠️  部分SVG图标文件不存在"

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
