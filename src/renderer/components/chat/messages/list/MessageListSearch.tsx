/**
 * In-conversation search (Ctrl+F) for the virtualized message list.
 *
 * Matching runs on the currently loaded message data so virtualized rows remain
 * searchable even when virtua has not mounted them. Highlights are painted over
 * whatever is currently mounted via CSS Custom Highlights, and navigation
 * scrolls unmounted matches into view through the list runtime's `locateMessage`.
 */
import { FindBar, type FindBarRef, type FindBarState, INITIAL_FIND_BAR_STATE } from '@renderer/components/FindBar'
import { useCommandHandler } from '@renderer/hooks/command'
import { useIsActiveTab } from '@renderer/hooks/tab'
import { findRangesInScope, supportsCustomHighlights } from '@renderer/utils/contentSearch'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { FC, RefObject } from 'react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import {
  computeMessageSearchMatches,
  createMessageContentNodeFilter,
  findMessageElement,
  findMessagePartElement,
  type MessageSearchMatch
} from './messageSearch'

const EMPTY_MATCHES: MessageSearchMatch[] = []
const MATCHES_HIGHLIGHT = 'message-search-matches'
const CURRENT_HIGHLIGHT = 'message-search-current'

interface Props {
  /** Loaded messages in display order (chronological). */
  messages: CherryUIMessage[]
  /** Live parts overlay; falls back to `message.parts` per message. */
  partsByMessageId?: Record<string, CherryMessagePart[]>
  /** Virtua-aware scroll to a loaded (possibly unmounted) message. */
  locateMessage: (messageId: string) => void
  /** Virtua-aware scroll that centers an exact rendered match. */
  scrollToRange: (range: Range) => void
  /** Element containing the rendered message list; highlight and scroll scope. */
  scopeRef: RefObject<HTMLElement | null>
}

const clearHighlights = () => {
  if (!supportsCustomHighlights()) return
  CSS.highlights.delete(MATCHES_HIGHLIGHT)
  CSS.highlights.delete(CURRENT_HIGHLIGHT)
}

const isSameMatch = (left: MessageSearchMatch, right: MessageSearchMatch) =>
  left.messageId === right.messageId &&
  left.textPartIndex === right.textPartIndex &&
  left.occurrence === right.occurrence

export const MessageListSearch: FC<Props> = ({
  messages,
  partsByMessageId,
  locateMessage,
  scrollToRange,
  scopeRef
}) => {
  const isActiveTab = useIsActiveTab()
  const searchRef = useRef<FindBarRef>(null)
  const [searchState, setSearchState] = useState<FindBarState>(() => ({ ...INITIAL_FIND_BAR_STATE }))
  const [current, setCurrent] = useState<MessageSearchMatch | null>(null)
  const pendingScrollRef = useRef<MessageSearchMatch | null>(null)

  const { enabled, query, caseSensitive: isCaseSensitive, wholeWord: isWholeWord, includeUser } = searchState

  const deferredQuery = useDeferredValue(query)
  const trimmedQuery = deferredQuery.trim()

  const matches = useMemo(
    () =>
      enabled && trimmedQuery
        ? computeMessageSearchMatches(messages, partsByMessageId, trimmedQuery, {
            caseSensitive: isCaseSensitive,
            wholeWord: isWholeWord,
            includeUser
          })
        : EMPTY_MATCHES,
    [enabled, trimmedQuery, messages, partsByMessageId, isCaseSensitive, isWholeWord, includeUser]
  )

  const currentIndex = useMemo(
    () => (current ? matches.findIndex((match) => isSameMatch(match, current)) : -1),
    [current, matches]
  )

  useEffect(() => {
    setCurrent(null)
    pendingScrollRef.current = null
  }, [enabled, includeUser, isCaseSensitive, isWholeWord, trimmedQuery])

  const refreshHighlights = useCallback(() => {
    clearHighlights()
    const scope = scopeRef.current
    if (!enabled || !trimmedQuery || !scope) return

    const searchOptions = { caseSensitive: isCaseSensitive, wholeWord: isWholeWord }
    const filter = createMessageContentNodeFilter(includeUser)
    if (supportsCustomHighlights()) {
      const seenParts = new Set<string>()
      const ranges = matches.flatMap((match) => {
        const partKey = `${match.messageId}:${match.textPartIndex}`
        if (seenParts.has(partKey)) return []
        seenParts.add(partKey)

        const partElement = findMessagePartElement(scope, match.messageId, match.textPartIndex)
        return partElement ? findRangesInScope(partElement, trimmedQuery, searchOptions, filter) : []
      })
      if (ranges.length > 0) {
        CSS.highlights.set(MATCHES_HIGHLIGHT, new Highlight(...ranges))
      }
    }

    if (!current) return
    const partElement = findMessagePartElement(scope, current.messageId, current.textPartIndex)
    if (!partElement) return
    const partRanges = findRangesInScope(partElement, trimmedQuery, searchOptions, filter)
    if (partRanges.length === 0) return
    // Raw markdown and rendered text can still differ within one part; clamp
    // only inside that part instead of drifting into another part or message.
    const range = partRanges[Math.min(current.occurrence, partRanges.length - 1)]
    if (supportsCustomHighlights()) {
      CSS.highlights.set(CURRENT_HIGHLIGHT, new Highlight(range))
    }

    const pending = pendingScrollRef.current
    if (pending && isSameMatch(pending, current)) {
      pendingScrollRef.current = null
      scrollToRange(range)
    }
  }, [current, enabled, includeUser, isCaseSensitive, isWholeWord, matches, scopeRef, scrollToRange, trimmedQuery])

  const refreshHighlightsRef = useRef(refreshHighlights)
  refreshHighlightsRef.current = refreshHighlights

  // Repaint when search state or the loaded messages change.
  useEffect(() => {
    refreshHighlights()
  }, [refreshHighlights, matches])

  // Repaint when virtua mounts/unmounts rows or streaming rewrites content —
  // none of which flow through this component's props.
  useEffect(() => {
    if (!enabled) return
    const scope = scopeRef.current
    if (!scope) return

    let frame: number | null = null
    const observer = new MutationObserver(() => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        refreshHighlightsRef.current()
      })
    })
    observer.observe(scope, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [enabled, scopeRef])

  useEffect(() => clearHighlights, [])

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
      setCurrent(match)
      pendingScrollRef.current = match
      const scope = scopeRef.current
      if (scope && findMessageElement(scope, match.messageId)) {
        // Mounted: the highlight refresh effect centers the exact range.
        return
      }
      locateMessage(match.messageId)
    },
    [locateMessage, scopeRef]
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
