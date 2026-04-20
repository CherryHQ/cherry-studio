import type { GroundingSupport } from '@google/genai'
import type { Citation, WebSearchSource } from '@renderer/types'
import { WEB_SEARCH_SOURCE } from '@renderer/types'

import { cleanMarkdownContent, encodeHTML } from './formats'

/**
 * 从多个 citationReference 中获取第一个有效的 source
 * @returns WebSearchSource
 */
export function determineCitationSource(
  citationReferences: Array<{ citationBlockId?: string; citationBlockSource?: WebSearchSource }> | undefined
): WebSearchSource | undefined {
  // 从 citationReferences 获取第一个有效的 source
  if (citationReferences?.length) {
    const validReference = citationReferences.find((ref) => ref.citationBlockSource)
    return validReference?.citationBlockSource
  }

  return undefined
}

/**
 * 把文本内容中的引用标记转换为完整的引用标签
 * - 标准化引用标记
 * - 转换标记为用于渲染的标签
 *
 * @param content 原始文本内容
 * @param citations 原始引用列表
 * @param sourceType 引用来源类型
 * @returns 处理后的文本内容
 */
export function withCitationTags(content: string, citations: Citation[], sourceType?: WebSearchSource): string {
  if (!content || citations.length === 0) return content

  const formattedCitations = citations.map((citation) => ({
    ...citation,
    content: citation.content ? cleanMarkdownContent(citation.content) : citation.content
  }))

  const citationMap = new Map(formattedCitations.map((c) => [c.number, c]))

  const normalizedContent = normalizeCitationMarks(content, citationMap, sourceType)

  return mapCitationMarksToTags(normalizedContent, citationMap)
}

/**
 * 标准化引用标记，统一转换为 [cite:N] 格式：
 * - OpenAI 格式: [<sup>N</sup>](url) → [cite:N]
 * - Gemini 格式: 根据metadata添加 [cite:N]
 * - 其他格式: [N] → [cite:N]
 *
 * 算法：
 * - one pass + 正则替换
 * - 跳过代码块等特殊上下文
 *
 * @param content 原始文本内容
 * @param citationMap 引用映射表
 * @param sourceType 引用来源类型
 * @returns 标准化后的文本内容
 */
