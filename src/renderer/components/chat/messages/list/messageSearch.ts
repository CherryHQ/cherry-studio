/** Coarse data matching for loaded messages outside the virtualized DOM. */
import { findTextMatches } from '@renderer/utils/contentSearch'
import { markdownToPlainText } from '@renderer/utils/markdown'
import type { CherryMessagePart } from '@shared/data/types/message'

import { type PartEntry, projectCompletedMessageParts } from '../blocks/messagePartLayouts'
import { hasPartParentToolCallId } from '../tools/toolParentMetadata'
import type { MessageListItem } from '../types'
import { groupMessageListItems } from '../utils/messageGroupKey'
import { isAssistantMultiModelGroup } from '../utils/messageGroupLayout'

interface MessageSearchDocument {
  messageId: string
  partId: string
  role: MessageListItem['role']
  text: string
  sourcePart: CherryMessagePart
}

export interface MessageTextSearchMatch {
  type: 'text'
  key: string
  messageId: string
  partId: string
  role: MessageListItem['role']
  /** 0-based occurrence index within the rendered text part. */
  occurrence: number
}

export interface MessageGroupSearchMatch {
  type: 'message-group'
  key: string
  messageId: string
  role: 'assistant'
}

export type MessageSearchMatch = MessageTextSearchMatch | MessageGroupSearchMatch

export interface MessageSearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
  includeUser: boolean
  renderUserTextAsMarkdown: boolean
  excludedMessageIds?: ReadonlySet<string>
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

function getPartSearchText(part: Extract<CherryMessagePart, { type: 'text' }>, renderAsMarkdown: boolean): string {
  const source = part.text ?? ''
  const cached = searchTextCache.get(part as object)
  if (cached?.source === source && cached.renderAsMarkdown === renderAsMarkdown) return cached.text

  const text = renderAsMarkdown ? markdownToPlainText(source) : source
  searchTextCache.set(part as object, { renderAsMarkdown, source, text })
  return text
}

function getTopLevelPartEntries(parts: readonly CherryMessagePart[]): PartEntry[] {
  return parts.flatMap((part, index) => (hasPartParentToolCallId(part) ? [] : [{ part, index }]))
}

function projectMessageSearchDocuments(
  messages: readonly MessageListItem[],
  partsByMessageId: Readonly<Record<string, CherryMessagePart[]>>,
  options: MessageSearchOptions
): MessageSearchDocument[] {
  return messages.flatMap((message) => {
    if (options.excludedMessageIds?.has(message.id)) return []
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

  const groupedMessages = groupMessageListItems(messages as MessageListItem[])
  return Object.entries(groupedMessages).flatMap(([groupKey, groupMessages]): MessageSearchMatch[] => {
    const documents = projectMessageSearchDocuments(groupMessages, partsByMessageId, options)

    // Multi-model replies are one visual component. Search their loaded data,
    // but keep navigation at component granularity instead of selecting a model
    // branch or trying to map hidden text to a DOM range.
    if (isAssistantMultiModelGroup(groupMessages)) {
      const matchedDocument = documents.find((document) => getMatchCount(document, trimmed, options) > 0)
      return matchedDocument
        ? [
            {
              type: 'message-group' as const,
              key: `message-group:${groupKey}`,
              messageId: matchedDocument.messageId,
              role: 'assistant' as const
            }
          ]
        : []
    }

    return documents.flatMap((document) => {
      const count = getMatchCount(document, trimmed, options)
      return Array.from({ length: count }, (_, occurrence) => ({
        type: 'text' as const,
        key: `${document.partId}:${occurrence}`,
        messageId: document.messageId,
        partId: document.partId,
        role: document.role,
        occurrence
      }))
    })
  })
}
