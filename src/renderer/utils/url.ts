export function getUrlOriginOrFallback(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

/**
 * 检查 URL 是否是有效的代理 URL。
 * @param {string} url 代理 URL
 * @returns {boolean} 是否有效
 */
export const isValidProxyUrl = (url: string): boolean => {
  return url.includes('://')
}

/**
 * 检查字符串是否是可解析的 http(s) URL。
 * @param {string} value URL 字符串
 * @returns {boolean} 是否是有效的 http/https URL
 */
export const isValidHttpUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
