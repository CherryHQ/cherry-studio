/**
 * 搜索结果适配器
 * 将不同 Provider 的搜索结果统一转换为 Citation 格式
 */

import type { Citation, WebSearchProviderResult } from '@renderer/types'

/**
 * 将 WebSearchProviderResult 转换为 Citation
 * 自动识别并处理不同 Provider 的额外字段
 *
 * @param result - 搜索结果（可能包含 Provider 特定字段）
 * @param index - 结果序号（从0开始）
 * @returns Citation 对象
 */
export function adaptSearchResultToCitation(result: WebSearchProviderResult, index: number): Citation {
  // 基础字段（所有 Provider 都有）
  const citation: Citation = {
    number: index + 1,
    url: result.url,
    title: result.title,
    content: result.content,
    showFavicon: true,
    type: 'websearch'
  }

  // Exa Provider 特定字段
  if ('favicon' in result && result.favicon) {
    citation.favicon = result.favicon
  }

  // 收集元数据
  const metadata: Record<string, any> = {}

  // Exa 元数据
  if ('publishedDate' in result && result.publishedDate) {
    metadata.publishedDate = result.publishedDate
  }

  if ('author' in result && result.author) {
    metadata.author = result.author
  }

  if ('score' in result && result.score !== undefined) {
    metadata.score = result.score
  }

  if ('highlights' in result && result.highlights && result.highlights.length > 0) {
    metadata.highlights = result.highlights
  }

  // Tavily 元数据
  if ('answer' in result && result.answer) {
    metadata.answer = result.answer
  }

  if ('images' in result && result.images && result.images.length > 0) {
    metadata.images = result.images
  }

  // 只在有元数据时添加
  if (Object.keys(metadata).length > 0) {
    citation.metadata = metadata
  }

  return citation
}

/**
 * 批量转换搜索结果为 Citations
 *
 * @param results - 搜索结果数组
 * @returns Citation 数组
 */
export function adaptSearchResultsToCitations(results: WebSearchProviderResult[]): Citation[] {
  return results.map((result, index) => adaptSearchResultToCitation(result, index))
}
