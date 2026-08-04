/**
 * Pure data projection for virtualized message search.
 *
 * Search operates on the same result projection as MessagePartsRenderer. This
 * keeps process history, reasoning, tools, and hidden transport parts out of
 * the result set before any DOM navigation is attempted.
 */
import { findTextMatches } from '@renderer/utils/contentSearch'
import type { CherryMessagePart } from '@shared/data/types/message'

import { type PartEntry, projectCompletedMessageParts } from '../blocks/messagePartLayouts'
import { hasPartParentToolCallId } from '../tools/toolParentMetadata'
import type { MessageListItem } from '../types'
import { projectMarkdownSearchText } from './messageSearchText'

export interface MessageSearchDocument {
  messageId: string
  partId: string
  role: MessageListItem['role']
  text: string
  sourcePart: CherryMessagePart
}

export interface MessageSearchMatch {
  key: string
  messageId: string
  partId: string
  role: MessageListItem['role']
  /** 0-based occurrence index within the rendered text part. */
  occurrence: number
}

export interface MessageSearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
  includeUser: boolean
  renderUserTextAsMarkdown: boolean
}

interface CachedPartMatches {
  criteriaKey: string
  text: string
  count: number
}

interface CachedSearchText {
  renderAsMarkdown: boolean
  source: string
  text: string
}

const partMatchCache = new WeakMap<object, CachedPartMatches>()
const searchTextCache = new WeakMap<object, CachedSearchText>()

export { findTextMatches } from '@renderer/utils/contentSearch'

export function toMessageSearchText(source: string, renderAsMarkdown = true): string {
  if (!renderAsMarkdown) return source
  return projectMarkdownSearchText(source)
}

function getPartSearchText(part: Extract<CherryMessagePart, { type: 'text' }>, renderAsMarkdown: boolean): string {
  const source = part.text ?? ''
  const cached = searchTextCache.get(part as object)
  if (cached?.source === source && cached.renderAsMarkdown === renderAsMarkdown) return cached.text

  const text = toMessageSearchText(source, renderAsMarkdown)
  searchTextCache.set(part as object, { renderAsMarkdown, source, text })
  return text
}

function getTopLevelPartEntries(parts: readonly CherryMessagePart[]): PartEntry[] {
  return parts.flatMap((part, index) => (hasPartParentToolCallId(part) ? [] : [{ part, index }]))
}

export function projectMessageSearchDocuments(
  messages: readonly MessageListItem[],
  partsByMessageId: Readonly<Record<string, CherryMessagePart[]>>,
  options: MessageSearchOptions
): MessageSearchDocument[] {
  return messages.flatMap((message) => {
    if (message.role !== 'assistant' && !(options.includeUser && message.role === 'user')) return []
    if (message.role === 'assistant' && message.status === 'pending') return []

    const entries = getTopLevelPartEntries(partsByMessageId[message.id] ?? [])
    const searchableEntries =
      message.role === 'assistant' ? projectCompletedMessageParts(entries).resultEntries : entries

    return searchableEntries.flatMap((entry): MessageSearchDocument[] => {
      if (entry.part.type !== 'text' || !entry.part.text) return []

      return [
        {
          messageId: message.id,
          partId: `${message.id}-part-${entry.index}`,
          role: message.role,
          text: getPartSearchText(entry.part, message.role === 'assistant' || options.renderUserTextAsMarkdown),
          sourcePart: entry.part
        }
      ]
    })
  })
}

function getMatchCount(
  document: MessageSearchDocument,
  searchText: string,
  options: Pick<MessageSearchOptions, 'caseSensitive' | 'wholeWord'>
): number {
  const criteriaKey = `${searchText}\u0000${options.caseSensitive ? '1' : '0'}${options.wholeWord ? '1' : '0'}`
  const cached = partMatchCache.get(document.sourcePart as object)
  if (cached?.criteriaKey === criteriaKey && cached.text === document.text) return cached.count

  const count = findTextMatches(document.text, searchText, options).length
  partMatchCache.set(document.sourcePart as object, { criteriaKey, text: document.text, count })
  return count
}

export function computeMessageSearchMatches(
  messages: readonly MessageListItem[],
  partsByMessageId: Readonly<Record<string, CherryMessagePart[]>>,
  searchText: string,
  options: MessageSearchOptions
): MessageSearchMatch[] {
  const trimmed = searchText.trim()
  if (!trimmed) return []

  return projectMessageSearchDocuments(messages, partsByMessageId, options).flatMap((document) => {
    const count = getMatchCount(document, trimmed, options)
    return Array.from({ length: count }, (_, occurrence) => ({
      key: `${document.partId}:${occurrence}`,
      messageId: document.messageId,
      partId: document.partId,
      role: document.role,
      occurrence
    }))
  })
}
