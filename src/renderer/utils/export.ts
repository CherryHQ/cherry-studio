import { fromMarkdown } from 'mdast-util-from-markdown'
import { visit } from 'unist-util-visit'

import type { ExportableMessage } from '@renderer/types/messageExport'
import { markdownToPlainText } from '@renderer/utils/markdown'
import { readComposerFileTokenSourceIdFromTokenId } from '@renderer/utils/message/composerFileTokenSource'
import { getComposerTextFromMessage, getComposerTokenClipboardText } from '@renderer/utils/message/composerTokens'
import { getNamingTextContent, getToolCitationExport } from '@renderer/utils/message/find'
import type { ComposerMessageToken } from '@shared/data/types/uiParts'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { tryFileUrlToPath } from '@shared/utils/file'

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
  if (!/\[\d+\]|<sup\b/.test(content)) return content

  const citation =
    /\[<sup\b[^>]*>(\d+)<\/sup>\]\([^)]*\)|<sup\b[^>]*\bdata-citation\b[^>]*>(\d+)<\/sup>|\[(\d+)\](?!\()/g
  let result = ''
  let cursor = 0

  function appendProse(end: number) {
    let last = cursor
    for (const match of content.slice(cursor, end).matchAll(citation)) {
      const start = cursor + match.index
      const after = start + match[0].length
      result += content.slice(last, start)
      last = after
      if (mode === 'normalize') {
        result += `[^${match[1] ?? match[2] ?? match[3]}]`
      } else if (result.endsWith(' ') && !/\S/.test(content.charAt(after))) {
        result = result.slice(0, -1)
      } else if ((!result || result.endsWith('\n')) && content[after] === ' ') {
        last++
      }
    }
    result += content.slice(last, end)
  }

  visit(fromMarkdown(content), ['code', 'inlineCode'], (node) => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) return
    appendProse(start)
    result += content.slice(start, end)
    cursor = end
  })
  appendProse(content.length)
  return result
}

/**
 * Reads each pasted-text file part's stored content, keyed by `fileTokenSourceId`, so
 * copy reproduces the pasted text. An unreadable file, or a URL that is not a file path,
 * falls back to the token label.
 * Distinct source IDs are read concurrently; duplicate IDs retry later paths until one succeeds.
 */
async function readPastedTextFileContents(messages: readonly ExportableMessage[]): Promise<Map<string, string>> {
  const candidatesBySourceId = new Map<string, string[]>()
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (part.type !== 'file') continue
      const meta = readCherryMeta(part)
      if (meta?.composerFileKind !== 'pasted-text' || !meta.fileTokenSourceId) continue
      const path = part.url ? tryFileUrlToPath(part.url) : undefined
      if (path === undefined) continue
      const existing = candidatesBySourceId.get(meta.fileTokenSourceId)
      if (existing) existing.push(path)
      else candidatesBySourceId.set(meta.fileTokenSourceId, [path])
    }
  }

  const contents = new Map<string, string>()
  await Promise.all(
    [...candidatesBySourceId].map(async ([sourceId, paths]) => {
      for (const path of paths) {
        try {
          contents.set(sourceId, await window.api.fs.readText(path))
          return
        } catch {
          // Leave the token's display label as the copy output for this file.
        }
      }
    })
  )
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
