import { languages } from '@shared/config/languages'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import removeMarkdown from 'remove-markdown'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'

/**
 * 更彻底的查找方法，递归搜索所有子元素
 * @param {any} children 子元素
 * @returns {string} 找到的 citation 或 ''
 */
export const findCitationInChildren = (children: any): string => {
  if (!children) return ''

  // 直接搜索子元素
  for (const child of Array.isArray(children) ? children : [children]) {
    if (typeof child === 'object' && child?.props?.['data-citation']) {
      return child.props['data-citation']
    }

    // 递归查找更深层次
    if (typeof child === 'object' && child?.props?.children) {
      const found = findCitationInChildren(child.props.children)
      if (found) return found
    }
  }

  return ''
}

// 检查是否包含潜在的 LaTeX 模式
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
 * @param text 输入的 Markdown 文本
 * @returns 处理后的字符串
 */
export const processLatexBrackets = (text: string) => {
  // 没有 LaTeX 模式直接返回
  if (!containsLatexRegex.test(text)) {
    return text
  }

  // 保护代码块和链接
  const protectedItems: string[] = []
  let processedContent = text

  processedContent = processedContent
    // 保护代码块（包括多行代码块和行内代码）
    .replace(/(```[\s\S]*?```|`[^`]*`)/g, (match) => {
      const index = protectedItems.length
      protectedItems.push(match)
      return `__CHERRY_STUDIO_PROTECTED_${index}__`
    })
    // 保护链接 [text](url)
    .replace(/\[([^[\]]*(?:\[[^\]]*\][^[\]]*)*)\]\([^)]*?\)/g, (match) => {
      const index = protectedItems.length
      protectedItems.push(match)
      return `__CHERRY_STUDIO_PROTECTED_${index}__`
    })

  // LaTeX 括号转换函数
  const processMath = (content: string, openDelim: string, closeDelim: string, wrapper: string): string => {
    let result = ''
    let remaining = content

    while (remaining.length > 0) {
      const match = findLatexMatch(remaining, openDelim, closeDelim)
      if (!match) {
        result += remaining
        break
      }

      result += match.pre
      result += `${wrapper}${match.body}${wrapper}`
      remaining = match.post
    }

    return result
  }

  // 先处理块级公式，再处理内联公式
  let result = processMath(processedContent, '\\[', '\\]', '$$')
  result = processMath(result, '\\(', '\\)', '$')

  // 还原被保护的内容
  result = result.replace(/__CHERRY_STUDIO_PROTECTED_(\d+)__/g, (match, indexStr) => {
    const index = parseInt(indexStr, 10)
    // 添加边界检查，防止数组越界
    if (index >= 0 && index < protectedItems.length) {
      return protectedItems[index]
    }
    // 如果索引无效，保持原始匹配
    return match
  })

  return result
}

/**
 * 查找 LaTeX 数学公式的匹配括号对
 *
 * 使用平衡括号算法处理嵌套结构，正确识别转义字符
 *
 * @param text 要搜索的文本
 * @param openDelim 开始分隔符 (如 '\[' 或 '\(')
 * @param closeDelim 结束分隔符 (如 '\]' 或 '\)')
 * @returns 匹配结果对象或 null
 */
const findLatexMatch = (text: string, openDelim: string, closeDelim: string) => {
  // 统计连续反斜杠：奇数个表示转义，偶数个表示未转义
  const escaped = (i: number) => {
    let count = 0
    while (--i >= 0 && text[i] === '\\') count++
    return count & 1
  }

  // 查找第一个有效的开始标记
  for (let i = 0, n = text.length; i <= n - openDelim.length; i++) {
    // 没有找到开始分隔符或被转义，跳过
    if (!text.startsWith(openDelim, i) || escaped(i)) continue

    // 处理嵌套结构
    for (let j = i + openDelim.length, depth = 1; j <= n - closeDelim.length && depth; j++) {
      // 计算当前位置对深度的影响：+1(开始), -1(结束), 0(无关)
      const delta =
        text.startsWith(openDelim, j) && !escaped(j) ? 1 : text.startsWith(closeDelim, j) && !escaped(j) ? -1 : 0

      if (delta) {
        depth += delta

        // 找到了匹配的结束位置
        if (!depth)
          return {
            start: i,
            end: j + closeDelim.length,
            pre: text.slice(0, i),
            body: text.slice(i + openDelim.length, j),
            post: text.slice(j + closeDelim.length)
          }

        // 跳过已处理的分隔符字符，避免重复检查
        j += (delta > 0 ? openDelim : closeDelim).length - 1
      }
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
  if (!input) return input

  let result = input
  result = result.replaceAll('\\[', '$$$$').replaceAll('\\]', '$$$$')
  result = result.replaceAll('\\(', '$$').replaceAll('\\)', '$$')
  return result
}

/**
 * 移除 Markdown 文本中每行末尾的两个空格。
 * @param {string} markdown 输入的 Markdown 文本
 * @returns {string} 处理后的文本
 */
export function removeTrailingDoubleSpaces(markdown: string): string {
  // 使用正则表达式匹配末尾的两个空格，并替换为空字符串
  return markdown.replace(/ {2}$/gm, '')
}

/**
 * 根据语言名称获取文件扩展名
 * - 先精确匹配，再忽略大小写，最后匹配别名
 * - 返回第一个扩展名
 * @param language 语言名称
 * @returns 文件扩展名
 */
export function getExtensionByLanguage(language: string): string {
  const lowerLanguage = language.toLowerCase()

  // 精确匹配语言名称
  const directMatch = languages[language]
  if (directMatch?.extensions?.[0]) {
    return directMatch.extensions[0]
  }

  // 大小写不敏感的语言名称匹配
  for (const [langName, data] of Object.entries(languages)) {
    if (langName.toLowerCase() === lowerLanguage && data.extensions?.[0]) {
      return data.extensions[0]
    }
  }

  // 通过别名匹配
  for (const [, data] of Object.entries(languages)) {
    if (data.aliases?.some((alias) => alias.toLowerCase() === lowerLanguage)) {
      return data.extensions?.[0] || `.${language}`
    }
  }

  // 回退到语言名称
  return `.${language}`
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
 * 检查代码是否具有HTML特征
 * @param code 输入的代码字符串
 * @returns 是HTML代码 true，否则 false
 */
export function isHtmlCode(code: string | null): boolean {
  if (!code || !code.trim()) {
    return false
  }

  const trimmedCode = code.trim()

  // 检查是否包含HTML文档类型声明
  if (trimmedCode.includes('<!DOCTYPE html>') || trimmedCode.includes('<!doctype html>')) {
    return true
  }

  // 检查是否包含html标签
  if (trimmedCode.includes('<html') || trimmedCode.includes('</html>')) {
    return true
  }

  // 检查是否包含head标签
  if (trimmedCode.includes('<head>') || trimmedCode.includes('</head>')) {
    return true
  }

  // 检查是否包含body标签
  if (trimmedCode.includes('<body') || trimmedCode.includes('</body>')) {
    return true
  }

  // 检查是否以HTML标签开头和结尾的完整HTML结构
  const htmlTagPattern = /^\s*<html[^>]*>[\s\S]*<\/html>\s*$/i
  if (htmlTagPattern.test(trimmedCode)) {
    return true
  }

  return false
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
