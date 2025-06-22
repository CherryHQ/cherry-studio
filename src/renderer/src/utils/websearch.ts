import { KnowledgeReference, WebSearchProviderResult } from '@renderer/types'

/**
 * 将检索到的知识片段按源URL整合为搜索结果
 *
 * 这个函数接收原始搜索结果和从知识库检索到的相关片段，
 * 将同源的片段按URL分组并合并为最终的搜索结果。
 *
 * @param rawResults 原始搜索结果，用于提供标题和URL信息
 * @param references 从知识库检索到的相关片段
 * @param separator 合并片段时使用的分隔符，默认为 '\n\n---\n\n'
 * @returns 合并后的搜索结果数组
 */
export function consolidateReferencesByUrl(
  rawResults: WebSearchProviderResult[],
  references: KnowledgeReference[],
  separator: string = '\n\n---\n\n'
): WebSearchProviderResult[] {
  // 创建URL到原始结果的映射，用于快速查找
  const urlToOriginalResult = new Map(rawResults.map((result) => [result.url, result]))

  // 使用 reduce 进行分组和内容收集
  const sourceGroups = references.reduce((groups, reference) => {
    const originalResult = urlToOriginalResult.get(reference.sourceUrl)
    if (!originalResult) return groups

    const existing = groups.get(reference.sourceUrl)
    if (existing) {
      // 如果已存在该URL的分组，直接添加内容
      existing.contents.push(reference.content)
    } else {
      // 创建新的分组
      groups.set(reference.sourceUrl, {
        originalResult,
        contents: [reference.content]
      })
    }
    return groups
  }, new Map<string, { originalResult: WebSearchProviderResult; contents: string[] }>())

  // 转换为最终结果
  return Array.from(sourceGroups.values(), (group) => ({
    title: group.originalResult.title,
    url: group.originalResult.url,
    content: group.contents.join(separator)
  }))
}
