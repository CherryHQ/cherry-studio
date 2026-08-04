/**
 * Search engine for the virtualized message list.
 *
 * The list only mounts the messages near the viewport (virtua) and only loads
 * pages of history on demand, so a DOM-walking search cannot see the whole
 * conversation. Matching therefore runs on message DATA (text parts of the
 * loaded messages) to produce the match list and total count, while DOM ranges
 * are collected lazily — only over currently mounted content — to paint
 * CSS Custom Highlights.
 *
 * Data matching runs on raw part text while highlights run on rendered text.
 * Matches therefore retain both their text-part position and occurrence within that
 * part, keeping navigation scoped to the smallest stable rendered unit.
 */
import { uiSelector } from '@renderer/utils/uiContract'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

import { hasPartParentToolCallId } from '../tools/toolParentMetadata'

const MESSAGE_SELECTOR = uiSelector({ semanticId: 'chat.message' })
const MESSAGE_CONTENT_SELECTOR = uiSelector({ parts: ['message-content'] })
const TEXT_PART_SELECTOR = '.block-wrapper.text-foreground'

export interface MessageSearchMatch {
  messageId: string
  /** Index among the message's rendered text parts. */
  textPartIndex: number
  /** 0-based occurrence index within the text part. */
  occurrence: number
}

export interface MessageSearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
  includeUser: boolean
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function buildMessageSearchRegex(
  searchText: string,
  options: Pick<MessageSearchOptions, 'caseSensitive' | 'wholeWord'>
): RegExp {
  const escaped = escapeRegExp(searchText)
  // Apply case sensitivity only when the search text contains only Latin
  // letters (same rule as ContentSearch).
  const hasOnlyLatinLetters = /^[a-zA-Z\s]+$/.test(searchText)
  const flags = hasOnlyLatinLetters && options.caseSensitive ? 'g' : 'gi'
  const pattern = options.wholeWord ? `\\b${escaped}\\b` : escaped
  return new RegExp(pattern, flags)
}

export function computeMessageSearchMatches(
  messages: readonly CherryUIMessage[],
  partsByMessageId: Record<string, CherryMessagePart[]> | undefined,
  searchText: string,
  options: MessageSearchOptions
): MessageSearchMatch[] {
  const trimmed = searchText.trim()
  if (!trimmed) return []

  const regex = buildMessageSearchRegex(trimmed, options)
  const matches: MessageSearchMatch[] = []
  for (const message of messages) {
    if (message.role !== 'assistant' && !(options.includeUser && message.role === 'user')) continue

    const parts = partsByMessageId?.[message.id] ?? ((message.parts ?? []) as CherryMessagePart[])
    let textPartIndex = 0
    for (const part of parts) {
      if (part.type !== 'text' || hasPartParentToolCallId(part)) continue
      const currentTextPartIndex = textPartIndex
      textPartIndex++
      if (!part.text) continue

      regex.lastIndex = 0
      let occurrence = 0
      while (regex.exec(part.text) !== null) {
        matches.push({ messageId: message.id, textPartIndex: currentTextPartIndex, occurrence })
        occurrence++
      }
    }
  }
  return matches
}

/**
 * Text-node filter mirroring the data-side scope: rendered message content
 * only, assistant messages unless `includeUser`.
 */
export function createMessageContentNodeFilter(includeUser: boolean): NodeFilter {
  return {
    acceptNode(node) {
      const container = node.parentElement?.closest('.message-content-container')
      if (!container) return NodeFilter.FILTER_REJECT
      const message = container.closest('.message')
      if (!message) return NodeFilter.FILTER_REJECT
      if (includeUser) return NodeFilter.FILTER_ACCEPT
      if (message.classList.contains('message-assistant')) return NodeFilter.FILTER_ACCEPT
      return NodeFilter.FILTER_REJECT
    }
  }
}

/**
 * Collect DOM ranges matching `regex` under `root`. Text nodes are
 * concatenated before matching so matches spanning element boundaries
 * (e.g. across markdown inline formatting) are still found.
 */
export function findRangesInScope(root: HTMLElement, regex: RegExp, filter: NodeFilter): Range[] {
  const ranges: Range[] = []
  const treeWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, filter)
  const allTextNodes: { node: Node; startOffset: number }[] = []
  let fullText = ''

  while (treeWalker.nextNode()) {
    allTextNodes.push({ node: treeWalker.currentNode, startOffset: fullText.length })
    fullText += treeWalker.currentNode.nodeValue
  }

  regex.lastIndex = 0
  let match: RegExpExecArray | null = null
  while ((match = regex.exec(fullText))) {
    const matchStart = match.index
    const matchEnd = matchStart + match[0].length

    let startNode: Node | null = null
    let endNode: Node | null = null
    let startOffset = 0
    let endOffset = 0

    for (const nodeInfo of allTextNodes) {
      const nodeLength = nodeInfo.node.nodeValue?.length ?? 0
      if (startNode === null && matchStart >= nodeInfo.startOffset && matchStart < nodeInfo.startOffset + nodeLength) {
        startNode = nodeInfo.node
        startOffset = matchStart - nodeInfo.startOffset
      }
      if (matchEnd > nodeInfo.startOffset && matchEnd <= nodeInfo.startOffset + nodeLength) {
        endNode = nodeInfo.node
        endOffset = matchEnd - nodeInfo.startOffset
        break
      }
    }

    if (startNode && endNode) {
      const range = new Range()
      range.setStart(startNode, startOffset)
      range.setEnd(endNode, endOffset)
      ranges.push(range)
    }
  }

  return ranges
}

/** Find a message's mounted root element (null while virtua keeps it unmounted). */
export function findMessageElement(scope: HTMLElement, messageId: string): HTMLElement | null {
  return scope.querySelector<HTMLElement>(`${MESSAGE_SELECTOR}#${CSS.escape(`message-${messageId}`)}`)
}

/** Find a mounted searchable text part through the existing semantic message-content boundary. */
export function findMessagePartElement(
  scope: HTMLElement,
  messageId: string,
  textPartIndex: number
): HTMLElement | null {
  const messageContent = findMessageElement(scope, messageId)?.querySelector<HTMLElement>(MESSAGE_CONTENT_SELECTOR)
  return messageContent?.querySelectorAll<HTMLElement>(TEXT_PART_SELECTOR)[textPartIndex] ?? null
}
