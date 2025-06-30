import type { Message } from '@renderer/types/newMessage'

import { findImageBlocks, getMainTextContent } from './messageUtils/find'

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

export function escapeDollarNumber(text: string) {
  let escapedText = ''

  for (let i = 0; i < text.length; i += 1) {
    let char = text[i]
    const nextChar = text[i + 1] || ' '

    if (char === '$' && nextChar >= '0' && nextChar <= '9') {
      char = '\\$'
    }

    escapedText += char
  }

  return escapedText
}

export function extractTitle(html: string): string | null {
  if (!html) return null

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

  return null
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

export function withGenerateImage(message: Message): { content: string; images?: string[] } {
  const originalContent = getMainTextContent(message)
  const imagePattern = new RegExp(`!\\[[^\\]]*\\]\\((.*?)\\s*("(?:.*[^"])")?\\s*\\)`)
  const images: string[] = []
  let processedContent: string

  processedContent = originalContent.replace(imagePattern, (_, url) => {
    if (url) {
      images.push(url)
    }
    return ''
  })

  processedContent = processedContent.replace(/\n\s*\n/g, '\n').trim()

  const downloadPattern = /\[[^\]]*\]\((.*?)\s*("(?:.*[^"])")?\s*\)/g
  processedContent = processedContent
    .replace(downloadPattern, '')
    .replace(/\n\s*\n/g, '\n')
    .trim()

  if (images.length > 0) {
    return { content: processedContent, images }
  }

  return { content: originalContent }
}

export function addImageFileToContents(messages: Message[]) {
  const lastAssistantMessage = messages.findLast((m) => m.role === 'assistant')
  if (!lastAssistantMessage) return messages
  const blocks = findImageBlocks(lastAssistantMessage)
  if (!blocks || blocks.length === 0) return messages
  if (blocks.every((v) => !v.metadata?.generateImage)) {
    return messages
  }

  const imageFiles = blocks.map((v) => v.metadata?.generateImage?.images).flat()
  const updatedAssistantMessage = {
    ...lastAssistantMessage,
    images: imageFiles
  }

  return messages.map((message) => (message.id === lastAssistantMessage.id ? updatedAssistantMessage : message))
}

export function formatQuotedText(text: string) {
  return (
    text
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n') + '\n-------------'
  )
}
