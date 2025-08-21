// ===================
// 国际化完整性验证脚本  
// ===================

const fs = require('fs');
const path = require('path');

/**
 * 验证所有语言包的完整性
 */
function validateI18nFiles() {
  const localesDir = '_locales';
  const languages = ['en', 'zh_CN', 'zh_TW', 'ja', 'ko'];
  
  console.log('🌍 开始验证国际化文件完整性...\n');
  
  // 读取基准语言包(英文)
  const enPath = path.join(localesDir, 'en', 'messages.json');
  if (!fs.existsSync(enPath)) {
    console.error('❌ 英文基准语言包不存在！');
    return false;
  }
  
  const enMessages = JSON.parse(fs.readFileSync(enPath, 'utf8'));
  const enKeys = Object.keys(enMessages);
  
  console.log(`📋 基准语言包(英文)包含 ${enKeys.length} 个键值\n`);
  
  let allValid = true;
  
  // 验证每个语言包
  for (const lang of languages) {
    const langPath = path.join(localesDir, lang, 'messages.json');
    
    if (!fs.existsSync(langPath)) {
      console.error(`❌ ${lang} 语言包不存在！`);
      allValid = false;
      continue;
    }
    
    const langMessages = JSON.parse(fs.readFileSync(langPath, 'utf8'));
    const langKeys = Object.keys(langMessages);
    
    console.log(`🔍 验证 ${lang} 语言包:`);
    console.log(`   包含 ${langKeys.length} 个键值`);
    
    // 检查缺失的键
    const missingKeys = enKeys.filter(key => !langKeys.includes(key));
    if (missingKeys.length > 0) {
      console.log(`   ⚠️  缺失 ${missingKeys.length} 个键值:`);
      missingKeys.forEach(key => console.log(`      - ${key}`));
      allValid = false;
    }
    
    // 检查多余的键
    const extraKeys = langKeys.filter(key => !enKeys.includes(key));
    if (extraKeys.length > 0) {
      console.log(`   ℹ️  额外 ${extraKeys.length} 个键值:`);
      extraKeys.forEach(key => console.log(`      + ${key}`));
    }
    
    // 检查空的翻译
    const emptyKeys = langKeys.filter(key => {
      const message = langMessages[key]?.message;
      return !message || message.trim() === '';
    });
    if (emptyKeys.length > 0) {
      console.log(`   ⚠️  空的翻译 ${emptyKeys.length} 个:`);
      emptyKeys.forEach(key => console.log(`      - ${key}`));
      allValid = false;
    }
    
    if (missingKeys.length === 0 && emptyKeys.length === 0) {
      console.log(`   ✅ ${lang} 语言包完整`);
    }
    
    console.log('');
  }
  
  // 生成统计报告
  console.log('📊 统计报告:');
  console.log(`   基准键值数量: ${enKeys.length}`);
  
  for (const lang of languages) {
    const langPath = path.join(localesDir, lang, 'messages.json');
    if (fs.existsSync(langPath)) {
      const langMessages = JSON.parse(fs.readFileSync(langPath, 'utf8'));
      const coverage = (Object.keys(langMessages).length / enKeys.length * 100).toFixed(1);
      console.log(`   ${lang}: ${Object.keys(langMessages).length} 键值 (${coverage}% 覆盖率)`);
    }
  }
  
  console.log('\n' + (allValid ? '✅ 所有语言包验证通过！' : '❌ 发现问题，请检查上述警告'));
  
  return allValid;
}

/**
 * 查找代码中使用的i18n键值
 */
function findUsedKeys() {
  const sourceFiles = ['popup.js', 'options.js', 'popup.html', 'options.html'];
  const usedKeys = new Set();
  
  console.log('\n🔍 扫描代码中使用的i18n键值...\n');
  
  for (const file of sourceFiles) {
    if (!fs.existsSync(file)) {
      console.log(`⚠️  文件不存在: ${file}`);
      continue;
    }
    
    const content = fs.readFileSync(file, 'utf8');
    
    // 匹配 i18n('key') 调用
    const i18nMatches = content.match(/i18n\(['"`]([^'"`]+)['"`]\)/g);
    if (i18nMatches) {
      i18nMatches.forEach(match => {
        const key = match.match(/i18n\(['"`]([^'"`]+)['"`]\)/)[1];
        usedKeys.add(key);
      });
    }
    
    // 匹配 data-i18n="key" 属性
    const dataI18nMatches = content.match(/data-i18n(?:-\w+)?=['"`]([^'"`]+)['"`]/g);
    if (dataI18nMatches) {
      dataI18nMatches.forEach(match => {
        const key = match.match(/data-i18n(?:-\w+)?=['"`]([^'"`]+)['"`]/)[1];
        usedKeys.add(key);
      });
    }
    
    console.log(`📄 ${file}: 找到 ${i18nMatches?.length || 0} 个 i18n 调用, ${dataI18nMatches?.length || 0} 个 data-i18n 属性`);
  }
  
  console.log(`\n📋 代码中总共使用了 ${usedKeys.size} 个不同的键值:\n`);
  Array.from(usedKeys).sort().forEach(key => console.log(`   - ${key}`));
  
  return usedKeys;
}

/**
 * 检查未使用的键值
 */
function checkUnusedKeys() {
  const usedKeys = findUsedKeys();
  const enPath = path.join('_locales', 'en', 'messages.json');
  
  if (!fs.existsSync(enPath)) {
    console.error('❌ 英文语言包不存在！');
    return;
  }
  
  const enMessages = JSON.parse(fs.readFileSync(enPath, 'utf8'));
  const definedKeys = new Set(Object.keys(enMessages));
  
  const unusedKeys = Array.from(definedKeys).filter(key => !usedKeys.has(key));
  const missingKeys = Array.from(usedKeys).filter(key => !definedKeys.has(key));
  
  console.log('\n🧹 键值使用情况分析:\n');
  
  if (unusedKeys.length > 0) {
    console.log(`📦 未使用的键值 (${unusedKeys.length} 个):`);
    unusedKeys.forEach(key => console.log(`   - ${key}`));
    console.log('');
  }
  
  if (missingKeys.length > 0) {
    console.log(`❌ 缺失的键值 (${missingKeys.length} 个):`);
    missingKeys.forEach(key => console.log(`   - ${key}`));
    console.log('');
  }
  
  if (unusedKeys.length === 0 && missingKeys.length === 0) {
    console.log('✅ 所有键值都有对应的使用！');
  }
}

// 主函数
function main() {
  console.log('🌍 Auto Tree Tabs 国际化验证工具\n');
  console.log('='.repeat(50));
  
  // 验证语言包完整性
  const isValid = validateI18nFiles();
  
  console.log('='.repeat(50));
  
  // 检查键值使用情况
  checkUnusedKeys();
  
  console.log('='.repeat(50));
  console.log(isValid ? '🎉 验证完成！' : '⚠️  发现问题，请检查上述报告');
}

// 如果作为脚本运行
if (require.main === module) {
  main();
}

module.exports = {
  validateI18nFiles,
  findUsedKeys,
  checkUnusedKeys
};
