import type { FC, RefObject } from 'react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

/**
 * In-conversation search for one virtualized MessageList.
 *
 * Loaded message data supplies coarse results for unmounted rows. Exact ranges
 * and highlights come only from mounted DOM. Multi-model replies stay at group
 * granularity so search never takes ownership of their selected branch.
 */
import { FindBar, type FindBarRef, type FindBarState, INITIAL_FIND_BAR_STATE } from '@renderer/components/FindBar'
import { useCommandHandler } from '@renderer/hooks/command'
import { useIsActiveTab } from '@renderer/hooks/tab'
import { findRangesInScope, supportsCustomHighlights } from '@renderer/utils/contentSearch'
import type { CherryMessagePart } from '@shared/data/types/message'

import type { MessageListItem } from '../types'
import { computeMessageSearchMatches, type MessageSearchMatch, type MessageTextSearchMatch } from './messageSearch'
import {
  createMessageSearchNodeFilter,
  getMountedMessagePartElements,
  requestUserMessagePartExpansion,
  revealRangeInNestedScrollContainers
} from './messageSearchDom'

const EMPTY_MATCHES: MessageSearchMatch[] = []
const MATCHES_HIGHLIGHT = 'message-search-matches'
const CURRENT_HIGHLIGHT = 'message-search-current'

