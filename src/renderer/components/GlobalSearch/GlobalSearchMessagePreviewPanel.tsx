import { Button } from '@cherrystudio/ui'
import { useInfiniteFlatItems } from '@data/hooks/useDataApi'
import MessageContent from '@renderer/components/chat/messages/frame/MessageContent'
import { MessageContentProvider } from '@renderer/components/chat/messages/MessageContentProvider'
import type { MessageListItem } from '@renderer/components/chat/messages/types'
import { toMessageListItem } from '@renderer/components/chat/messages/utils/messageListItem'
import { DynamicVirtualList, type DynamicVirtualListRef } from '@renderer/components/VirtualList'
import { toAgentSessionUIMessage } from '@renderer/hooks/useAgentSessionParts'
import { useConversationHistoryQuery } from '@renderer/hooks/useConversationHistoryQuery'
import { type Topic, TopicType } from '@renderer/types/topic'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { sharedMessageToUIMessage, uiMessagesToPartsMap } from '@renderer/utils/message/messageProjection'
import { cn } from '@renderer/utils/style'
import type { CherryUIMessage } from '@shared/data/types/message'
import { buildKeywordRegexes, splitKeywordsToTerms } from '@shared/utils/keywordSearch'
import { defaultRangeExtractor, type Range } from '@tanstack/react-virtual'
import { ExternalLink, MessageSquare, MousePointerClick, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type GlobalSearchMessagePreviewTarget =
  | {
      sourceType: 'topic'
      topicId: string
      title: string
      messageId: string
      assistantId?: string
      createdAt?: string
      updatedAt?: string
    }
  | {
      sourceType: 'session'
      sessionId: string
      title: string
      messageId: string
      agentId?: string
      createdAt?: string
    }

interface GlobalSearchMessagePreviewPanelProps {
  className?: string
  searchQuery: string
  target: GlobalSearchMessagePreviewTarget
  onClose: () => void
  onOpenMessage: (messageId: string) => void
}

const PREVIEW_PAGE_SIZE = 50
const PREVIEW_MESSAGE_ESTIMATED_HEIGHT = 240
const PREVIEW_MESSAGE_OVERSCAN = 3
// Distance (px) from the top of the scroll container at which scrolling up loads an older page.
const LOAD_OLDER_SCROLL_THRESHOLD = 200
const PREVIEW_MATCH_MODE = 'substring'
const HIGHLIGHT_MARK_SELECTOR = 'mark[data-global-search-preview-highlight="true"]'
const MESSAGE_BODY_SELECTOR = '[data-global-search-preview-message-body="true"]'
const TEXT_NODE_PARENT_SKIP_SELECTOR = 'script, style, svg, mark'

function getPreviewTopic(target: GlobalSearchMessagePreviewTarget): Topic {
  if (target.sourceType === 'topic') {
    return {
      id: target.topicId,
      assistantId: target.assistantId ?? '',
      name: target.title,
      lastActivityAt: target.updatedAt ?? target.createdAt ?? '',
      createdAt: target.createdAt ?? '',
      updatedAt: target.updatedAt ?? target.createdAt ?? '',
      messages: []
    } as Topic
  }

  return {
    id: buildAgentSessionTopicId(target.sessionId),
    type: TopicType.Session,
    assistantId: target.agentId ?? '',
    name: target.title,
    lastActivityAt: target.createdAt ?? '',
    createdAt: target.createdAt ?? '',
    updatedAt: target.createdAt ?? '',
    messages: []
  } as Topic
}

function getTargetMessageType(target: GlobalSearchMessagePreviewTarget) {
  return target.sourceType === 'topic'
    ? 'globalSearch.messageSearch.sources.topic'
    : 'globalSearch.messageSearch.sources.session'
}

function getMessageRoleLabelKey(role: string) {
  switch (role) {
    case 'assistant':
      return 'globalSearch.messageSearch.roles.assistant'
    case 'system':
      return 'globalSearch.messageSearch.roles.system'
    case 'tool':
      return 'globalSearch.messageSearch.roles.tool'
    default:
      return 'globalSearch.messageSearch.roles.user'
  }
}

function unwrapPreviewHighlights(root: HTMLElement) {
  const marks = Array.from(root.querySelectorAll(HIGHLIGHT_MARK_SELECTOR))
  for (const mark of marks) {
    const parent = mark.parentNode
    if (!parent) continue

    mark.replaceWith(document.createTextNode(mark.textContent ?? ''))
    parent.normalize()
  }
}

function highlightTextNode(textNode: Text, regex: RegExp) {
  const text = textNode.nodeValue ?? ''
  regex.lastIndex = 0
  if (!regex.test(text)) return

  regex.lastIndex = 0
  const fragment = document.createDocumentFragment()
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > cursor) {
      fragment.append(document.createTextNode(text.slice(cursor, match.index)))
    }

    const mark = document.createElement('mark')
    mark.dataset.globalSearchPreviewHighlight = 'true'
    mark.className =
      'rounded-[3px] [background-color:var(--highlight-accent)] px-0.5 [color:var(--highlight-foreground)]'
    mark.textContent = match[0]
    fragment.append(mark)
    cursor = match.index + match[0].length

    if (match[0].length === 0) {
      regex.lastIndex += 1
    }
  }

  if (cursor < text.length) {
    fragment.append(document.createTextNode(text.slice(cursor)))
  }

  textNode.replaceWith(fragment)
}

