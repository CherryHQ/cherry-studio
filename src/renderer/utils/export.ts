import type { ExportableMessage } from '@renderer/types/messageExport'
import { markdownToPlainText } from '@renderer/utils/markdown'
import { readComposerFileTokenSourceIdFromTokenId } from '@renderer/utils/message/composerFileTokenSource'
import { getComposerTextFromMessage, getComposerTokenClipboardText } from '@renderer/utils/message/composerTokens'
import { getNamingTextContent, getToolCitationExport } from '@renderer/utils/message/find'
import type { ComposerMessageToken } from '@shared/data/types/uiParts'
import { readCherryMeta } from '@shared/data/types/uiParts'
import type { FileUrlString } from '@shared/types/file'
import { fileUrlToPath } from '@shared/utils/file'

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

/**
 * Reads the stored content of every pasted-text file part across the messages,
 * keyed by `fileTokenSourceId`. Pasted-text tokens are the inline-text chips the
 * composer mints for long pastes; copying must reproduce the text the user
 * actually wrote, not the chip's filename. An unreadable file falls back to the
 * token label (the pre-existing behavior).
 */
async function readPastedTextFileContents(messages: readonly ExportableMessage[]): Promise<Map<string, string>> {
  const contents = new Map<string, string>()
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (part.type !== 'file') continue
      const meta = readCherryMeta(part)
      if (meta?.composerFileKind !== 'pasted-text' || !meta.fileTokenSourceId) continue
      if (contents.has(meta.fileTokenSourceId)) continue
      try {
        contents.set(meta.fileTokenSourceId, await window.api.fs.readText(fileUrlToPath(part.url as FileUrlString)))
      } catch {
        // Leave the token's display label as the copy output for this file.
      }
    }
  }
  return contents
}

function createPastedTextTokenTextResolver(
  contents: ReadonlyMap<string, string>
): (token: ComposerMessageToken, index: number) => string {
  return (token) => {
    if (token.kind === 'file') {
      const sourceId = readComposerFileTokenSourceIdFromTokenId(token.id)
      const content = sourceId ? contents.get(sourceId) : undefined
      if (content !== undefined) return content
    }
    return getComposerTokenClipboardText(token)
  }
}

const formatMessageAsPlainText = (
  message: ExportableMessage,
  getTokenText?: (token: ComposerMessageToken, index: number) => string
): string => {
  // Assistant/agent rows lead with the frozen producing author (survives rename/delete), like the header.
  const author = 'messageSnapshot' in message ? message.messageSnapshot : undefined
  const roleText = message.role === 'user' ? 'User:' : `${author?.name ?? 'Assistant'}:`
  const plainTextContent = markdownToPlainText(copyableTextContent(message, getTokenText)).trim()
  return `${roleText}\n${plainTextContent}`
}

/**
 * The message text a copy yields. Uses the gated text (drops error/translation) so
 * copying an errored or translated message gives the clean answer, not an error
 * dump — full-fidelity export keeps `getMainTextContent` instead.
 *
 * `[cite:id]` markers are resolved to plain `[N]` before `markdownToPlainText`
 * runs: left in, `remove-markdown` mangles a chain of them down to a bare
 * `cite:<id>` and the internal id ends up on the clipboard.
 */
const copyableTextContent = (
  message: ExportableMessage,
  getTokenText?: (token: ComposerMessageToken, index: number) => string
): string => {
  const content = getComposerTextFromMessage(message, getNamingTextContent(message), getTokenText)
  return getToolCitationExport(message, content).content
}

export const messageToPlainText = async (message: ExportableMessage): Promise<string> => {
  const contents = await readPastedTextFileContents([message])
  return markdownToPlainText(copyableTextContent(message, createPastedTextTokenTextResolver(contents))).trim()
}

export const messagesToPlainText = async (messages: ExportableMessage[]): Promise<string> => {
  const contents = await readPastedTextFileContents(messages)
  const getTokenText = createPastedTextTokenTextResolver(contents)
  return messages.map((message) => formatMessageAsPlainText(message, getTokenText)).join('\n\n')
}
