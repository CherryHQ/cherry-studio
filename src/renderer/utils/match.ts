import { matchesSearchText } from '@renderer/utils/pinyin'

/**
 * 判断一个字符串是否包含由另一个字符串表示的 keywords
 * 将 keywords 按空白字符分割成多个关键词，检查目标字符串是否包含所有关键词
 * - 大小写不敏感
 * - 支持的分隔符：空格、制表符、换行符等各种空白字符
 *
 * @param target 被搜索的字符串
 * @param keywords 关键词字符串（空格分隔）或关键词数组
 * @returns 包含所有关键词或者没有有效关键词则返回 true
 */
export function includeKeywords(target: string, keywords: string | string[]): boolean {
  const keywordArray = Array.isArray(keywords) ? keywords : (keywords || '').split(/\s+/)
  const nonEmptyKeywords = keywordArray.filter(Boolean)

  // 如果没有有效关键词，则视为匹配
  if (nonEmptyKeywords.length === 0) return true

  // 如果没有搜索目标，则视为不匹配
  if (!target || typeof target !== 'string') return false
  const targetLower = target.toLowerCase()

  return nonEmptyKeywords.every((keyword) => matchesSearchText(targetLower, keyword))
}

/**
 * 检查字符串是否包含所有关键词
 * @see includeKeywords
 * @param keywords 关键词字符串（空格分隔）或关键词数组
 * @param value 被搜索的目标字符串
 * @returns 包含所有关键词则返回 true
 */
export function matchKeywordsInString(keywords: string | string[], value: string): boolean {
  return includeKeywords(value, keywords)
}
