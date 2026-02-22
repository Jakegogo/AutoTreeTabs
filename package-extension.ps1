
# Auto Tree Tabs 扩展打包脚本 - Windows PowerShell
# 使用方法:
#   .\package-extension.ps1        # 生产版（压缩，无 sourcemap）
#   .\package-extension.ps1 -Dev   # 开发版（含 sourcemap，ZIP 名加 -dev 后缀）
# 要求: PowerShell 5.1+，Windows 10/11 自带
param(
    [switch]$Dev
)

$ErrorActionPreference = "Stop"
# 设置控制台输出为 UTF-8，避免中文乱码
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "开始打包 Auto Tree Tabs 扩展..." -ForegroundColor Cyan

# ── 构建 popup bundle ────────────────────────────────────────────
if ($Dev) {
    Write-Host "构建 popup bundle（开发版，含 sourcemap）..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build 失败，中止打包" }
} else {
    Write-Host "构建 popup bundle（生产版，压缩）..." -ForegroundColor Yellow
    npm run build:prod
    if ($LASTEXITCODE -ne 0) { throw "npm run build:prod 失败，中止打包" }
}

# ── 路径与版本 ──────────────────────────────────────────────────
$Root    = $PSScriptRoot
$TempDir = Join-Path $Root "build-temp"
$DistDir = Join-Path $Root "dist"
$Version = (Get-Content (Join-Path $Root "manifest.json") -Raw | ConvertFrom-Json).version
$Suffix  = if ($Dev) { "-dev" } else { "" }
$ZipName = "auto-tree-tabs-v$Version$Suffix.zip"
$ZipPath = Join-Path $DistDir $ZipName

# ── 清理 & 创建目录 ─────────────────────────────────────────────
if (Test-Path $TempDir) { Remove-Item $TempDir -Recurse -Force }
New-Item -ItemType Directory -Path $TempDir | Out-Null
New-Item -ItemType Directory -Path $DistDir -Force | Out-Null

# ── 复制扩展文件 ────────────────────────────────────────────────
Write-Host "复制扩展文件..." -ForegroundColor Yellow

Copy-Item (Join-Path $Root "manifest.json") $TempDir
Copy-Item (Join-Path $Root "src")           $TempDir -Recurse

# 复制国际化文件
$LocalesPath = Join-Path $Root "_locales"
if (Test-Path $LocalesPath) {
    Copy-Item $LocalesPath $TempDir -Recurse
} else {
    Write-Warning "_locales 目录不存在，跳过国际化文件"
}

# 复制资源文件
$AssetsPath = Join-Path $Root "assets"
if (Test-Path $AssetsPath) {
    Copy-Item $AssetsPath $TempDir -Recurse
} else {
    Write-Warning "assets 目录不存在，请先生成资源文件"
}

# ── 合并 background 依赖为单文件 ────────────────────────────────
Write-Host "合并 background 依赖为单文件..." -ForegroundColor Yellow

$BgDir = Join-Path $TempDir "src\background"

$BundleFiles = @(
    "PinnedTabPersistentStorage.js",
    "DelayedMergeExecutor.js",
    "SettingsCache.js",
    "StorageManager.js",
    "tools.js",
    "AutoBackTrack.js"
)

# 按依赖顺序拼接所有模块
$BundleContent = $BundleFiles | ForEach-Object {
    Get-Content (Join-Path $BgDir $_) -Raw
}

# 去除 background.js 中的 importScripts 行
$MainBg = Get-Content (Join-Path $BgDir "background.js") |
    Where-Object { $_ -notmatch '^importScripts\(' }

# 合并：模块 bundle + 主脚本（无 importScripts）
$Packed = ($BundleContent + ($MainBg -join "`n")) -join "`n"
Set-Content -Path (Join-Path $BgDir "background.js") -Value $Packed -Encoding UTF8

# 移除已内联的依赖文件
$BundleFiles | ForEach-Object {
    $FilePath = Join-Path $BgDir $_
    if (Test-Path $FilePath) { Remove-Item $FilePath -Force }
}

# ── 清理不需要打包的文件 ────────────────────────────────────────
Write-Host "清理临时文件..." -ForegroundColor Yellow
# 删除 macOS 产生的 .DS_Store 文件
Get-ChildItem $TempDir -Filter ".DS_Store" -Recurse | Remove-Item -Force

# 移除 popup 源模块（popup.js 已包含编译后的所有逻辑）
$PopupModulesDir = Join-Path $TempDir "src\popup\modules"
if (Test-Path $PopupModulesDir) { Remove-Item $PopupModulesDir -Recurse -Force }
$PopupMainJs = Join-Path $TempDir "src\popup\popup-main.js"
if (Test-Path $PopupMainJs) { Remove-Item $PopupMainJs -Force }

# 生产版：移除 sourcemap（开发版保留）
if (-not $Dev) {
    $MapFile = Join-Path $TempDir "src\popup\popup.js.map"
    if (Test-Path $MapFile) { Remove-Item $MapFile -Force }
}

# ── 打包为 ZIP ──────────────────────────────────────────────────
Write-Host "创建 ZIP 包..." -ForegroundColor Yellow

if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }

# 将 TempDir 内的所有内容压缩（不含 TempDir 目录本身）
Compress-Archive -Path "$TempDir\*" -DestinationPath $ZipPath -CompressionLevel Optimal

# ── 清理临时目录 ────────────────────────────────────────────────
Remove-Item $TempDir -Recurse -Force

# ── 完成报告 ────────────────────────────────────────────────────
$SizeKB = [Math]::Round((Get-Item $ZipPath).Length / 1KB, 1)
$Mode   = if ($Dev) { "开发版（含 sourcemap）" } else { "生产版（压缩）" }
Write-Host ""
Write-Host "打包完成！[$Mode]" -ForegroundColor Green
Write-Host "文件位置: $ZipPath"
Write-Host "文件大小: $SizeKB KB"
if (-not $Dev) {
    Write-Host ""
    Write-Host "下一步："
    Write-Host "  1. 登录 Chrome Web Store Developer Dashboard"
    Write-Host "  2. 上传 $ZipName"
    Write-Host "  3. 填写商店信息和截图"
    Write-Host "  4. 提交审核"
    Write-Host ""
    Write-Host "  https://chrome.google.com/webstore/devconsole/"
}


