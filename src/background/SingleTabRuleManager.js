// 单标签规则管理器：为指定域名/路径模式限制只打开一个标签页
// pattern 支持通配符 *，可匹配域名和可选路径前缀
// 示例：github.com / *.google.com / github.com/orgs/*

const STORAGE_KEY = 'singleTabRules';

export class SingleTabRuleManager {
  /** 从 storage 加载规则列表 */
  async getRules() {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    return result[STORAGE_KEY] || [];
  }

  /** 保存规则列表到 storage */
  async _saveRules(rules) {
    await chrome.storage.local.set({ [STORAGE_KEY]: rules });
  }

  /** 添加规则，返回 true 成功 / false 已存在 */
  async addRule(pattern) {
    const rules = await this.getRules();
    if (rules.some(r => r.pattern === pattern)) return false;
    rules.push({
      id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      pattern,
      enabled: true,
      createdAt: Date.now(),
    });
    await this._saveRules(rules);
    return true;
  }

  /** 删除规则 */
  async removeRule(id) {
    const rules = await this.getRules();
    const next = rules.filter(r => r.id !== id);
    if (next.length === rules.length) return false;
    await this._saveRules(next);
    return true;
  }

  /** 更新规则（部分字段） */
  async updateRule(id, patch) {
    const rules = await this.getRules();
    const idx = rules.findIndex(r => r.id === id);
    if (idx === -1) return false;
    rules[idx] = { ...rules[idx], ...patch };
    await this._saveRules(rules);
    return true;
  }

  /** 从 URL 提取默认 pattern（主机名，含非标准端口） */
  static extractDefaultPattern(url) {
    try {
      return new URL(url).host; // host = hostname:port（标准端口 80/443 不显示）
    } catch {
      return null;
    }
  }

  /**
   * 检查 URL 是否匹配任意已启用规则
   * @param {string} url
   * @param {Array} [rules] 可选预加载的规则数组，减少重复 storage 查询
   * @returns 匹配到的规则对象，或 null
   */
  matchUrlToRule(url, rules) {
    if (!Array.isArray(rules)) return null;
    for (const rule of rules) {
      if (!rule.enabled) continue;
      if (this.matchPattern(rule.pattern, url)) return rule;
    }
    return null;
  }

  /** 检查 URL 是否匹配指定 pattern */
  matchPattern(pattern, url) {
    try {
      if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
      const urlObj = new URL(url);
      // host 含端口（非标准端口时），如 localhost:3000 或 example.com
      const urlHost = urlObj.host;
      if (pattern.includes('/')) {
        const slashIdx = pattern.indexOf('/');
        const patternHost = pattern.slice(0, slashIdx);
        const patternPath = pattern.slice(slashIdx);
        // 通配符前的路径部分用于前缀匹配
        const pathPrefix = patternPath.replace(/\*.*$/, '');
        return (
          this._matchGlob(patternHost, urlHost) &&
          urlObj.pathname.startsWith(pathPrefix)
        );
      } else {
        return this._matchGlob(pattern, urlHost);
      }
    } catch {
      return false;
    }
  }

  /** glob 通配符匹配（* 匹配任意字符序列） */
  _matchGlob(pattern, str) {
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    return new RegExp(`^${regexStr}$`).test(str);
  }
}
