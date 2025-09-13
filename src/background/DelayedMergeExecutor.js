// 通用延迟合并调用工具类
class DelayedMergeExecutor {
  constructor(delay = 500) {
    this.delay = delay;
    this.eventQueue = [];
    this.timer = null;
  }

  /**
   * 添加延迟执行事件
   * @param {Function} func - 要执行的函数
   * @param {Array} args - 函数参数
   * @param {string} key - 事件唯一标识（可选，用于去重）
   */
  addEvent(func, args = [], key = null) {
    const event = {
      func,
      args,
      key,
      timestamp: Date.now()
    };

    // 如果有key，先移除队列中的相同key事件（去重）
    if (key) {
      this.eventQueue = this.eventQueue.filter(e => e.key !== key);
    }

    // 添加新事件到队列
    this.eventQueue.push(event);
    
    console.log(`📝 Added delayed event (queue size: ${this.eventQueue.length})`);

    // 如果没有定时器，设置定时器
    if (!this.timer) {
      this.scheduleExecution();
    }
  }

  /**
   * 调度执行
   */
  scheduleExecution() {
    this.timer = setTimeout(() => {
      this.executeEvents();
    }, this.delay);
    
    console.log(`⏰ Scheduled execution in ${this.delay}ms`);
  }

  /**
   * 执行事件队列
   */
  executeEvents() {
    console.log(`🚀 Executing delayed events (queue size: ${this.eventQueue.length})`);
    
    // 清除定时器
    this.timer = null;

    // 如果队列为空，不执行任何操作
    if (this.eventQueue.length === 0) {
      console.log('📭 Event queue is empty, no execution');
      return;
    }

    // 如果只有一个事件，直接执行并清空队列
    if (this.eventQueue.length === 1) {
      const event = this.eventQueue[0];
      this.eventQueue = [];
      
      try {
        console.log(`✅ Executing single event`);
        event.func.apply(null, event.args);
      } catch (error) {
        console.error('Error executing delayed event:', error);
      }
      return;
    }

    // 如果有多个事件，执行倒数第二个，保留最后一个
    const eventToExecute = this.eventQueue[this.eventQueue.length - 2];
    const lastEvent = this.eventQueue[this.eventQueue.length - 1];
    
    // 清空队列，只保留最后一个事件
    this.eventQueue = [lastEvent];
    
    try {
      console.log(`✅ Executing second-to-last event (keeping last in queue)`);
      eventToExecute.func.apply(null, eventToExecute.args);
    } catch (error) {
      console.error('Error executing delayed event:', error);
    }

    // 如果队列还有事件，设置下一次定时器
    if (this.eventQueue.length > 0) {
      console.log(`🔄 Queue not empty, scheduling next execution`);
      this.scheduleExecution();
    }
  }

  /**
   * 立即执行所有事件并清空队列
   */
  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    while (this.eventQueue.length > 0) {
      const event = this.eventQueue.shift();
      try {
        event.func.apply(null, event.args);
      } catch (error) {
        console.error('Error flushing delayed event:', error);
      }
    }
  }

  /**
   * 清空队列但不执行
   */
  clear() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.eventQueue = [];
    console.log('🗑️ Delayed event queue cleared');
  }
}


