// ===================
// 文件类型检测系统
// ===================

/**
 * 文件类型配置
 * 每个文件类型包含：检测规则、图标文件名、显示名称、样式配置
 */
export const FILE_TYPE_CONFIG = {
  pdf: {
    extensions: ['.pdf'],
    protocols: ['file://', 'chrome-extension://'],
    icon: 'assets/icon-pdf.svg',
    title: 'pdfFile',
    bgColor: 'transparent'
  },
  html: {
    extensions: ['.html', '.htm'],
    protocols: ['file://', 'chrome-extension://'],
    icon: 'assets/icon-html.svg',
    title: 'htmlFile',
    bgColor: 'transparent'
  },
  png: {
    extensions: ['.png'],
    protocols: ['file://', 'chrome-extension://'],
    icon: 'assets/icon-png.svg',
    title: 'imageFile',
    bgColor: 'transparent'
  },
  jpg: {
    extensions: ['.jpg', '.jpeg'],
    protocols: ['file://', 'chrome-extension://'],
    icon: 'assets/icon-jpg.svg',
    title: 'imageFile',
    bgColor: 'transparent'
  },
  svg: {
    extensions: ['.svg'],
    protocols: ['file://', 'chrome-extension://'],
    icon: 'assets/icon-svg.svg',
    title: 'imageFile',
    bgColor: 'transparent'
  },
  markdown: {
    extensions: ['.md', '.markdown'],
    protocols: ['file://', 'chrome-extension://'],
    icon: 'assets/icon-md.svg',
    title: 'markdownFile',
    bgColor: 'transparent'
  },
};

/**
 * 检测URL是否为特定文件类型
 * @param {string} url - 要检测的URL
 * @returns {string|null} 文件类型名称，如果不匹配则返回null
 */
export function detectFileType(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  // 解码URL以处理编码的字符（如中文路径）
  // 注意：某些页面/本地路径可能包含非法的 "%" 编码，decodeURIComponent 会抛 URIError。
  // 这里做容错，避免单个异常 URL 导致整棵树渲染/初始化中断（进而影响 tagSuggestions 等 UI）。
  let decodedUrl = url;
  try {
    decodedUrl = decodeURIComponent(url);
  } catch {
    decodedUrl = url;
  }
  const lowerUrl = decodedUrl.toLowerCase();

  // 遍历所有文件类型配置
  for (const [fileType, config] of Object.entries(FILE_TYPE_CONFIG)) {
    // 检查是否有匹配的协议
    const hasMatchingProtocol = config.protocols.some(protocol =>
      lowerUrl.includes(protocol.toLowerCase())
    );

    // 检查是否有匹配的扩展名
    const hasMatchingExtension = config.extensions.some(ext =>
      lowerUrl.includes(ext.toLowerCase())
    );

    if (hasMatchingProtocol && hasMatchingExtension) {
      return fileType;
    }
  }

  return null;
}

/**
 * 获取文件类型配置
 * @param {string} fileType - 文件类型名称
 * @returns {object|null} 文件类型配置对象
 */
export function getFileTypeConfig(fileType) {
  return FILE_TYPE_CONFIG[fileType] || null;
}

/**
 * 检测是否为PDF文件（保持向后兼容）
 * @param {string} url - 要检测的URL
 * @returns {boolean} 是否为PDF文件
 */
export function isPdfUrl(url) {
  return detectFileType(url) === 'pdf';
}
