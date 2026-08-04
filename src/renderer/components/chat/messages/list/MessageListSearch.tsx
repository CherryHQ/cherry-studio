/**
 * In-conversation search (Ctrl+F) for the virtualized message list.
 *
 * Matching runs on the currently loaded message data so virtualized rows remain
 * searchable even when virtua has not mounted them. Highlights are painted over
 * whatever is currently mounted via CSS Custom Highlights, and navigation
 * scrolls unmounted matches into view through the list runtime's `locateMessage`.
 */
import { Tooltip } from '@cherrystudio/ui'
import ActionIconButton from '@renderer/components/ActionIconButton'
import { useCommandHandler } from '@renderer/hooks/command'
import { useIsActiveTab } from '@renderer/hooks/tab'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { CaseSensitive, ChevronDown, ChevronUp, User, WholeWord, X } from 'lucide-react'
import type { FC, KeyboardEvent, RefObject } from 'react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'

import {
  buildMessageSearchRegex,
  computeMessageSearchMatches,
  createMessageContentNodeFilter,
  findMessageElement,
  findMessagePartElement,
  findRangesInScope,
  type MessageSearchMatch
} from './messageSearch'

const EMPTY_MATCHES: MessageSearchMatch[] = []
const MATCHES_HIGHLIGHT = 'search-matches'
const CURRENT_HIGHLIGHT = 'current-match'

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

// CSS Custom Highlight API — always present in Electron, absent in jsdom.
const supportsHighlights = () =>
  typeof CSS !== 'undefined' && CSS.highlights !== undefined && typeof Highlight !== 'undefined'

const clearHighlights = () => {
  if (!supportsHighlights()) return
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
  const { t } = useTranslation()
  const isActiveTab = useIsActiveTab()
  const inputRef = useRef<HTMLInputElement>(null)
  const [enabled, setEnabled] = useState(false)
  const [query, setQuery] = useState('')
  const [isCaseSensitive, setIsCaseSensitive] = useState(false)
  const [isWholeWord, setIsWholeWord] = useState(false)
  const [includeUser, setIncludeUser] = useState(false)
  const [current, setCurrent] = useState<MessageSearchMatch | null>(null)
  const [focusSeq, setFocusSeq] = useState(0)
  const pendingScrollRef = useRef<MessageSearchMatch | null>(null)

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
  }, [includeUser, isCaseSensitive, isWholeWord, trimmedQuery])

  const refreshHighlights = useCallback(() => {
    clearHighlights()
    const scope = scopeRef.current
    if (!enabled || !trimmedQuery || !scope) return

    const regex = buildMessageSearchRegex(trimmedQuery, { caseSensitive: isCaseSensitive, wholeWord: isWholeWord })
    const filter = createMessageContentNodeFilter(includeUser)
    if (supportsHighlights()) {
      const seenParts = new Set<string>()
      const ranges = matches.flatMap((match) => {
        const partKey = `${match.messageId}:${match.textPartIndex}`
        if (seenParts.has(partKey)) return []
        seenParts.add(partKey)

        const partElement = findMessagePartElement(scope, match.messageId, match.textPartIndex)
        return partElement ? findRangesInScope(partElement, regex, filter) : []
      })
      if (ranges.length > 0) {
        CSS.highlights.set(MATCHES_HIGHLIGHT, new Highlight(...ranges))
      }
    }

    if (!current) return
    const partElement = findMessagePartElement(scope, current.messageId, current.textPartIndex)
    if (!partElement) return
    const partRanges = findRangesInScope(partElement, regex, filter)
    if (partRanges.length === 0) return
    // Raw markdown and rendered text can still differ within one part; clamp
    // only inside that part instead of drifting into another part or message.
    const range = partRanges[Math.min(current.occurrence, partRanges.length - 1)]
    if (supportsHighlights()) {
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

  const enable = useCallback((initialText?: string) => {
    setEnabled(true)
    if (initialText && initialText.trim().length > 0) {
      setQuery(initialText)
    }
    setFocusSeq((sequence) => sequence + 1)
  }, [])

  const disable = useCallback(() => {
    setEnabled(false)
    setCurrent(null)
    pendingScrollRef.current = null
  }, [])

  useEffect(() => {
    if (focusSeq === 0) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusSeq])

  useCommandHandler(
    'chat.message.search',
    () => {
      const selectedText = window.getSelection()?.toString().trim()
      enable(selectedText || undefined)
    },
    { enabled: isActiveTab }
  )

  useHotkeys('esc', disable, { enabled }, [enabled])

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

  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        step(event.shiftKey ? -1 : 1)
      } else if (event.key === 'Escape') {
        event.stopPropagation()
        disable()
      }
    },
    [disable, step]
  )

  const refocusInput = useCallback(() => {
    setFocusSeq((sequence) => sequence + 1)
  }, [])

  if (!enabled) return null

  return (
    <div className="absolute top-0 right-5 z-10 flex w-[400px] max-w-[calc(100%-2.5rem)] items-center justify-center rounded-[10px] border border-primary bg-background px-[15px] py-[5px]">
      <div className="flex flex-[1_1_auto] items-center">
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={t('chat.assistant.search.placeholder')}
          className="w-full flex-1 border-none bg-transparent px-[5px] py-0 font-[Ubuntu] text-[14px] text-foreground leading-5 outline-none"
        />
        <div className="flex flex-row items-center">
          <Tooltip placement="bottom" content={t('button.includes_user_questions')} delay={800}>
            <ActionIconButton
              onClick={() => {
                setIncludeUser(!includeUser)
                refocusInput()
              }}
              icon={<User size={18} style={{ color: includeUser ? 'var(--primary)' : 'var(--muted-foreground)' }} />}
            />
          </Tooltip>
          <Tooltip placement="bottom" content={t('button.case_sensitive')} delay={800}>
            <ActionIconButton
              onClick={() => {
                setIsCaseSensitive(!isCaseSensitive)
                refocusInput()
              }}
              icon={
                <CaseSensitive
                  size={18}
                  style={{ color: isCaseSensitive ? 'var(--primary)' : 'var(--muted-foreground)' }}
                />
              }
            />
          </Tooltip>
          <Tooltip placement="bottom" content={t('button.whole_word')} delay={800}>
            <ActionIconButton
              onClick={() => {
                setIsWholeWord(!isWholeWord)
                refocusInput()
              }}
              icon={
                <WholeWord size={18} style={{ color: isWholeWord ? 'var(--primary)' : 'var(--muted-foreground)' }} />
              }
            />
          </Tooltip>
        </div>
      </div>
      <div className="mx-[2px] h-[1.5em] w-px flex-[0_0_auto] bg-border" />
      <div className="mx-[2px] flex w-20 flex-[0_0_auto] justify-center font-[Ubuntu] text-[14px] text-foreground">
        {matches.length > 0 ? (
          <>
            <span>{currentIndex + 1}</span>
            <span className="mx-1">/</span>
            <span>{matches.length}</span>
          </>
        ) : (
          <span className="opacity-50">0/0</span>
        )}
      </div>
      <div className="flex flex-row items-center">
        <ActionIconButton
          onClick={() => {
            step(-1)
            refocusInput()
          }}
          disabled={matches.length === 0}
          icon={<ChevronUp size={18} />}
        />
        <ActionIconButton
          onClick={() => {
            step(1)
            refocusInput()
          }}
          disabled={matches.length === 0}
          icon={<ChevronDown size={18} />}
        />
        <ActionIconButton onClick={disable} icon={<X size={18} />} />
      </div>
    </div>
  )
}
