import type { ExportableMessage } from '@renderer/types/messageExport'
import { markdownToPlainText } from '@renderer/utils/markdown'
import { getComposerTextFromMessage } from '@renderer/utils/message/composerTokens'
import { getNamingTextContent } from '@renderer/utils/message/find'

/**
 * 从消息内容中提取标题，限制长度并处理换行和标点符号。用于导出功能。
 * @param {string} str 输入字符串
 * @param {number} [length=80] 标题最大长度，默认为 80
 * @returns {string} 提取的标题
 */
export function getTitleFromString(str: string, length: number = 80): string {
  let title = str.trimStart().split('\n')[0]

  if (title.includes('。')) {
    title = title.split('。')[0]
  } else if (title.includes('，')) {
    title = title.split('，')[0]
  } else if (title.includes('.')) {
    title = title.split('.')[0]
  } else if (title.includes(',')) {
    title = title.split(',')[0]
  }

  if (title.length > length) {
    title = title.slice(0, length)
  }

  if (!title) {
    title = str.slice(0, length)
  }

  return title
}

/**
 * 处理文本中的引用标记
 * @param content 原始文本内容
 * @param mode 处理模式：'remove' 移除引用，'normalize' 标准化为Markdown格式
 * @returns 处理后的文本
 */
export const processCitations = (content: string, mode: 'remove' | 'normalize' = 'remove'): string => {
  // 使用正则表达式匹配Markdown代码块
  const codeBlockRegex = /(```[a-zA-Z]*\n[\s\S]*?\n```)/g
  const parts = content.split(codeBlockRegex)

  const processedParts = parts.map((part, index) => {
    // 如果是代码块(奇数索引),则原样返回
    if (index % 2 === 1) {
      return part
    }

    let result = part

    if (mode === 'remove') {
      // 移除各种形式的引用标记
      result = result
        .replace(/\[<sup[^>]*data-citation[^>]*>\d+<\/sup>\]\([^)]*\)/g, '')
        .replace(/\[<sup[^>]*>\d+<\/sup>\]\([^)]*\)/g, '')
        .replace(/<sup[^>]*data-citation[^>]*>\d+<\/sup>/g, '')
        .replace(/\[(\d+)\](?!\()/g, '')
    } else if (mode === 'normalize') {
      // 标准化引用格式为Markdown脚注格式
      result = result
        // 将 [<sup data-citation='...'>数字</sup>](链接) 转换为 [^数字]
        .replace(/\[<sup[^>]*data-citation[^>]*>(\d+)<\/sup>\]\([^)]*\)/g, '[^$1]')
        // 将 [<sup>数字</sup>](链接) 转换为 [^数字]
        .replace(/\[<sup[^>]*>(\d+)<\/sup>\]\([^)]*\)/g, '[^$1]')
        // 将独立的 <sup data-citation='...'>数字</sup> 转换为 [^数字]
        .replace(/<sup[^>]*data-citation[^>]*>(\d+)<\/sup>/g, '[^$1]')
        // 将 [数字] 转换为 [^数字]（但要小心不要转换其他方括号内容）
        .replace(/\[(\d+)\](?!\()/g, '[^$1]')
    }

    // 按行处理，保留Markdown结构
    const lines = result.split('\n')
    const processedLines = lines.map((line) => {
      // 如果是引用块或其他特殊格式，不要修改空格
      if (line.match(/^>|^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|^\s{4,}/)) {
        return line.replace(/[ ]+/g, ' ').replace(/[ ]+$/g, '')
      }
      // 普通文本行，清理多余空格但保留基本格式
      return line.replace(/[ ]+/g, ' ').trim()
    })

    return processedLines.join('\n')
  })

  return processedParts.join('').trim()
}

const formatMessageAsPlainText = (message: ExportableMessage): string => {
  const roleText = message.role === 'user' ? 'User:' : 'Assistant:'
  // Copy path: use the gated text (drops error/translation) so copying an
  // errored or translated message yields the clean answer, not an error dump.
  // Full-fidelity export keeps `getMainTextContent`.
  const content = getComposerTextFromMessage(message, getNamingTextContent(message))
  const plainTextContent = markdownToPlainText(content).trim()
  return `${roleText}\n${plainTextContent}`
}

export const messageToPlainText = (message: ExportableMessage): string => {
  // Copy path — gated, see `formatMessageAsPlainText`.
  const content = getComposerTextFromMessage(message, getNamingTextContent(message))
  return markdownToPlainText(content).trim()
}

export const messagesToPlainText = (messages: ExportableMessage[]): string => {
  return messages.map(formatMessageAsPlainText).join('\n\n')
}
