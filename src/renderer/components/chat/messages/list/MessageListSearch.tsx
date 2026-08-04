/**
 * In-conversation search for one virtualized MessageList.
 *
 * Data matching covers loaded terminal rows. The owning MessageList unmounts
 * search while any message is streaming. DOM work is limited to mounted result
 * parts, and pending navigation only handles ordinary virtualization.
 */
import { FindBar, type FindBarRef, type FindBarState, INITIAL_FIND_BAR_STATE } from '@renderer/components/FindBar'
import { useCommandHandler } from '@renderer/hooks/command'
import { useIsActiveTab } from '@renderer/hooks/tab'
import { findRangesInScope, supportsCustomHighlights } from '@renderer/utils/contentSearch'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { FC, RefObject } from 'react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import type { MessageListItem } from '../types'
import { computeMessageSearchMatches, type MessageSearchMatch } from './messageSearch'
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
  /** Loaded, layout-visible messages in chronological order. */
  messages: MessageListItem[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  renderUserTextAsMarkdown: boolean
  /** Virtua-aware scroll to a loaded (possibly unmounted) message. */
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
  match: MessageSearchMatch
  isWaitingForHighlight: boolean
}

const clearHighlights = () => {
  if (!supportsCustomHighlights()) return
  CSS.highlights.delete(MATCHES_HIGHLIGHT)
  CSS.highlights.delete(CURRENT_HIGHLIGHT)
}

const getCriteriaKey = (query: string, caseSensitive: boolean, wholeWord: boolean, includeUser: boolean): string =>
  `${query}\u0000${caseSensitive ? '1' : '0'}${wholeWord ? '1' : '0'}${includeUser ? '1' : '0'}`

export const MessageListSearch: FC<Props> = ({
  messages,
  partsByMessageId,
  renderUserTextAsMarkdown,
  locateMessage,
  scrollToRange,
  getOuterScroller,
  scopeRef
}) => {
  const isActiveTab = useIsActiveTab()
  const searchRef = useRef<FindBarRef>(null)
  const [searchState, setSearchState] = useState<FindBarState>(() => ({ ...INITIAL_FIND_BAR_STATE }))
  const [cursor, setCursor] = useState<SearchCursor | null>(null)
  const pendingNavigationRef = useRef<PendingNavigation | null>(null)
  const settledHighlightFrameRef = useRef<number | null>(null)

  const { enabled, query, caseSensitive, wholeWord, includeUser } = searchState
  const deferredQuery = useDeferredValue(query)
  const trimmedQuery = deferredQuery.trim()
  const criteriaKey = getCriteriaKey(trimmedQuery, caseSensitive, wholeWord, includeUser)

  const matches = useMemo(
    () =>
      enabled && trimmedQuery
        ? computeMessageSearchMatches(messages, partsByMessageId, trimmedQuery, {
            caseSensitive,
            wholeWord,
            includeUser,
            renderUserTextAsMarkdown
          })
        : EMPTY_MATCHES,
    [caseSensitive, enabled, includeUser, messages, partsByMessageId, renderUserTextAsMarkdown, trimmedQuery, wholeWord]
  )

  const currentIndex = useMemo(
    () => (cursor?.criteriaKey === criteriaKey ? matches.findIndex((match) => match.key === cursor.matchKey) : -1),
    [criteriaKey, cursor, matches]
  )
  const current = currentIndex >= 0 ? matches[currentIndex] : null
  const matchesByPartId = useMemo(() => {
    const byPartId = new Map<string, MessageSearchMatch[]>()
    for (const match of matches) {
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
  }, [criteriaKey, enabled])

  useEffect(() => {
    const pending = pendingNavigationRef.current
    if (pending && !matches.some((match) => match.key === pending.match.key)) {
      pendingNavigationRef.current = null
    }
  }, [matches])

  const syncSearchDomRef = useRef<() => void>(() => {})

  const syncSearchDom = useCallback(() => {
    const scope = scopeRef.current
    if (!enabled || !trimmedQuery || !scope) {
      clearHighlights()
      return
    }

    const pending = pendingNavigationRef.current
    if (pending) {
      if (
        pending.isWaitingForHighlight ||
        pending.criteriaKey !== criteriaKey ||
        !current ||
        pending.match.key !== current.key
      ) {
        return
      }

      const partElement = getMountedMessagePartElements(scope).get(current.partId)
      if (!partElement) return

      const ranges = findRangesInScope(
        partElement,
        trimmedQuery,
        { caseSensitive, wholeWord },
        createMessageSearchNodeFilter()
      )
      const range = ranges[current.occurrence]
      if (!range) {
        if (current.role === 'user') requestUserMessagePartExpansion(partElement)
        return
      }

      pending.isWaitingForHighlight = true
      revealRangeInNestedScrollContainers(range, getOuterScroller() ?? scope)
      scrollToRange(range)
      // Let the instant scroll and virtualizer reconciliation paint before doing
      // the full mounted-range scan and committing CSS highlights.
      settledHighlightFrameRef.current = requestAnimationFrame(() => {
        settledHighlightFrameRef.current = requestAnimationFrame(() => {
          settledHighlightFrameRef.current = null
          const latestPending = pendingNavigationRef.current
          if (latestPending?.criteriaKey !== pending.criteriaKey || latestPending.match.key !== pending.match.key) {
            return
          }
          pendingNavigationRef.current = null
          syncSearchDomRef.current()
        })
      })
      return
    }

    clearHighlights()
    if (!supportsCustomHighlights()) return

    const mountedParts = getMountedMessagePartElements(scope)
    const searchOptions = { caseSensitive, wholeWord }
    const filter = createMessageSearchNodeFilter()
    const mountedRanges: Range[] = []
    const rangesByPartId = new Map<string, Range[]>()
    for (const [partId, partElement] of mountedParts) {
      const partMatches = matchesByPartId.get(partId)
      if (!partMatches) continue
      const partRanges = findRangesInScope(partElement, trimmedQuery, searchOptions, filter).slice(
        0,
        partMatches.length
      )
      rangesByPartId.set(partId, partRanges)
      mountedRanges.push(...partRanges)
    }
    if (mountedRanges.length > 0) {
      CSS.highlights.set(MATCHES_HIGHLIGHT, new Highlight(...mountedRanges))
    }

    if (!current) return
    const currentRange = rangesByPartId.get(current.partId)?.[current.occurrence]
    if (currentRange) CSS.highlights.set(CURRENT_HIGHLIGHT, new Highlight(currentRange))
  }, [
    caseSensitive,
    criteriaKey,
    current,
    enabled,
    getOuterScroller,
    matchesByPartId,
    scopeRef,
    scrollToRange,
    trimmedQuery,
    wholeWord
  ])

  syncSearchDomRef.current = syncSearchDom

  useEffect(() => {
    syncSearchDom()
  }, [syncSearchDom])

  useEffect(() => {
    if (!enabled) return
    const scope = scopeRef.current
    if (!scope) return

    let frame: number | null = null
    const observer = new MutationObserver(() => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        syncSearchDomRef.current()
      })
    })
    observer.observe(scope, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [enabled, scopeRef])

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
      setCursor({ criteriaKey, matchKey: match.key })
      pendingNavigationRef.current = { criteriaKey, match, isWaitingForHighlight: false }

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
