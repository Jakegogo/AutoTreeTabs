// 内容脚本
console.log('Auto Tree Tabs content script loaded');

// 防抖函数（用于滚动事件）- 性能优化版本
function debounceScroll(func, wait) {
  let timeout = null;
  return function executedFunction(...args) {
    // 如果定时器已存在，直接返回，不创建新的定时器
    if (timeout !== null) {
      return;
    }
    
    timeout = setTimeout(() => {
      func(...args);
      timeout = null; // 执行完成后清空定时器
    }, wait);
  };
}

// 滚动位置管理
class ScrollPositionManager {
  constructor() {
    this.isRestored = false;
    this.currentUrl = window.location.href;
    console.log('📜 ScrollPositionManager initialized for:', this.currentUrl);
    this.init();
  }

  init() {
    // 页面加载完成后，检查是否为激活标签页，只有激活时才恢复滚动位置
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => this.checkAndRestoreScrollPosition(), 100);
      });
    } else {
      setTimeout(() => this.checkAndRestoreScrollPosition(), 100);
    }

    // 页面卸载前保存滚动位置
    window.addEventListener('beforeunload', () => {
      // 页面卸载时强制保存，无论是否可见
      this.performScrollSave('page unloading');
    });

    // 监听页面可见性变化
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // 标签页变为后台时，强制保存当前滚动位置（在变为隐藏之前）
        this.saveScrollPositionOnHide();
      } else {
        // 页面变为可见时（标签页激活），恢复滚动位置
        if (!this.isRestored) {
          setTimeout(() => this.restoreScrollPosition(), 50);
        }
      }
    });
  }

  // 检查标签页激活状态并恢复滚动位置
  async checkAndRestoreScrollPosition() {
    console.log('📜 checkAndRestoreScrollPosition called, document.hidden:', document.hidden);
    try {
      // 检查页面可见性
      if (document.hidden) {
        console.log('📜 Page is hidden, deferring scroll restoration until visible');
        // 不绑定滚动监听器，等待页面变为可见时再处理
        return;
      }
      
      console.log('📜 Page is visible, proceeding with scroll restoration');
      // 页面可见，恢复滚动位置
      await this.restoreScrollPosition();
    } catch (error) {
      console.log('❌ Error in checkAndRestoreScrollPosition:', error.message);
      // 即使检查失败，也要绑定滚动监听器确保功能可用
      if (!this.isRestored) {
        this.isRestored = true;
        this.bindScrollListener();
      }
    }
  }

  // 简化的滚动位置恢复（最多3次尝试）
  smartRestoreScrollPosition(position) {
    let attempts = 0;
    const maxAttempts = 3; // 最多尝试3次
    const retryInterval = 300; // 每300ms尝试一次
    let userScrolled = false;
    
    // 监听用户手动滚动
    const userScrollHandler = () => {
      userScrolled = true;
      console.log('📜 User scrolled manually, terminating auto restoration');
      window.removeEventListener('scroll', userScrollHandler);
    };
    
    const tryRestore = () => {
      attempts++;
      
      // 如果用户已经手动滚动，终止尝试
      if (userScrolled) {
        console.log('📜 Restoration terminated by user scroll');
        this.isRestored = true;
        this.bindScrollListener();
        return;
      }
      
      // 检查页面是否仍然激活
      if (document.hidden) {
        console.log('📜 Page became hidden during restoration, skipping');
        window.removeEventListener('scroll', userScrollHandler);
        this.isRestored = true;
        this.bindScrollListener();
        return;
      }
      
      // 获取当前页面高度
      const documentHeight = Math.max(
        document.body.scrollHeight || 0,
        document.documentElement.scrollHeight || 0
      );
      
      console.log(`📜 Attempt ${attempts}: height=${documentHeight}, target=${position.scrollTop}`);
      
      // 执行恢复
      window.scrollTo({
        top: position.scrollTop,
        left: position.scrollLeft || 0,
        behavior: 'instant'
      });
      
      // 检查页面高度是否还在变化
      setTimeout(() => {
        if (userScrolled) {
          console.log('📜 User scrolled during check, terminating');
          this.isRestored = true;
          this.bindScrollListener();
          return;
        }
        
        const newHeight = Math.max(
          document.body.scrollHeight || 0,
          document.documentElement.scrollHeight || 0
        );
        
        const heightChanged = newHeight !== documentHeight;
        const shouldRetry = heightChanged && attempts < maxAttempts;
        
        if (shouldRetry) {
          console.log(`📜 Page height changed (${documentHeight} → ${newHeight}), retrying...`);
          setTimeout(tryRestore, retryInterval);
        } else {
          // 完成恢复
          console.log(`📜 Scroll restoration completed (attempt ${attempts}):`, position);
          window.removeEventListener('scroll', userScrollHandler);
          this.isRestored = true;
          this.bindScrollListener();
        }
      }, 100);
    };
    
    // 绑定用户滚动监听器
    window.addEventListener('scroll', userScrollHandler, { passive: true });
    
    // 开始第一次尝试
    setTimeout(tryRestore, 200);
  }

  // 绑定滚动事件监听器（在位置恢复后调用）
  bindScrollListener() {
    // 监听滚动事件，保存滚动位置
    const debouncedSave = debounceScroll(() => {
      this.saveScrollPosition();
    }, 500); // 500ms防抖

    window.addEventListener('scroll', debouncedSave, { passive: true });
    console.log('📜 Scroll listener bound after position restore');
  }

  async restoreScrollPosition() {
    if (this.isRestored) {
      console.log('📜 restoreScrollPosition: already restored, skipping');
      return;
    }

    console.log('📜 restoreScrollPosition: starting for URL:', this.currentUrl);

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        console.log('📜 Requesting scroll position from background...');
        const position = await chrome.runtime.sendMessage({
          action: 'getScrollPosition',
          url: this.currentUrl
        });

        console.log('📜 Received position from background:', position);

        if (position && position.scrollTop !== undefined) {
          console.log('📜 Valid position found, starting smart restore...');
          // 简化的智能恢复
          this.smartRestoreScrollPosition(position);
        } else {
          console.log('📜 No saved position found, binding scroll listener directly');
          // 没有保存的位置，直接绑定滚动监听器
          this.isRestored = true;
          this.bindScrollListener();
        }
      } else {
        console.log('📜 Chrome extension context not available');
        this.isRestored = true;
        this.bindScrollListener();
      }
    } catch (error) {
      console.log('❌ Extension context error in scroll restore:', error.message);
      // 即使恢复失败，也要绑定滚动监听器
      if (!this.isRestored) {
        this.isRestored = true;
        this.bindScrollListener();
      }
    }
  }

  saveScrollPosition() {
    try {
      // 检查页面可见性，只有可见的标签页才保存滚动位置
      if (document.hidden) {
        console.log('📜 Skipping scroll save for hidden page');
        return;
      }
      
      this.performScrollSave('visible page scroll');
    } catch (error) {
      console.log('Extension context error in scroll save:', error.message);
    }
  }

  // 标签页变为隐藏时强制保存滚动位置
  saveScrollPositionOnHide() {
    try {
      this.performScrollSave('page becoming hidden');
    } catch (error) {
      console.log('Extension context error in scroll save on hide:', error.message);
    }
  }

  // 执行实际的滚动位置保存
  performScrollSave(reason) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        const position = {
          scrollTop: window.pageYOffset || document.documentElement.scrollTop,
          scrollLeft: window.pageXOffset || document.documentElement.scrollLeft
        };

        // 只有当滚动位置不为0时才保存
        if (position.scrollTop > 0 || position.scrollLeft > 0) {
          chrome.runtime.sendMessage({
            action: 'saveScrollPosition',
            url: this.currentUrl,
            position: position
          }).catch(error => {
            console.log('Extension context error in scroll save:', error.message);
          });
          console.log(`📜 Saved scroll position (${reason}): ${this.currentUrl}`, position);
        }
      }
    } catch (error) {
      console.log('Extension context error in performScrollSave:', error.message);
    }
  }
}

