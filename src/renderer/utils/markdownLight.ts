import type { Point } from 'unist'

/**
 * 更彻底的查找方法，递归搜索所有子元素
 * @param {any} children 子元素
 * @returns {string} 找到的 citation 或 ''
 */
export const findCitationInChildren = (children: any): string => {
  if (!children) return ''

  for (const child of Array.isArray(children) ? children : [children]) {
    if (typeof child === 'object' && child?.props?.['data-citation']) return child.props['data-citation']
    if (typeof child === 'object' && child?.props?.children) {
      const found = findCitationInChildren(child.props.children)
      if (found) return found
    }
  }

  return ''
}

const containsLatexRegex = /\\\(.*?\\\)|\\\[.*?\\\]/s

/**
 * 转换 LaTeX 公式括号 `\[\]` 和 `\(\)` 为 Markdown 格式 `$$...$$` 和 `$...$`
 *
 * remark-math 本身不支持 LaTeX 原生语法，作为替代的一些插件效果也不理想。
 *
 * 目前的实现：
 * - 保护代码块和链接，避免被 remark-math 处理
 * - 支持嵌套括号的平衡匹配
 * - 转义括号 `\\(\\)` 或 `\\[\\]` 不会被处理
 *
 * @see https://github.com/remarkjs/remark-math/issues/39
 */
export const processLatexBrackets = (text: string) => {
  if (!containsLatexRegex.test(text)) return text

  const protectedItems: string[] = []
  let processedContent = text
    .replace(/(```[\s\S]*?```|`[^`]*`)/g, (match) => {
      const index = protectedItems.length
      protectedItems.push(match)
      return `__CHERRY_STUDIO_PROTECTED_${index}__`
    })
    .replace(/\[([^[\]]*(?:\[[^\]]*\][^[\]]*)*)\]\([^)]*?\)/g, (match) => {
      const index = protectedItems.length
      protectedItems.push(match)
      return `__CHERRY_STUDIO_PROTECTED_${index}__`
    })

  const processMath = (content: string, openDelim: string, closeDelim: string, wrapper: string): string => {
    let result = ''
    let remaining = content
    while (remaining.length > 0) {
      const match = findLatexMatch(remaining, openDelim, closeDelim)
      if (!match) return result + remaining
      result += `${match.pre}${wrapper}${match.body}${wrapper}`
      remaining = match.post
    }
    return result
  }

  processedContent = processMath(processedContent, '\\[', '\\]', '$$')
  processedContent = processMath(processedContent, '\\(', '\\)', '$')
  return processedContent.replace(/__CHERRY_STUDIO_PROTECTED_(\d+)__/g, (match, indexValue) => {
    const item = protectedItems[Number.parseInt(indexValue, 10)]
    return item ?? match
  })
}

/**
 * 查找 LaTeX 数学公式的匹配括号对。使用平衡括号算法处理嵌套结构，正确识别转义字符。
 */
function findLatexMatch(text: string, openDelim: string, closeDelim: string) {
  const escaped = (index: number) => {
    let count = 0
    while (--index >= 0 && text[index] === '\\') count += 1
    return count & 1
  }

  for (let index = 0; index <= text.length - openDelim.length; index += 1) {
    if (!text.startsWith(openDelim, index) || escaped(index)) continue

    for (let cursor = index + openDelim.length, depth = 1; cursor <= text.length - closeDelim.length; cursor += 1) {
      const delta =
        text.startsWith(openDelim, cursor) && !escaped(cursor)
          ? 1
          : text.startsWith(closeDelim, cursor) && !escaped(cursor)
            ? -1
            : 0
      if (!delta) continue
      depth += delta
      if (!depth) {
        return {
          pre: text.slice(0, index),
          body: text.slice(index + openDelim.length, cursor),
          post: text.slice(cursor + closeDelim.length)
        }
      }
      cursor += (delta > 0 ? openDelim : closeDelim).length - 1
    }
  }
  return null
}

/**
 * 转换数学公式格式：
 * - 将 LaTeX 格式的 '\\[' 和 '\\]' 转换为 '$$$$'。
 * - 将 LaTeX 格式的 '\\(' 和 '\\)' 转换为 '$$'。
 * @param {string} input 输入字符串
 * @returns {string} 转换后的字符串
 */
export function convertMathFormula(input: string): string {
  return input
    ? input.replaceAll('\\[', '$$$$').replaceAll('\\]', '$$$$').replaceAll('\\(', '$$').replaceAll('\\)', '$$')
    : input
}

/**
 * 移除 Markdown 文本中每行末尾的两个空格。
 * @param {string} markdown 输入的 Markdown 文本
 * @returns {string} 处理后的文本
 */
export function removeTrailingDoubleSpaces(markdown: string): string {
  return markdown.replace(/ {2}$/gm, '')
}

/**
 * 根据代码块节点的起始位置生成 ID
 * @param start 代码块节点的起始位置
 * @returns 代码块在 Markdown 字符串中的 ID
 */
export function getCodeBlockId(start?: Point): string | null {
  return start ? `${start.line}:${start.column}:${start.offset}` : null
}

/**
 * 检查代码是否具有HTML特征
 * @param code 输入的代码字符串
 * @returns 是HTML代码 true，否则 false
 */
export function isHtmlCode(code: string | null): boolean {
  if (!code?.trim()) return false
  const html = code.trim().toLowerCase()
  if (
    ['<!doctype html>', '<html', '</html>', '<head', '</head>', '<body', '</body>'].some((marker) =>
      html.includes(marker)
    )
  ) {
    return true
  }
  if (
    [
      '<div',
      '<span',
      '<p',
      '<a',
      '<img',
      '<svg',
      '<table',
      '<ul',
      '<ol',
      '<section',
      '<header',
      '<footer',
      '<nav',
      '<article',
      '<button',
      '<form',
      '<input'
    ].some((tag) => html.includes(tag))
  ) {
    return true
  }
  return /<([a-z0-9]+)([^>]*?)>(.*?)<\/\1>|<([a-z0-9]+)([^>]*?)\/>/.test(html)
}

/**
 * 清理 Markdown 中的 base64 图片链接
 *
 * 将 Markdown 中的 base64 格式图片链接替换为普通链接格式。
 *
 * @param {string} markdown - 包含图片链接的 Markdown 文本
 * @returns {string} 处理后的 Markdown 文本，所有 base64 图片链接都被替换为普通链接
 * @example
 * - 输入: `![image](data:image/png;base64,iVBORw0...)`
 * - 输出: `![image](image_url)`
 */
export function purifyMarkdownImages(markdown: string): string {
  return markdown.replace(
    /(!\[[^\]]*\]\()\s*data:image\/[\w+.-]+;base64\s*,[\w+/=]+(?:\s*[\w+/=]+)*\s*\)/gi,
    '$1image_url)'
  )
}
