import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import removeMarkdown from 'remove-markdown'

/**
 * 递归搜索所有子元素中的 citation
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
 * 转换数学公式格式
 */
export function convertMathFormula(input: string): string {
  if (!input) return input

  let result = input
  result = result.replaceAll('\\[', '$$$$').replaceAll('\\]', '$$$$')
  result = result.replaceAll('\\(', '$$').replaceAll('\\)', '$$')
  return result
}

/**
 * 移除 Markdown 文本中每行末尾的两个空格
 */
export function removeTrailingDoubleSpaces(markdown: string): string {
  return markdown.replace(/ {2}$/gm, '')
}

/**
 * 根据代码块节点的起始位置生成 ID
 * @param start 代码块节点的起始位置
 * @returns 代码块在 Markdown 字符串中的 ID
 */
export function getCodeBlockId(start: any): string | null {
  return start ? `${start.line}:${start.column}:${start.offset}` : null
}

/**
 * 更新Markdown字符串中的代码块内容。
 *
 * 由于使用了remark-stringify，所以会有一些默认格式化操作，例如：
 * - 代码块前后会补充换行符。
 * - 有些空格会被trimmed。
 * - 文档末尾会补充一个换行符。
 *
 * @param raw 原始Markdown字符串
 * @param id 代码块ID，按位置生成
 * @param newContent 修改后的代码内容
 * @returns 替换后的Markdown字符串
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
 * @param code 输入的 PlantUML 图表字符串
 * @returns 有效 true，无效 false
 */
export function isValidPlantUML(code: string | null): boolean {
  if (!code || !code.trim().startsWith('@start')) {
    return false
  }
  const diagramType = code.match(/@start(\w+)/)?.[1]

  return diagramType !== undefined && code.search(`@end${diagramType}`) !== -1
}

/**
 * 将 Markdown 字符串转换为纯文本。
 * @param markdown Markdown 字符串。
 * @returns 纯文本字符串。
 */
export const markdownToPlainText = (markdown: string): string => {
  if (!markdown) {
    return ''
  }
  // 直接用 remove-markdown 库，使用默认的 removeMarkdown 参数
  return removeMarkdown(markdown)
}

/**
 * 清理文本中的特殊字符，使其更适合 TTS 播放
 * @param text 输入文本
 * @returns 清理后的文本
 */
export function cleanTextForTTS(text: string): string {
  if (!text || typeof text !== 'string') {
    return ''
  }

  let cleanText = text

  // 替换常见的 Markdown 符号为更自然的语音
  cleanText = cleanText.replace(/\*\*/g, '') // 移除粗体标记
  cleanText = cleanText.replace(/\*/g, '') // 移除斜体标记
  cleanText = cleanText.replace(/_/g, '') // 移除下划线
  cleanText = cleanText.replace(/~/g, '') // 移除波浪号
  cleanText = cleanText.replace(/`/g, '') // 移除反引号
  cleanText = cleanText.replace(/#/g, '') // 移除井号
  cleanText = cleanText.replace(/>/g, '') // 移除大于号
  cleanText = cleanText.replace(/\|/g, ' ') // 表格分隔符替换为空格

  // 替换特殊符号为更自然的表达
  cleanText = cleanText.replace(/&amp;/g, '和')
  cleanText = cleanText.replace(/&lt;/g, '小于')
  cleanText = cleanText.replace(/&gt;/g, '大于')
  cleanText = cleanText.replace(/&nbsp;/g, ' ')

  // 移除多余的标点符号
  cleanText = cleanText.replace(/[()[\]{}]/g, '') // 移除括号
  cleanText = cleanText.replace(/[""'']/g, '"') // 统一引号

  // 清理多余的空白字符
  cleanText = cleanText.replace(/\s+/g, ' ')
  cleanText = cleanText.replace(/\n+/g, '\n')

  return cleanText.trim()
}

/**
 * 将 Markdown 转换为适合 TTS 播放的纯文本
 * 这是一个组合函数，先转换 Markdown，再清理特殊字符
 * @param markdown Markdown 格式的文本
 * @returns 适合 TTS 播放的纯文本
 */
export function markdownToTTSText(markdown: string): string {
  const plainText = markdownToPlainText(markdown)
  return cleanTextForTTS(plainText)
}