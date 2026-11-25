import { parseCustomProxyUrl } from '@shared/utils/proxyUrl'

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
export const isValidProxyUrl = (url: string): boolean => parseCustomProxyUrl(url) !== null
