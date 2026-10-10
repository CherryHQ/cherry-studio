import type { Code, Root } from 'mdast'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import removeMarkdown from 'remove-markdown'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'

import { removeSvgEmptyLines } from './formats'
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
 * 代码块按内容定位：渲染用的文本经过分块、引用标签等变换，位置与原始文本对不上，
 * 只有代码内容在两边一致。命中的围栏代码块只替换自身片段，其余文本逐字节保留。
 *
 * 引用块内、与列表标记同行、或缩进式的代码块无法安全地原位替换，退回到 remark-stringify
 * 整篇重排，此时会有默认格式化操作（补充换行符、转义等）。
 *
 * 未加围栏的 HTML 在渲染时被合成为代码块，原始文本里没有对应的 code 节点，
 * 此时按 html 节点的起止边界原位替换。
 *
 * @param raw 原始Markdown字符串
 * @param originalContent 修改前的代码内容，可带渲染时附加的一个末尾换行符
 * @param newContent 修改后的代码内容
 * @returns 替换后的Markdown字符串；找不到或存在多个相同代码块时返回 null
 */
export function updateCodeBlock(raw: string, originalContent: string, newContent: string): string | null {
  const original = originalContent.replace(/\n$/, '')
  const tree = unified().use(remarkParse).parse(raw)
  const matches: Code[] = []
  visit(tree, 'code', (node) => {
    // The renderer strips blank lines inside <svg>, so the rendered text can differ from the source.
    if (node.value === original || removeSvgEmptyLines(node.value) === original) {
      matches.push(node)
    }
  })
  if (matches.length === 0) {
    // Unfenced HTML is rendered as a synthetic code block, so the source only holds html nodes for it.
    const index = raw.indexOf(original)
    const htmlStarts = new Set<number | undefined>()
    const htmlEnds = new Set<number | undefined>()
    visit(tree, 'html', (htmlNode) => {
      htmlStarts.add(htmlNode.position?.start.offset)
      htmlEnds.add(htmlNode.position?.end.offset)
    })
    const isWholeHtmlRange = htmlStarts.has(index) && htmlEnds.has(index + original.length)
    if (!original || index !== raw.lastIndexOf(original) || !isWholeHtmlRange) return null
    return raw.slice(0, index) + newContent + raw.slice(index + original.length)
  }
  if (matches.length !== 1) return null

  const node = matches[0]
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start !== undefined && end !== undefined && (raw[start] === '`' || raw[start] === '~')) {
    const indent = raw.slice(raw.lastIndexOf('\n', start - 1) + 1, start)
    if (indent.trim() === '') {
      const root: Root = { type: 'root', children: [{ ...node, value: newContent }] }
      const fenced = unified().use(remarkStringify).stringify(root).replace(/\n$/, '')
      return raw.slice(0, start) + fenced.replace(/\n(?=[^\n])/g, `\n${indent}`) + raw.slice(end)
    }
  }

  node.value = newContent
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
