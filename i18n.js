// ===================
// 国际化辅助函数
// ===================

/**
 * 国际化工具类
 * 提供简洁的API来获取本地化文本
 */
class I18n {
  /**
   * 获取本地化文本
   * @param {string} key - 消息键名
   * @param {Array} substitutions - 替换参数（可选）
   * @returns {string} 本地化后的文本
   */
  static getMessage(key, substitutions = null) {
    try {
      return chrome.i18n.getMessage(key, substitutions);
    } catch (error) {
      console.warn(`I18n: Failed to get message for key "${key}":`, error);
      return key; // 返回键名作为备用
    }
  }

  /**
   * 获取当前语言代码
   * @returns {string} 语言代码，如 'en', 'zh-CN', 'zh-TW', 'ja', 'ko'
   */
  static getCurrentLanguage() {
    return chrome.i18n.getUILanguage();
  }

  /**
   * 检查是否为中文环境
   * @returns {boolean} 是否为中文
   */
  static isChinese() {
    const lang = this.getCurrentLanguage();
    return lang.startsWith('zh');
  }

  /**
   * 检查是否为亚洲语言环境
   * @returns {boolean} 是否为亚洲语言
   */
  static isAsianLanguage() {
    const lang = this.getCurrentLanguage();
    return ['zh', 'ja', 'ko'].some(prefix => lang.startsWith(prefix));
  }

  /**
   * 获取本地化的计数文本
   * @param {string} key - 基础键名
   * @param {number} count - 数量
   * @returns {string} 本地化的计数文本
   */
  static getCountMessage(key, count) {
    if (count === 1 && !this.isAsianLanguage()) {
      // 英文单数形式
      return this.getMessage(key.replace('s', ''));
    }
    return this.getMessage(key, [count.toString()]);
  }

  /**
   * 初始化页面的国际化文本
   * 自动替换页面中所有带有 data-i18n 属性的元素
   */
  static initializePageI18n() {
    // 替换文本内容
    document.querySelectorAll('[data-i18n]').forEach(element => {
      const key = element.getAttribute('data-i18n');
      const message = this.getMessage(key);
      if (message) {
        element.textContent = message;
      }
    });

    // 替换占位符
    document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
      const key = element.getAttribute('data-i18n-placeholder');
      const message = this.getMessage(key);
      if (message) {
        element.placeholder = message;
      }
    });

    // 替换标题
    document.querySelectorAll('[data-i18n-title]').forEach(element => {
      const key = element.getAttribute('data-i18n-title');
      const message = this.getMessage(key);
      if (message) {
        element.title = message;
      }
    });

    // 替换aria-label
    document.querySelectorAll('[data-i18n-aria]').forEach(element => {
      const key = element.getAttribute('data-i18n-aria');
      const message = this.getMessage(key);
      if (message) {
        element.setAttribute('aria-label', message);
      }
    });
  }
}

// 简化的全局函数
window.i18n = I18n.getMessage.bind(I18n);
window.initI18n = I18n.initializePageI18n.bind(I18n);

// 导出供其他模块使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = I18n;
}

console.log('🌍 I18n module loaded. Current language:', I18n.getCurrentLanguage());
