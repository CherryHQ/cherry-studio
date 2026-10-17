/**
 * 检查 URL 是否是有效的代理 URL。
 * @param {string} url 代理 URL
 * @returns {boolean} 是否有效
 */
export const isValidProxyUrl = (url: string): boolean => {
  return url.includes('://')
}