function highlightPreviewMatches(root: HTMLElement, regex: RegExp) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || parent.closest(TEXT_NODE_PARENT_SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT
      if (!parent.closest(MESSAGE_BODY_SELECTOR)) return NodeFilter.FILTER_REJECT
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    }
  })
  const textNodes: Text[] = []
  let node = walker.nextNode()

  while (node) {
    textNodes.push(node as Text)
    node = walker.nextNode()
  }

  for (const textNode of textNodes) {
    highlightTextNode(textNode, regex)
  }
}

function buildPreviewHighlightRegex(searchQuery: string): RegExp | undefined {
  const regexes = buildKeywordRegexes(splitKeywordsToTerms(searchQuery), {
    matchMode: PREVIEW_MATCH_MODE,
    flags: 'gi'
  })
  if (regexes.length === 0) return undefined

  return new RegExp(regexes.map((regex) => `(?:${regex.source})`).join('|'), regexes[0].flags)
}

interface PreviewMessageRowProps {
  message: MessageListItem
  highlightRegex?: RegExp
  isActive: boolean
  roleLabel: string
  onOpen: (messageId: string) => void
}

function PreviewMessageRow({ message, highlightRegex, isActive, roleLabel, onOpen }: PreviewMessageRowProps) {
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return

    unwrapPreviewHighlights(body)
    if (highlightRegex) highlightPreviewMatches(body, highlightRegex)
  }, [highlightRegex, message])

  return (
    <div className="pb-4">
      <div
        id={`global-search-preview-message-${message.id}`}
        role="button"
        tabIndex={0}
        onClick={() => onOpen(message.id)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return

          event.preventDefault()
          onOpen(message.id)
        }}
        className={cn(
          '-mx-3 w-[calc(100%+1.5rem)] cursor-pointer rounded-xl border border-transparent px-3 py-2 text-left transition-colors hover:bg-muted/35 focus-visible:bg-muted/35 focus-visible:outline-none',
          isActive && 'border-border-selected bg-accent/55'
        )}>
        <div className="mb-1 font-medium text-muted-foreground text-xs">{roleLabel}</div>
        <div ref={bodyRef} data-global-search-preview-message-body="true">
          <MessageContent message={message} />
        </div>
      </div>
    </div>
  )
}

function estimatePreviewMessageSize() {
  return PREVIEW_MESSAGE_ESTIMATED_HEIGHT
}

