/**
 * HTML实体编码辅助函数
 * @param str 输入字符串
 * @returns string 编码后的字符串
 */
export const encodeHTML = (str: string) => {
  return str.replace(/[&<>"']/g, (match) => {
    const entities: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;'
    }
    return entities[match]
  })
}

/**
 * 清理Markdown内容
 * @param text 要清理的文本
 * @returns 清理后的文本
 */
export function cleanMarkdownContent(text: string): string {
  if (!text) return ''
  let cleaned = text.replace(/!\[.*?]\(.*?\)/g, '') // 移除图片
  cleaned = cleaned.replace(/\[(.*?)]\(.*?\)/g, '$1') // 替换链接为纯文本
  cleaned = cleaned.replace(/https?:\/\/\S+/g, '') // 移除URL
  cleaned = cleaned.replace(/[-—–_=+]{3,}/g, ' ') // 替换分隔符为空格
  cleaned = cleaned.replace(/[￥$€£¥%@#&*^()[\]{}<>~`'"\\|/_.]+/g, '') // 移除特殊字符
  cleaned = cleaned.replace(/\s+/g, ' ').trim() // 规范化空白
  return cleaned
}

export function extractHtmlTitle(html: string): string {
  if (!html) return ''

  // 处理标准闭合的标题标签
  const titleRegex = /<title>(.*?)<\/title>/i
  const match = html.match(titleRegex)

  if (match) {
    return match[1] ? match[1].trim() : ''
  }

  // 处理未闭合的标题标签
  const malformedTitleRegex = /<title>(.*?)($|<(?!\/title))/i
  const malformedMatch = html.match(malformedTitleRegex)

  if (malformedMatch) {
    return malformedMatch[1] ? malformedMatch[1].trim() : ''
  }

  return ''
}

/**
 * 从 HTML 标题中提取文件名（不包含扩展名）
 * @param title HTML 标题
 * @returns 文件名
 */
export function getFileNameFromHtmlTitle(title: string): string {
  if (!title) return ''
  return title.replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, '-')
}

export function removeSvgEmptyLines(text: string): string {
  // 用正则表达式匹配 <svg> 标签内的内容
  const svgPattern = /(<svg[\s\S]*?<\/svg>)/g

  return text.replace(svgPattern, (svgMatch) => {
    // 将 SVG 内容按行分割,过滤掉空行,然后重新组合
    return svgMatch
      .split('\n')
      .filter((line) => line.trim() !== '')
      .join('\n')
  })
}

export function formatQuotedText(text: string) {
  return '<blockquote>\n\n' + text + '\n</blockquote>\n'
}
