/**
 * 判断一个字符串是否包含由另一个字符串表示的 keywords
 * 将 keywords 按空白字符分割成多个关键词，检查目标字符串是否包含所有关键词
 * - 大小写不敏感
 * - 支持的分隔符：空格、制表符、换行符等各种空白字符
 *
 * @param target 被搜索的字符串
 * @param search 搜索词（用空白字符分隔）
 */
export function includeKeywords(target: string, search: string): boolean {
  if (!search?.trim()) return true
  if (!target) return false

  const targetLower = target.toLowerCase()
  const searchLower = search.toLowerCase()

  const keywords = searchLower.split(/\s+/).filter((keyword) => keyword.trim())

  return keywords.every((keyword) => targetLower.includes(keyword))
}