interface Props {
  /** Loaded messages in chronological order, including any live tail. */
  messages: MessageListItem[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  renderUserTextAsMarkdown: boolean
  excludedMessageIds: ReadonlySet<string>
  isStreaming: boolean
  /** Virtua-aware scroll to the message's visual group. */
  locateMessage: (messageId: string) => void
  /** Scroll the owning list after nested layout surfaces reveal the range. */
  scrollToRange: (range: Range) => void
  getOuterScroller: () => HTMLElement | null
  /** Element containing this rendered message list. */
  scopeRef: RefObject<HTMLElement | null>
}

interface SearchCursor {
  criteriaKey: string
  matchKey: string
}

interface PendingNavigation {
  criteriaKey: string
  match: MessageTextSearchMatch
  isWaitingForHighlight: boolean
}

const clearHighlights = () => {
  if (!supportsCustomHighlights()) return
  CSS.highlights.delete(MATCHES_HIGHLIGHT)
  CSS.highlights.delete(CURRENT_HIGHLIGHT)
}

const clearCurrentHighlight = () => {
  if (!supportsCustomHighlights()) return
  CSS.highlights.delete(CURRENT_HIGHLIGHT)
}

const isRangeConnected = (range: Range): boolean => range.commonAncestorContainer.isConnected

const getCriteriaKey = (query: string, caseSensitive: boolean, wholeWord: boolean, includeUser: boolean): string =>
  `${query}\u0000${caseSensitive ? '1' : '0'}${wholeWord ? '1' : '0'}${includeUser ? '1' : '0'}`

export const MessageListSearch: FC<Props> = ({
  messages,
  partsByMessageId,
  renderUserTextAsMarkdown,
  excludedMessageIds,
  isStreaming,
  locateMessage,
  scrollToRange,
  getOuterScroller,
  scopeRef
}) => {
  const isActiveTab = useIsActiveTab()
  const searchRef = useRef<FindBarRef>(null)
  const [searchState, setSearchState] = useState<FindBarState>(() => ({ ...INITIAL_FIND_BAR_STATE }))
  const [cursor, setCursor] = useState<SearchCursor | null>(null)
  const [navigationSequence, setNavigationSequence] = useState(0)
  const pendingNavigationRef = useRef<PendingNavigation | null>(null)
  const settledHighlightFrameRef = useRef<number | null>(null)

  const { enabled, query, caseSensitive, wholeWord, includeUser } = searchState
  const deferredQuery = useDeferredValue(query)
  const trimmedQuery = deferredQuery.trim()
  const criteriaKey = getCriteriaKey(trimmedQuery, caseSensitive, wholeWord, includeUser)

  // Streaming updates the loaded data on every chunk while live messages are
  // excluded from matching anyway. Latch the searched data outside streaming
  // so matches recompute once when the stream settles, not per chunk.
  const searchSourceRef = useRef({ messages, partsByMessageId })
  if (!isStreaming) searchSourceRef.current = { messages, partsByMessageId }
  const { messages: searchMessages, partsByMessageId: searchParts } = searchSourceRef.current

  const matches = useMemo(
    () =>
      enabled && trimmedQuery
        ? computeMessageSearchMatches(searchMessages, searchParts, trimmedQuery, {
            caseSensitive,
            wholeWord,
            includeUser,
            renderUserTextAsMarkdown,
            excludedMessageIds
          })
        : EMPTY_MATCHES,
    [
      caseSensitive,
      enabled,
      excludedMessageIds,
      includeUser,
      searchMessages,
      searchParts,
      renderUserTextAsMarkdown,
      trimmedQuery,
      wholeWord
    ]
  )

  const currentIndex = useMemo(
    () => (cursor?.criteriaKey === criteriaKey ? matches.findIndex((match) => match.key === cursor.matchKey) : -1),
    [criteriaKey, cursor, matches]
  )
  const current = currentIndex >= 0 ? matches[currentIndex] : null
  const currentRef = useRef(current)
  currentRef.current = current

  const matchesByPartId = useMemo(() => {
    const byPartId = new Map<string, MessageTextSearchMatch[]>()
    for (const match of matches) {
      if (match.type !== 'text') continue
      const partMatches = byPartId.get(match.partId)
      if (partMatches) {
        partMatches.push(match)
      } else {
        byPartId.set(match.partId, [match])
      }
    }
    return byPartId
  }, [matches])

  useEffect(() => {
    if (settledHighlightFrameRef.current !== null) {
      cancelAnimationFrame(settledHighlightFrameRef.current)
      settledHighlightFrameRef.current = null
    }
    pendingNavigationRef.current = null
    clearHighlights()
  }, [criteriaKey, enabled])

  useEffect(() => {
    const pending = pendingNavigationRef.current
    if (pending && !matches.some((match) => match.key === pending.match.key)) {
      pendingNavigationRef.current = null
    }
  }, [matches])

  const rebuildMountedHighlights = useCallback(() => {
    const scope = scopeRef.current
    if (!enabled || !trimmedQuery || !scope) {
      clearHighlights()
      return
    }
    // Live DOM mutations are intentionally ignored. Loaded history remains
    // searchable, and one stable refresh runs after streaming ends.
    if (isStreaming) return

    const mountedParts = getMountedMessagePartElements(scope)
    const searchOptions = { caseSensitive, wholeWord }
    const filter = createMessageSearchNodeFilter()
    const nextRangesByPartId = new Map<string, Range[]>()
    for (const [partId, partElement] of mountedParts) {
      const partMatches = matchesByPartId.get(partId)
      if (!partMatches) continue
      nextRangesByPartId.set(
        partId,
        findRangesInScope(partElement, trimmedQuery, searchOptions, filter).slice(0, partMatches.length)
      )
    }

    clearHighlights()
    if (supportsCustomHighlights()) {
      const mountedRanges = [...nextRangesByPartId.values()].flat()
      if (mountedRanges.length > 0) {
        CSS.highlights.set(MATCHES_HIGHLIGHT, new Highlight(...mountedRanges))
      }
    }
    const latestCurrent = currentRef.current
    if (latestCurrent?.type !== 'text' || !supportsCustomHighlights()) return
    const currentRange = nextRangesByPartId.get(latestCurrent.partId)?.[latestCurrent.occurrence]
    if (currentRange) CSS.highlights.set(CURRENT_HIGHLIGHT, new Highlight(currentRange))
  }, [caseSensitive, enabled, isStreaming, matchesByPartId, scopeRef, trimmedQuery, wholeWord])

  const syncPendingNavigation = useCallback(() => {
    const pending = pendingNavigationRef.current
    const scope = scopeRef.current
    if (!pending || pending.isWaitingForHighlight || pending.criteriaKey !== criteriaKey || !scope) return

    const partElement = getMountedMessagePartElements(scope).get(pending.match.partId)
    if (!partElement) return

    const partMatchCount = matchesByPartId.get(pending.match.partId)?.length ?? 0
    const ranges = findRangesInScope(
      partElement,
      trimmedQuery,
      { caseSensitive, wholeWord },
      createMessageSearchNodeFilter()
    ).slice(0, partMatchCount)

    const range = ranges[pending.match.occurrence]
    if (!range) {
      if (pending.match.role === 'user' && requestUserMessagePartExpansion(partElement)) {
        return
      }

      // Coarse data matching can include source text that has no rendered DOM
      // counterpart. Finish at the message component instead of waiting forever.
      pendingNavigationRef.current = null
      clearCurrentHighlight()
      locateMessage(pending.match.messageId)
      return
    }

    pending.isWaitingForHighlight = true
    revealRangeInNestedScrollContainers(range, getOuterScroller() ?? scope)
    scrollToRange(range)
    settledHighlightFrameRef.current = requestAnimationFrame(() => {
      settledHighlightFrameRef.current = requestAnimationFrame(() => {
        settledHighlightFrameRef.current = null
        const latestPending = pendingNavigationRef.current
        if (latestPending?.criteriaKey !== pending.criteriaKey || latestPending.match.key !== pending.match.key) return

        pendingNavigationRef.current = null
        if (supportsCustomHighlights() && isRangeConnected(range)) {
          CSS.highlights.set(CURRENT_HIGHLIGHT, new Highlight(range))
        }
      })
    })
  }, [
    caseSensitive,
    criteriaKey,
    getOuterScroller,
    locateMessage,
    matchesByPartId,
    scopeRef,
    scrollToRange,
    trimmedQuery,
    wholeWord
  ])

  const rebuildMountedHighlightsRef = useRef(rebuildMountedHighlights)
  const syncPendingNavigationRef = useRef(syncPendingNavigation)
  rebuildMountedHighlightsRef.current = rebuildMountedHighlights
  syncPendingNavigationRef.current = syncPendingNavigation

  useEffect(() => {
    rebuildMountedHighlights()
  }, [rebuildMountedHighlights])

  useEffect(() => {
    syncPendingNavigation()
  }, [navigationSequence, syncPendingNavigation])

  useEffect(() => {
    if (!enabled) return
    const scope = scopeRef.current
    if (!scope) return

    let frame: number | null = null
    const observer = new MutationObserver(() => {
      if (frame !== null) return
      // Streaming mutates the DOM per chunk; without a pending navigation
      // there is nothing to sync, so skip scheduling work entirely.
      if (isStreaming && !pendingNavigationRef.current) return
      frame = requestAnimationFrame(() => {
        frame = null
        if (pendingNavigationRef.current) {
          syncPendingNavigationRef.current()
        } else if (!isStreaming) {
          rebuildMountedHighlightsRef.current()
        }
      })
    })
    observer.observe(scope, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [enabled, isStreaming, scopeRef])

  useEffect(
    () => () => {
      if (settledHighlightFrameRef.current !== null) cancelAnimationFrame(settledHighlightFrameRef.current)
      clearHighlights()
    },
    []
  )

  useCommandHandler(
    'chat.message.search',
    () => {
      const selectedText = window.getSelection()?.toString().trim()
      searchRef.current?.enable(selectedText || undefined)
    },
    { enabled: isActiveTab }
  )

  useHotkeys('esc', () => searchRef.current?.disable(), { enabled }, [enabled])

  const navigateToMatch = useCallback(
    (match: MessageSearchMatch) => {
      if (settledHighlightFrameRef.current !== null) {
        cancelAnimationFrame(settledHighlightFrameRef.current)
        settledHighlightFrameRef.current = null
      }
      clearCurrentHighlight()
      setCursor({ criteriaKey, matchKey: match.key })

      if (match.type === 'message-group') {
        pendingNavigationRef.current = null
        locateMessage(match.messageId)
        return
      }

      pendingNavigationRef.current = { criteriaKey, match, isWaitingForHighlight: false }
      setNavigationSequence((sequence) => sequence + 1)

      const scope = scopeRef.current
      if (!scope || !getMountedMessagePartElements(scope).has(match.partId)) {
        locateMessage(match.messageId)
      }
    },
    [criteriaKey, locateMessage, scopeRef]
  )

  const step = useCallback(
    (delta: 1 | -1) => {
      if (matches.length === 0) return
      const nextIndex =
        currentIndex >= 0
          ? (currentIndex + delta + matches.length) % matches.length
          : delta > 0
            ? 0
            : matches.length - 1
      navigateToMatch(matches[nextIndex])
    },
    [currentIndex, matches, navigateToMatch]
  )

  return (
    <FindBar
      ref={searchRef}
      matchCount={matches.length}
      currentIndex={currentIndex}
      onNavigate={step}
      onStateChange={setSearchState}
    />
  )
}
