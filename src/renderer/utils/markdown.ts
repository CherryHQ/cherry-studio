import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import removeMarkdown from 'remove-markdown'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'

import { getCodeBlockId } from './markdownLight'
import { remarkLatexMath } from './remarkLatexMath'

// The lightweight Markdown chunk owns the transforms both runtimes need; this module adds only the
// helpers that pull in remark/remove-markdown.
export {
  findCitationInChildren,
  getCodeBlockId,
  isHtmlCode,
  purifyMarkdownImages,
  removeTrailingDoubleSpaces
} from './markdownLight'

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

const latexMathParser = unified().use(remarkParse).use(remarkLatexMath).freeze()

/**
 * Rewrite `\(…\)` / `\[…\]` as `$…$` / `$$…$$` exactly where the chat renders a formula. The
 * formulas are located with the chat's own LaTeX parser, so code, link text and unbalanced
 * delimiters stay as written, and nothing else in the source is re-serialized.
 */
export function convertLatexMathToDollars(markdown: string): string {
  if (!markdown.includes('\\(') && !markdown.includes('\\[')) return markdown

  const tree = latexMathParser.runSync(latexMathParser.parse(markdown), markdown)
  let cursor = 0
  let result = ''
  visit(tree, ['inlineMath', 'math'], (node) => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) return

    const raw = markdown.slice(start, end)
    const open = raw.search(/\S/)
    const dollars = raw.startsWith('\\(', open) ? '$' : raw.startsWith('\\[', open) ? '$$' : undefined
    const close = raw.lastIndexOf(dollars === '$' ? '\\)' : '\\]')
    if (!dollars || close < open + 2) return

    result += markdown.slice(cursor, start + open) + dollars + raw.slice(open + 2, close) + dollars
    cursor = start + close + 2
  })

  return result + markdown.slice(cursor)
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
