import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import removeMarkdown from 'remove-markdown'

/**
 * Recursively search for citation in all child elements
 * @param children Child elements to search
 * @returns Found citation or empty string
 */
export const findCitationInChildren = (children: any): string => {
  if (!children) return ''

  for (const child of Array.isArray(children) ? children : [children]) {
    if (typeof child === 'object' && child?.props?.['data-citation']) {
      return child.props['data-citation']
    }

    if (typeof child === 'object' && child?.props?.children) {
      const found = findCitationInChildren(child.props.children)
      if (found) return found
    }
  }

  return ''
}

/**
 * Convert math formula format from LaTeX to markdown
 * @param input Input string containing LaTeX formulas
 * @returns Converted string with markdown math syntax
 */
export function convertMathFormula(input: string): string {
  if (!input) return input

  let result = input
  result = result.replaceAll('\\[', '$$$$').replaceAll('\\]', '$$$$')
  result = result.replaceAll('\\(', '$$').replaceAll('\\)', '$$')
  return result
}

/**
 * Remove trailing double spaces from each line in Markdown text
 * @param markdown Input Markdown text
 * @returns Processed text without trailing double spaces
 */
export function removeTrailingDoubleSpaces(markdown: string): string {
  return markdown.replace(/ {2}$/gm, '')
}

/**
 * Generate ID based on code block node's starting position
 * @param start Starting position of the code block node
 * @returns Code block ID in the Markdown string
 */
export function getCodeBlockId(start: any): string | null {
  return start ? `${start.line}:${start.column}:${start.offset}` : null
}

/**
 * Update code block content in Markdown string
 * @param raw Original Markdown string
 * @param id Code block ID to update
 * @param newContent New content for the code block
 * @returns Updated Markdown string
 */
export function updateCodeBlock(raw: string, id: string, newContent: string): string {
  const tree = unified().use(remarkParse).parse(raw)
  visit(tree, 'code', (node) => {
    const startIndex = getCodeBlockId(node.position?.start)
    if (startIndex && id && startIndex === id) {
      node.value = newContent
    }
  })

  return unified().use(remarkStringify).stringify(tree)
}

/**
 * 检查是否为有效的 PlantUML 图表
 */
export function isValidPlantUML(code: string | null): boolean {
  if (!code || !code.trim().startsWith('@start')) {
    return false
  }
  const diagramType = code.match(/@start(\w+)/)?.[1]

  return diagramType !== undefined && code.search(`@end${diagramType}`) !== -1
}

/**
/**
 * 将 Markdown 字符串转换为纯文本
 */
export const markdownToPlainText = (markdown: string): string => {
  if (!markdown) {
    return ''
  }
  return removeMarkdown(markdown)
}

/**
 * 清理文本中的特殊字符，使其更适合 TTS 播放
 */
export function cleanTextForTTS(text: string): string {
  if (!text || typeof text !== 'string') {
    return ''
  }

  let cleanText = text

  cleanText = cleanText.replace(/\*\*/g, '')
  cleanText = cleanText.replace(/\*/g, '')
  cleanText = cleanText.replace(/_/g, '')
  cleanText = cleanText.replace(/~/g, '')
  cleanText = cleanText.replace(/`/g, '')
  cleanText = cleanText.replace(/#/g, '')
  cleanText = cleanText.replace(/>/g, '')
  cleanText = cleanText.replace(/\|/g, ' ')

  cleanText = cleanText.replace(/&amp;/g, '和')
  cleanText = cleanText.replace(/&lt;/g, '小于')
  cleanText = cleanText.replace(/&gt;/g, '大于')
  cleanText = cleanText.replace(/&nbsp;/g, ' ')

  cleanText = cleanText.replace(/[()[\]{}]/g, '')
  cleanText = cleanText.replace(/[""'']/g, '"')

  cleanText = cleanText.replace(/\s+/g, ' ')
  cleanText = cleanText.replace(/\n+/g, '\n')

  return cleanText.trim()
}

/**
 * 将 Markdown 转换为适合 TTS 播放的纯文本
 */
export function markdownToTTSText(markdown: string): string {
  const plainText = markdownToPlainText(markdown)
  return cleanTextForTTS(plainText)
}
