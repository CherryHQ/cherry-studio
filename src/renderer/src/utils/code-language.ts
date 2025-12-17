import { languages } from '@shared/config/languages'

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
