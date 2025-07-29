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

/**
 * 使用 Round Robin 策略从引用中选择指定数量的项目
 * 按照原始搜索结果的顺序轮询选择，确保每个源都有机会被选中
 *
 * @param rawResults 原始搜索结果，用于确定轮询顺序
 * @param references 所有可选的引用项目
 * @param maxRefs 最大选择数量
 * @returns 按 Round Robin 策略选择的引用数组
 */
export function selectReferences(
  rawResults: WebSearchProviderResult[],
  references: KnowledgeReference[],
  maxRefs: number
): KnowledgeReference[] {
  if (maxRefs <= 0 || references.length === 0) {
    return []
  }

  // 建立URL到索引的映射，用于确定轮询顺序
  const urlToIndex = new Map<string, number>()
  rawResults.forEach((result, index) => {
    urlToIndex.set(result.url, index)
  })

  // 按sourceUrl分组references，每组内按原顺序保持（已按分数排序）
  const groupsByUrl = new Map<string, KnowledgeReference[]>()
  references.forEach((ref) => {
    if (!groupsByUrl.has(ref.sourceUrl)) {
      groupsByUrl.set(ref.sourceUrl, [])
    }
    groupsByUrl.get(ref.sourceUrl)!.push(ref)
  })

  // 获取有效的URL列表，按rawResults顺序排序
  const availableUrls = Array.from(groupsByUrl.keys())
    .filter((url) => urlToIndex.has(url))
    .sort((a, b) => urlToIndex.get(a)! - urlToIndex.get(b)!)

  if (availableUrls.length === 0) {
    return []
  }

  // Round Robin 选择
  const selected: KnowledgeReference[] = []
  let roundIndex = 0

  while (selected.length < maxRefs && availableUrls.length > 0) {
    const currentUrl = availableUrls[roundIndex]
    const group = groupsByUrl.get(currentUrl)!

    if (group.length > 0) {
      selected.push(group.shift()!)
    }

    // 如果当前组为空，从可用URL列表中移除
    if (group.length === 0) {
      availableUrls.splice(roundIndex, 1)
      // 调整索引，避免跳过下一个URL
      if (roundIndex >= availableUrls.length) {
        roundIndex = 0
      }
    } else {
      roundIndex = (roundIndex + 1) % availableUrls.length
    }
  }

  return selected
}