export function GlobalSearchMessagePreviewPanel({
  className,
  searchQuery,
  target,
  onClose,
  onOpenMessage
}: GlobalSearchMessagePreviewPanelProps) {
  const { t } = useTranslation()
  const virtualListRef = useRef<DynamicVirtualListRef>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // Distance from the bottom captured before an older page is prepended, used to restore the scroll
  // position. Distance-from-bottom is invariant to content prepended at the top (incl. the spinner).
  const pendingOlderAnchorRef = useRef<number | null>(null)
  // The active message id we have already auto-scrolled to, so prepending older pages does not yank back.
  const scrolledActiveMessageIdRef = useRef<string | null>(null)
  const [activeMessageId, setActiveMessageId] = useState(target.messageId)
  const topicId = target.sourceType === 'topic' ? target.topicId : ''
  const sessionId = target.sourceType === 'session' ? target.sessionId : ''
  const {
    pages: topicPages,
    isLoading: isTopicLoading,
    isRefreshing: isTopicRefreshing,
    error: topicError,
    hasNext: hasNextTopicPage,
    loadNext: loadNextTopicPage
  } = useConversationHistoryQuery('/topics/:topicId/messages', {
    params: { topicId },
    query: { includeSiblings: false, nodeId: target.sourceType === 'topic' ? target.messageId : undefined },
    limit: PREVIEW_PAGE_SIZE,
    enabled: target.sourceType === 'topic'
  })
  const {
    pages: sessionPages,
    isLoading: isSessionLoading,
    isRefreshing: isSessionRefreshing,
    error: sessionError,
    hasNext: hasNextSessionPage,
    loadNext: loadNextSessionPage
  } = useConversationHistoryQuery('/agent-sessions/:sessionId/messages', {
    params: { sessionId },
    query: {
      messageId: target.sourceType === 'session' ? target.messageId : undefined,
      deferToolOutputs: true
    },
    limit: PREVIEW_PAGE_SIZE,
    enabled: target.sourceType === 'session'
  })

  const topicBranchItems = useInfiniteFlatItems(topicPages, { reversePages: true })
  const sessionRows = useInfiniteFlatItems(sessionPages, { reversePages: true, reverseItems: true })
  const messages = useMemo<CherryUIMessage[]>(() => {
    if (target.sourceType === 'topic') {
      return topicBranchItems.map((item) => sharedMessageToUIMessage(item.message))
    }

    return sessionRows.map(toAgentSessionUIMessage)
  }, [sessionRows, target.sourceType, topicBranchItems])
  const partsByMessageId = useMemo(() => uiMessagesToPartsMap(messages), [messages])
  const previewTopic = useMemo(() => getPreviewTopic(target), [target])
  const messageItems = useMemo(
    () =>
      messages.map((message) =>
        toMessageListItem(message, {
          assistantId: target.sourceType === 'topic' ? target.assistantId : target.agentId,
          topicId: previewTopic.id
        })
      ),
    [messages, previewTopic.id, target]
  )
  const isLoading = target.sourceType === 'topic' ? isTopicLoading : isSessionLoading
  const isLoadingMore =
    target.sourceType === 'topic'
      ? isTopicRefreshing && messages.length > 0
      : isSessionRefreshing && messages.length > 0
  const error = target.sourceType === 'topic' ? topicError : sessionError
  const hasMoreOlder = target.sourceType === 'topic' ? hasNextTopicPage : hasNextSessionPage
  const loadOlder = target.sourceType === 'topic' ? loadNextTopicPage : loadNextSessionPage
  const highlightRegex = useMemo(() => buildPreviewHighlightRegex(searchQuery), [searchQuery])
  const activeMessageIndex = useMemo(
    () => messageItems.findIndex((message) => message.id === activeMessageId),
    [activeMessageId, messageItems]
  )
  const extractPreviewRange = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range)
      if (activeMessageIndex < 0 || indexes.includes(activeMessageIndex)) return indexes

      return [...indexes, activeMessageIndex].sort((left, right) => left - right)
    },
    [activeMessageIndex]
  )
  const getMessageKey = useCallback((index: number) => messageItems[index].id, [messageItems])

  // Scrolling near the top loads the next (older) page. Topic and session share this path because
  // both endpoints walk newest-first via the same hasNext/loadNext contract.
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container || !hasMoreOlder) return
    if (pendingOlderAnchorRef.current !== null) return
    if (container.scrollTop > LOAD_OLDER_SCROLL_THRESHOLD) return

    pendingOlderAnchorRef.current = container.scrollHeight - container.scrollTop
    loadOlder()
  }, [hasMoreOlder, loadOlder])

  // After an older page is prepended, restore the scroll position so the view does not jump.
  useLayoutEffect(() => {
    const container = scrollContainerRef.current
    const previousDistanceFromBottom = pendingOlderAnchorRef.current
    if (!container || previousDistanceFromBottom === null) return

    container.scrollTop = container.scrollHeight - previousDistanceFromBottom
    if (!isLoadingMore) {
      pendingOlderAnchorRef.current = null
    }
  }, [isLoadingMore, messages])

  useEffect(() => {
    setActiveMessageId(target.messageId)
  }, [target.messageId])

  const openPreviewMessage = useCallback(
    (messageId: string) => {
      setActiveMessageId(messageId)
      window.requestAnimationFrame(() => {
        onOpenMessage(messageId)
      })
    },
    [onOpenMessage]
  )

  useEffect(() => {
    // Only auto-scroll once per active message; prepending older pages must not pull the view back.
    if (scrolledActiveMessageIdRef.current === activeMessageId) return
    if (activeMessageIndex < 0) return

    scrolledActiveMessageIdRef.current = activeMessageId
    virtualListRef.current?.scrollToIndex(activeMessageIndex, { align: 'center' })
    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById(`global-search-preview-message-${activeMessageId}`)
      const highlight = element?.querySelector(`${MESSAGE_BODY_SELECTOR} ${HIGHLIGHT_MARK_SELECTOR}`)
      const scrollTarget = highlight ?? element
      if (typeof scrollTarget?.scrollIntoView !== 'function') return

      scrollTarget.scrollIntoView({ block: 'center' })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activeMessageId, activeMessageIndex])

  return (
    <aside className={cn('relative flex min-h-0 flex-col bg-background', className)}>
      <div className="flex h-14 shrink-0 items-center gap-3 border-border-subtle border-b px-5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted/50 text-muted-foreground">
          {target.sourceType === 'topic' ? (
            <MessageSquare className="size-4" />
          ) : (
            <MousePointerClick className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground text-sm">{target.title || t('common.unnamed')}</div>
          <div className="text-muted-foreground text-xs">{t(getTargetMessageType(target))}</div>
        </div>
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={onClose}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>

      {isLoading && messages.length === 0 ? (
        <div className="min-h-0 flex-1 px-6 pt-5 pb-20">
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            {t('common.loading')}
          </div>
        </div>
      ) : error && messageItems.length === 0 ? (
        <div className="min-h-0 flex-1 px-6 pt-5 pb-20">
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            {t('globalSearch.error')}
          </div>
        </div>
      ) : messageItems.length === 0 ? (
        <div className="min-h-0 flex-1 px-6 pt-5 pb-20">
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            {t('common.no_results')}
          </div>
        </div>
      ) : (
        <MessageContentProvider
          messages={messageItems}
          partsByMessageId={partsByMessageId}
          topic={previewTopic}
          renderConfig={{ narrowMode: false, showMessageOutline: false }}>
          <DynamicVirtualList
            ref={virtualListRef}
            list={messageItems}
            estimateSize={estimatePreviewMessageSize}
            getItemKey={getMessageKey}
            overscan={PREVIEW_MESSAGE_OVERSCAN}
            rangeExtractor={extractPreviewRange}
            scrollElementRef={scrollContainerRef}
            onScroll={handleScroll}
            className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-20"
            header={
              <>
                {error && (
                  <div
                    role="alert"
                    className="mb-4 rounded-lg border border-error-border bg-error-subtle px-3 py-2 text-error-subtle-foreground text-xs leading-4">
                    {t('globalSearch.error')}
                  </div>
                )}
                {isLoadingMore && (
                  <div className="py-2 text-center text-muted-foreground text-xs">{t('common.loading')}</div>
                )}
              </>
            }>
            {(message) => (
              <PreviewMessageRow
                message={message}
                highlightRegex={highlightRegex}
                isActive={message.id === activeMessageId}
                roleLabel={t(getMessageRoleLabelKey(message.role))}
                onOpen={openPreviewMessage}
              />
            )}
          </DynamicVirtualList>
        </MessageContentProvider>
      )}

      <div className="pointer-events-none absolute right-0 bottom-0 left-0 flex justify-center bg-gradient-to-t from-background via-background/90 to-transparent px-4 pt-8 pb-4">
        <Button
          type="button"
          variant="ghost"
          className="pointer-events-auto h-8 gap-1.5 rounded-full border border-border-subtle bg-background/95 px-3 font-medium text-xs shadow-sm hover:bg-muted/70"
          onClick={() => openPreviewMessage(activeMessageId)}>
          <ExternalLink className="size-3.5" />
          {t('common.open')}
        </Button>
      </div>
    </aside>
  )
}
