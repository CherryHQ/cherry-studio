import { languages } from '@shared/config/languages'

// Cache for extension to language mapping (built lazily)
let extensionToLanguageCache: Map<string, string> | null = null

/**
 * Build a cache mapping extensions to language names
 */
function buildExtensionCache(): Map<string, string> {
  if (extensionToLanguageCache) {
    return extensionToLanguageCache
  }

  extensionToLanguageCache = new Map()
  for (const [langName, data] of Object.entries(languages)) {
    if (data.extensions) {
      for (const ext of data.extensions) {
        // Store without the leading dot, lowercase
        const normalizedExt = ext.startsWith('.') ? ext.slice(1).toLowerCase() : ext.toLowerCase()
        // Only set if not already mapped (first language wins)
        if (!extensionToLanguageCache.has(normalizedExt)) {
          extensionToLanguageCache.set(normalizedExt, langName)
        }
      }
    }
  }
  return extensionToLanguageCache
}

/**
 * 根据文件扩展名获取语言名称
 * @param extension 文件扩展名（带或不带点）
 * @returns 语言名称，如果未找到则返回扩展名本身
 */
export function getLanguageByExtension(extension: string): string {
  if (!extension) return 'text'

  // Normalize extension: remove leading dot and lowercase
  const normalizedExt = extension.startsWith('.') ? extension.slice(1).toLowerCase() : extension.toLowerCase()

  const cache = buildExtensionCache()
  return cache.get(normalizedExt) || normalizedExt
}

/**
 * 根据文件路径获取语言名称
 * @param filePath 文件路径
 * @returns 语言名称
 */
export function getLanguageByFilePath(filePath: string): string {
  if (!filePath) return 'text'

  const ext = filePath.split('.').pop()
  if (!ext) return 'text'

  return getLanguageByExtension(ext)
}

/**
 * 根据语言名称获取文件扩展名
 * - 先精确匹配，再忽略大小写，最后匹配别名
 * - 返回第一个扩展名
 * @param language 语言名称
 * @returns 文件扩展名
 */
export function getExtensionByLanguage(language: string): string {
  const lowerLanguage = language.toLowerCase()

  // 精确匹配语言名称
  const directMatch = languages[language]
  if (directMatch?.extensions?.[0]) {
    return directMatch.extensions[0]
  }

  // 大小写不敏感的语言名称匹配
  for (const [langName, data] of Object.entries(languages)) {
    if (langName.toLowerCase() === lowerLanguage && data.extensions?.[0]) {
      return data.extensions[0]
    }
  }

  // 通过别名匹配
  for (const [, data] of Object.entries(languages)) {
    if (data.aliases?.some((alias) => alias.toLowerCase() === lowerLanguage)) {
      return data.extensions?.[0] || `.${language}`
    }
  }

  // 回退到语言名称
  return `.${language}`
}