export function normalizeCitationMarks(
  content: string,
  citationMap: Map<number, Citation>,
  sourceType?: WebSearchSource
): string {
  // 识别需要跳过的代码区域，注意：indented code block已被禁用，不需要跳过
  const codeBlockRegex = /```[\s\S]*?```|`[^`\n]*`/gm
  const skipRanges: Array<{ start: number; end: number }> = []

  let match
  while ((match = codeBlockRegex.exec(content)) !== null) {
    skipRanges.push({
      start: match.index,
      end: match.index + match[0].length
    })
  }

  // 检查位置是否在代码块内
  const shouldSkip = (pos: number): boolean => {
    for (const range of skipRanges) {
      if (pos >= range.start && pos < range.end) return true
      if (range.start > pos) break // 已排序，可以提前结束
    }
    return false
  }

  // 统一的替换函数
  const applyReplacements = (regex: RegExp, getReplacementFn: (match: RegExpExecArray) => string | null) => {
    const replacements: Array<{ start: number; end: number; replacement: string }> = []

    regex.lastIndex = 0 // 重置正则状态
    let match: RegExpExecArray | null
    while ((match = regex.exec(content)) !== null) {
      if (!shouldSkip(match.index)) {
        const replacement = getReplacementFn(match)
        if (replacement !== null) {
          replacements.push({
            start: match.index,
            end: match.index + match[0].length,
            replacement
          })
        }
      }
    }

    // 从后往前替换避免位置偏移
    replacements.reverse().forEach(({ start, end, replacement }) => {
      content = content.slice(0, start) + replacement + content.slice(end)
    })
  }

  switch (sourceType) {
    case WEB_SEARCH_SOURCE.OPENAI:
    case WEB_SEARCH_SOURCE.OPENAI_RESPONSE:
    case WEB_SEARCH_SOURCE.PERPLEXITY: {
      // OpenAI 格式: [<sup>N</sup>](url) → [cite:N]
      applyReplacements(/\[<sup>(\d+)<\/sup>\]\([^)]*\)/g, (match) => {
        const citationNum = parseInt(match[1], 10)
        return citationMap.has(citationNum) ? `[cite:${citationNum}]` : null
      })
      break
    }
    case WEB_SEARCH_SOURCE.GEMINI: {
      // Gemini 格式: 根据 startIndex/endIndex 精确插入 [cite:N]
      // 注意: Gemini API 的 endIndex 是 UTF-8 字节偏移，需要转换为字符偏移
      const firstCitation = Array.from(citationMap.values())[0]
      if (firstCitation?.metadata) {
        const encoder = new TextEncoder()
        const contentBytes = encoder.encode(content)

        // 将 UTF-8 字节偏移转换为 JS 字符偏移
        const byteOffsetToCharOffset = (byteOffset: number): number => {
          const decoder = new TextDecoder()
          return decoder.decode(contentBytes.slice(0, byteOffset)).length
        }

        // 收集所有需要插入的位置和标签
        const insertions: Array<{ position: number; tag: string }> = []

        firstCitation.metadata.forEach((support: GroundingSupport) => {
          if (!support.groundingChunkIndices || !support.segment) return
          const { endIndex } = support.segment
          if (endIndex == null) return

          const tag = support.groundingChunkIndices
            .map((citationNum) => {
              const citation = citationMap.get(citationNum + 1)
              return citation ? `[cite:${citationNum + 1}]` : ''
            })
            .filter(Boolean)
            .join('')

          if (tag) {
            const charPos = byteOffsetToCharOffset(endIndex)
            insertions.push({ position: charPos, tag })
          }
        })

        // 按位置降序排列，从后往前插入避免偏移
        insertions.sort((a, b) => b.position - a.position)

        for (const { position, tag } of insertions) {
          if (!shouldSkip(position)) {
            content = content.slice(0, position) + tag + content.slice(position)
          }
        }
      }
      break
    }
    case WEB_SEARCH_SOURCE.GROK: {
      // Grok 格式: [[N]](url) → [cite:N]
      applyReplacements(/\[\[(\d+)\]\]\([^)]*\)/g, (match) => {
        const citationNum = parseInt(match[1], 10)
        return citationMap.has(citationNum) ? `[cite:${citationNum}]` : null
      })
      break
    }
    default: {
      // 简单数字格式: [N] → [cite:N]
      applyReplacements(/\[(\d+)\]/g, (match) => {
        const citationNum = parseInt(match[1], 10)
        return citationMap.has(citationNum) ? `[cite:${citationNum}]` : null
      })
    }
  }

  return content
}

/**
 * 把文本内容中的 [cite:N] 标记转换为用于渲染的标签
 * @param content 原始文本内容
 * @param citationMap 引用映射表
 * @returns 处理后的文本内容
 */
export function mapCitationMarksToTags(content: string, citationMap: Map<number, Citation>): string {
  // 统一替换所有 [cite:N] 标记
  return content.replace(/\[cite:(\d+)\]/g, (match, num) => {
    const citationNum = parseInt(num, 10)
    const citation = citationMap.get(citationNum)

    if (citation) {
      return generateCitationTag(citation)
    }

    // 如果没找到对应的引用数据，保持原样（应该不会发生）
    return match
  })
}

/**
 * 生成单个用于渲染的引用标签
 * @param citation 引用数据
 * @returns 渲染后的引用标签
 */
export function generateCitationTag(citation: Citation): string {
  const supData = {
    id: citation.number,
    url: citation.url,
    title: citation.title || citation.hostname || '',
    content: citation.content?.substring(0, 200)
  }
  // encodeHTML only escapes &, <, >, ", ' — also escape | to prevent GFM table
  // parser from treating it as a column separator inside table cells
  const citationJson = encodeHTML(JSON.stringify(supData)).replace(/\|/g, '&#124;')

  // 判断是否为有效链接
  const isLink = citation.url && citation.url.startsWith('http')

  // Escape | in URL to avoid breaking GFM table cell parsing
  const safeUrl = isLink ? citation.url.replace(/\|/g, '%7C') : ''

  // 生成链接格式: [<sup data-citation='...'>N</sup>](url)
  // 或者生成空括号格式: [<sup data-citation='...'>N</sup>]()
  return `[<sup data-citation='${citationJson}'>${citation.number}</sup>]` + (isLink ? `(${safeUrl})` : '()')
}