// 调试助手函数
window.debugScrollManager = {
  getInfo: () => {
    return {
      currentUrl: window.location.href,
      scrollTop: window.pageYOffset || document.documentElement.scrollTop,
      scrollLeft: window.pageXOffset || document.documentElement.scrollLeft,
      documentHeight: Math.max(
        document.body.scrollHeight || 0,
        document.documentElement.scrollHeight || 0
      ),
      windowHeight: window.innerHeight,
      isHidden: document.hidden,
      readyState: document.readyState
    };
  },
  
  testRestore: async () => {
    console.log('🔧 Testing scroll position restore...');
    try {
      const position = await chrome.runtime.sendMessage({
        action: 'getScrollPosition',
        url: window.location.href
      });
      console.log('🔧 Stored position:', position);
      return position;
    } catch (error) {
      console.log('🔧 Test error:', error.message);
      return null;
    }
  },
  
  forceSave: () => {
    console.log('🔧 Forcing scroll position save...');
    const position = {
      scrollTop: window.pageYOffset || document.documentElement.scrollTop,
      scrollLeft: window.pageXOffset || document.documentElement.scrollLeft
    };
    chrome.runtime.sendMessage({
      action: 'saveScrollPosition',
      url: window.location.href,
      position: position
    }).then(() => {
      console.log('🔧 Forced save completed:', position);
    }).catch(error => {
      console.log('🔧 Forced save error:', error.message);
    });
  }
};

// 初始化滚动位置管理器（同步检查设置）
async function initializeScrollManager() {
  try {
    // 同步检查滚动位置恢复设置
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      const result = await chrome.runtime.sendMessage({ 
        action: 'isFeatureEnabled', 
        feature: 'restoreScroll' 
      });
      
      if (result && result.enabled === false) {
        console.log('📜 Scroll position restore is disabled, skipping ScrollPositionManager initialization');
        return;
      }
    }
    
    // 设置启用，初始化管理器
    const scrollManager = new ScrollPositionManager();
    console.log('📜 ScrollPositionManager successfully initialized');
  } catch (error) {
    console.log('❌ Error initializing scroll position manager:', error.message);
  }
}

// 启动初始化
initializeScrollManager();
