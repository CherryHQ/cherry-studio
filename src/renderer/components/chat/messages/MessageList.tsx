import { useChatLayoutMode } from '@renderer/components/chat/layout/ChatLayoutModeContext'
import { useChatBottomOverlayInset } from '@renderer/components/chat/layout/ChatViewportInsetContext'
import MultiSelectActionPopup from '@renderer/components/chat/messages/MultiSelectActionPopup'
import LoadingIcon from '@renderer/components/icons/LoadingIcon'
import SelectionContextMenu from '@renderer/components/SelectionContextMenu'
import { useTimer } from '@renderer/hooks/useTimer'
import { removeSpecialCharactersForFileName } from '@renderer/utils/file'
import { captureScrollable, captureScrollableAsDataUrl } from '@renderer/utils/image'
import { classNames } from '@renderer/utils/style'
import type { MultiModelMessageStyle } from '@shared/data/preference/preferenceTypes'
import type { CherryMessagePart } from '@shared/data/types/message'
import { type ComponentProps, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import NarrowLayout from '../layout/NarrowLayout'
import { PartsProvider, usePartsMap } from './blocks/MessagePartsContext'
import MessageOutline from './frame/MessageOutline'
import { MessageListInitialLoading } from './layout/MessageListLoading'
import { MessagesContainer } from './layout/shared'
import MessageAnchorLine from './list/MessageAnchorLine'
import MessageGroup from './list/MessageGroup'
import MessageNavigation from './list/MessageNavigation'
import {
  MESSAGE_VIRTUAL_LIST_DEFAULT_BOTTOM_PADDING_PX,
  MESSAGE_VIRTUAL_LIST_DEFAULT_TOP_PADDING_PX,
  MessageVirtualList,
  type MessageVirtualListHandle
} from './list/MessageVirtualList'
import SelectionBox from './list/SelectionBox'
import {
  useMessageListActions,
  useMessageListData,
  useMessageListMeta,
  useMessageListSelection,
  useMessageListUi,
  useMessageRenderConfig
} from './MessageListProvider'
import { defaultMessageRenderConfig } from './types'
import { getLatestAssistantGroupKey } from './utils/messageGroupKey'
import { shouldUseWideLayoutForMessageGroup } from './utils/messageGroupLayout'
import { getDirectAssistantModelsByUserId, shareDirectAssistantModelsByUserId } from './utils/messageListItem'
import { createStableAnchorMessagesCache, stableAnchorMessages } from './utils/stableAnchorMessages'
import { createStableGroupedMessagesCache, stableGroupedMessages } from './utils/stableGroupedMessages'

const MULTI_SELECT_BOTTOM_PADDING_PX = 96
const MESSAGE_OUTLINE_LAYOUTS: MultiModelMessageStyle[] = ['horizontal', 'vertical', 'fold', 'grid']
/** Chat content's side padding — matches NarrowLayout's `px-6`, so the inline
 * override is invisible until the rail gutter adds onto it. */
const CHAT_SIDE_PADDING_PX = 24
/** Max gutter the content yields on both sides as the column widens. The total
 * (base + max = 48px) exactly covers the rail's 32px hit strip + its margin, so
 * hover growth never touches the content nor does content enter the strip. */
const RAIL_GUTTER_MAX_PX = 24
/** Below this chat-column width the content keeps its full width and the rail is gone. */
const RAIL_GUTTER_START_PX = 700
/** Width range over which the gutter grows in and the rail fades in — a smooth ramp. */
const RAIL_GUTTER_FADE_PX = 120
const EMPTY_LIVE_MESSAGE_IDS: readonly string[] = []
const EMPTY_PARTS_BY_MESSAGE_ID: Record<string, CherryMessagePart[]> = {}

interface ActiveMessageOutline {
  messageId: string
  multiModelMessageStyle: MultiModelMessageStyle
}

type TopicImageRuntimeAction = 'copy' | 'export'

interface PendingTopicImageRuntimeAction {
  action: TopicImageRuntimeAction
  captureWidth?: number
  reject: (reason?: unknown) => void
  resolve: () => void
}

const pendingTopicImageActionsByTopic = new Map<string, PendingTopicImageRuntimeAction[]>()

function enqueuePendingTopicImageAction(topicId: string, action: PendingTopicImageRuntimeAction): void {
  const pendingActions = pendingTopicImageActionsByTopic.get(topicId) ?? []
  pendingActions.push(action)
  pendingTopicImageActionsByTopic.set(topicId, pendingActions)
}

function takePendingTopicImageActions(topicId: string): PendingTopicImageRuntimeAction[] {
  const pendingActions = pendingTopicImageActionsByTopic.get(topicId)
  if (!pendingActions) return []

  pendingTopicImageActionsByTopic.delete(topicId)
  return pendingActions
}

function rejectPendingTopicImageActions(topicId: string, reason: unknown): void {
  for (const pendingAction of takePendingTopicImageActions(topicId)) {
    pendingAction.reject(reason)
  }
}

function getMessageElementLayout(element: HTMLElement): MultiModelMessageStyle {
  return MESSAGE_OUTLINE_LAYOUTS.find((layout) => element.classList.contains(layout)) ?? 'fold'
}

type MessageGroupLayerProps = ComponentProps<typeof MessageGroup> & {
  groupKey: string
  isLive: boolean
  narrowMode: boolean
  railGutterPx: number
}

function MessageGroupLayer({
  groupKey,
  isLive,
  narrowMode,
  railGutterPx,
  messages,
  partsByMessageId,
  ...messageGroupProps
}: MessageGroupLayerProps) {
  void isLive
  return (
    <PartsProvider value={partsByMessageId ?? null}>
      <NarrowLayout
        narrowMode={narrowMode}
        withSidePadding
        // The gutter is mirrored on the left so the column stays
        // centred and both margins match while the rail fades in.
        style={{
          paddingLeft: CHAT_SIDE_PADDING_PX + railGutterPx,
          paddingRight: CHAT_SIDE_PADDING_PX + railGutterPx
        }}>
        <MessageGroup key={groupKey} {...messageGroupProps} messages={messages} partsByMessageId={partsByMessageId} />
      </NarrowLayout>
    </PartsProvider>
  )
}

function groupPartsShallowEqual(
  previous: MessageGroupLayerProps['partsByMessageId'],
  next: MessageGroupLayerProps['partsByMessageId'],
  messages: MessageGroupLayerProps['messages']
): boolean {
  if (previous === next) return true
  return messages.every((message) => previous?.[message.id] === next?.[message.id])
}

/**
 * One component identity owns both sealed history and the mutable live tail.
 * A boundary transition must update a group without remounting its stateful
 * markdown and code-block descendants.
 *
 * Live groups always update. Historical groups compare only their own parts,
 * so rebuilding the map container does not invalidate unrelated history.
 * The per-group layout callback identity is deliberately ignored because the
 * virtual item key guarantees that it closes over the same group.
 */
const MessageLayer = memo(MessageGroupLayer, (previous, next) => {
  if (previous.isLive || next.isLive) return false
  return (
    previous.groupKey === next.groupKey &&
    previous.narrowMode === next.narrowMode &&
    previous.railGutterPx === next.railGutterPx &&
    previous.messages === next.messages &&
    groupPartsShallowEqual(previous.partsByMessageId, next.partsByMessageId, next.messages) &&
    previous.captureMode === next.captureMode &&
    previous.registerMessageElement === next.registerMessageElement &&
    previous.isLatestAssistantGroup === next.isLatestAssistantGroup &&
    previous.directAssistantModelsByUserId === next.directAssistantModelsByUserId &&
    previous.messageTail === next.messageTail
  )
})

const MessageList = () => {
  const data = useMessageListData()
  const actions = useMessageListActions()
  const meta = useMessageListMeta()
  const renderConfig = useMessageRenderConfig() ?? defaultMessageRenderConfig
  const selection = useMessageListSelection()
  const messageUi = useMessageListUi()
  const partsByMessageId = usePartsMap()
  // The rail gutter lives in the chat layout context (single source of truth) so
  // the composer yields the same right-hand space and stays aligned with the
  // message column; this component both writes it (via the resize observer
  // below) and renders from it.
  const { setForceWideLayout, railGutterPx, setRailGutterPx } = useChatLayoutMode()
  const { topic, messages, beforeList, messageTail, hasOlder = false, messageNavigation } = data
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const { setTimeoutTimer } = useTimer()
  const isMultiSelectMode = selection?.isMultiSelectMode ?? false
  const selectedMessageIds = selection?.selectedMessageIds ?? []
  const [activeOutline, setActiveOutline] = useState<ActiveMessageOutline | null>(null)
  const [activeAnchorMessageId, setActiveAnchorMessageId] = useState<string | null>(null)
  const bottomOverlayInsets = useChatBottomOverlayInset()

  // The gutter follows only the width (and the anchor preference) — NOT the turn
  // count. With anchor navigation on, a wide window always yields the gutter, so
  // when the conversation grows past the rail's turn threshold the rail simply
  // fades into space that was already there, with no content jump.

  const messageListRef = useRef<MessageVirtualListHandle | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const topicImageCaptureRef = useRef<HTMLDivElement | null>(null)
  const messageElements = useRef<Map<string, HTMLElement>>(new Map())
  const isLoadingMoreRef = useRef(false)
  const [groupLayoutOverrides, setGroupLayoutOverrides] = useState<Record<string, MultiModelMessageStyle>>({})
  const [topicImageCaptureActions, setTopicImageCaptureActions] = useState<PendingTopicImageRuntimeAction[]>([])
  const topicImageCaptureActionsRef = useRef<PendingTopicImageRuntimeAction[]>([])

  const groupedMessagesCacheRef = useRef(createStableGroupedMessagesCache())
  const groupedMessages = useMemo(() => stableGroupedMessages(messages, groupedMessagesCacheRef.current), [messages])
  // Streaming allocates a fresh `messages` array per chunk, so the anchor rail
  // needs a projection that only changes when its topology does — otherwise its
  // `memo` never bails and every chunk re-renders all of its ticks.
  const anchorMessagesCacheRef = useRef(createStableAnchorMessagesCache())
  const anchorMessages = useMemo(() => stableAnchorMessages(messages, anchorMessagesCacheRef.current), [messages])
  const messageById = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages])
  const directAssistantModelsByUserIdRef = useRef<ReturnType<typeof getDirectAssistantModelsByUserId> | undefined>(
    undefined
  )
  const directAssistantModelsByUserId = useMemo(() => {
    const next = getDirectAssistantModelsByUserId(messages)
    const shared = shareDirectAssistantModelsByUserId(directAssistantModelsByUserIdRef.current, next)
    directAssistantModelsByUserIdRef.current = shared
    return shared
  }, [messages])
  const messageByIdRef = useRef(messageById)
  messageByIdRef.current = messageById
  const latestAssistantGroupKey = useMemo(() => getLatestAssistantGroupKey(messages), [messages])
  const streamingLayers = data.streamingLayers
  const liveMessageIds = streamingLayers?.liveMessageIds ?? EMPTY_LIVE_MESSAGE_IDS
  const liveMessageIdSet = useMemo(() => new Set(liveMessageIds), [liveMessageIds])
  const firstLiveGroupIndex = useMemo(() => {
    if (!streamingLayers) return 0
    if (liveMessageIds.length === 0) return groupedMessages.length

    const liveIndex = groupedMessages.findIndex(([, groupMessages]) =>
      groupMessages.some((message) => liveMessageIdSet.has(message.id))
    )
    // Stream status can arrive before its placeholder joins the visible list.
    return liveIndex >= 0 ? liveIndex : groupedMessages.length
  }, [groupedMessages, liveMessageIdSet, liveMessageIds.length, streamingLayers])
  const { bindRuntime, copyImage, loadOlder, saveImage } = actions
  const getMessageUiState = useCallback(
    (messageId: string) => messageUi.getMessageUiState?.(messageId) ?? {},
    [messageUi]
  )
  const useWideMessageLayout = useMemo(
    () =>
      groupedMessages.some(([key, groupMessages]) =>
        shouldUseWideLayoutForMessageGroup(
          groupMessages,
          (messageId) => {
            const uiState = getMessageUiState(messageId)
            return {
              ...uiState,
              multiModelMessageStyle: groupLayoutOverrides[key] ?? uiState.multiModelMessageStyle
            }
          },
          renderConfig.multiModelMessageStyle,
          isMultiSelectMode
        )
      ),
    [getMessageUiState, groupLayoutOverrides, groupedMessages, isMultiSelectMode, renderConfig.multiModelMessageStyle]
  )
  const messageListNarrowMode = renderConfig.narrowMode && !useWideMessageLayout
  const shouldTrackMessageOutline = renderConfig.showMessageOutline && !isMultiSelectMode

  useEffect(() => {
    setForceWideLayout(useWideMessageLayout)
    return () => setForceWideLayout(false)
  }, [setForceWideLayout, useWideMessageLayout])

  const registerMessageElement = useCallback((id: string, element: HTMLElement | null) => {
    if (element) {
      messageElements.current.set(id, element)
    } else {
      messageElements.current.delete(id)
    }
  }, [])

  const getMessageElement = useCallback((id: string) => messageElements.current.get(id) ?? null, [])

  const scrollToBottom = useCallback(() => {
    messageListRef.current?.scrollToBottom()
  }, [])

  // Navigation buttons scroll through the virtua-aware runtime handle (smooth,
  // remeasure-safe) rather than a raw scrollTo on the virtualized scroller.
  const navigateToTop = useCallback(() => {
    messageListRef.current?.scrollToTop('smooth')
  }, [])

  const navigateToBottom = useCallback(() => {
    messageListRef.current?.scrollToBottom()
  }, [])

  const scrollToMessageById = useCallback((messageId: string) => {
    const target = messageByIdRef.current.get(messageId)
    if (!target) return
    const groupKey =
      target.role === 'assistant' && target.parentId ? 'assistant' + target.parentId : target.role + target.id
    messageListRef.current?.scrollToKey(groupKey, 'start')
  }, [])

  const scrollToOutlineElement = useCallback((element: HTMLElement) => {
    messageListRef.current?.scrollToElement(element)
  }, [])

  const updateActiveMessageOutline = useCallback(() => {
    if (!shouldTrackMessageOutline) {
      setActiveOutline((current) => (current ? null : current))
      return
    }

    const scrollElement = scrollContainerRef.current ?? messageListRef.current?.getScrollElement()
    if (!scrollElement) {
      setActiveOutline(null)
      return
    }

    const containerRect = scrollElement.getBoundingClientRect()
    const viewportCenter = containerRect.top + containerRect.height / 2
    let bestMatch: { messageId: string; multiModelMessageStyle: MultiModelMessageStyle; distance: number } | null = null

    for (const [messageId, element] of messageElements.current) {
      const message = messageById.get(messageId)
      if (!message) {
        messageElements.current.delete(messageId)
        continue
      }
      if (message.role !== 'assistant' || message.isContextBoundary) continue

      if (!element.isConnected || !scrollElement.contains(element)) {
        messageElements.current.delete(messageId)
        continue
      }

      const rect = element.getBoundingClientRect()
      const visibleHeight = Math.min(rect.bottom, containerRect.bottom) - Math.max(rect.top, containerRect.top)
      if (visibleHeight <= 0) continue

      const distance =
        rect.top <= viewportCenter && rect.bottom >= viewportCenter
          ? 0
          : Math.min(Math.abs(rect.top - viewportCenter), Math.abs(rect.bottom - viewportCenter))

      if (!bestMatch || distance < bestMatch.distance) {
        bestMatch = {
          messageId: message.id,
          multiModelMessageStyle: getMessageElementLayout(element),
          distance
        }
      }
    }

    setActiveOutline((current) => {
      if (
        current?.messageId === bestMatch?.messageId &&
        current?.multiModelMessageStyle === bestMatch?.multiModelMessageStyle
      ) {
        return current
      }
      return bestMatch
        ? {
            messageId: bestMatch.messageId,
            multiModelMessageStyle: bestMatch.multiModelMessageStyle
          }
        : null
    })
  }, [messageById, shouldTrackMessageOutline])
  const updateActiveMessageOutlineRef = useRef(updateActiveMessageOutline)
  updateActiveMessageOutlineRef.current = updateActiveMessageOutline
  const activeMessageOutlineFrameRef = useRef<number | null>(null)
  const requestActiveMessageOutlineUpdate = useCallback(() => {
    if (activeMessageOutlineFrameRef.current !== null) return

    activeMessageOutlineFrameRef.current = requestAnimationFrame(() => {
      activeMessageOutlineFrameRef.current = null
      updateActiveMessageOutlineRef.current()
    })
  }, [])
  const cancelActiveMessageOutlineUpdate = useCallback(() => {
    if (activeMessageOutlineFrameRef.current === null) return
    cancelAnimationFrame(activeMessageOutlineFrameRef.current)
    activeMessageOutlineFrameRef.current = null
  }, [])

  const shouldTrackAnchorPosition = messageNavigation === 'anchor'

  // Anchor rail counterpart of the outline tracker: resolve the message near
  // the viewport top (any role) so the rail can darken the current turn's tick.
  // Top-aligned so a turn jumped to via its tick immediately reads as current;
  // at the very bottom the last turn wins regardless of its height.
  const updateActiveAnchorMessage = useCallback(() => {
    if (!shouldTrackAnchorPosition) return

    const scrollElement = scrollContainerRef.current ?? messageListRef.current?.getScrollElement()
    if (!scrollElement) return

    const containerRect = scrollElement.getBoundingClientRect()
    const scrollRange = scrollElement.scrollHeight - scrollElement.clientHeight
    const atBottom = scrollElement.scrollTop >= scrollRange - 2
    // The reading line sits near the viewport top (so a turn jumped to via its
    // tick immediately reads as current); at the very bottom it clamps to the
    // bottom edge so the last turn wins regardless of its height.
    const readingLineY = atBottom
      ? containerRect.bottom - 1
      : containerRect.top + Math.min(120, containerRect.height * 0.25)
    let bestMatch: { messageId: string; distance: number } | null = null

    for (const [messageId, element] of messageElements.current) {
      const message = messageById.get(messageId)
      if (!message || message.isContextBoundary) continue
      if (!element.isConnected || !scrollElement.contains(element)) continue

      const rect = element.getBoundingClientRect()
      const visibleHeight = Math.min(rect.bottom, containerRect.bottom) - Math.max(rect.top, containerRect.top)
      if (visibleHeight <= 0) continue

      const distance =
        rect.top <= readingLineY && rect.bottom >= readingLineY
          ? 0
          : Math.min(Math.abs(rect.top - readingLineY), Math.abs(rect.bottom - readingLineY))

      if (!bestMatch || distance < bestMatch.distance) {
        bestMatch = { messageId, distance }
      }
    }

    const nextId = bestMatch?.messageId ?? null
    setActiveAnchorMessageId((current) => (current === nextId ? current : nextId))
  }, [messageById, shouldTrackAnchorPosition])
  const updateActiveAnchorMessageRef = useRef(updateActiveAnchorMessage)
  updateActiveAnchorMessageRef.current = updateActiveAnchorMessage

  const loadMoreMessages = useCallback(() => {
    if (!hasOlder || isLoadingMoreRef.current || !loadOlder) return
    isLoadingMoreRef.current = true
    setIsLoadingMore(true)
    setTimeoutTimer(
      'message-list-load-older',
      () => {
        try {
          loadOlder()
        } finally {
          setTimeoutTimer(
            'message-list-load-older-spinner',
            () => {
              isLoadingMoreRef.current = false
              setIsLoadingMore(false)
            },
            data.loadingResetDelayMs
          )
        }
      },
      data.loadOlderDelayMs
    )
  }, [data.loadOlderDelayMs, data.loadingResetDelayMs, hasOlder, loadOlder, setTimeoutTimer])

  const executeTopicImageAction = useCallback(
    async (action: TopicImageRuntimeAction, captureRef: React.RefObject<HTMLElement | null>) => {
      if (action === 'copy') {
        const canvas = await captureScrollable(captureRef)
        const blob = canvas ? await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png')) : null
        if (!blob) {
          throw new Error('Failed to capture topic image')
        }
        await copyImage?.(blob)
        return
      }

      if (!meta.imageExportFileName || !saveImage) {
        throw new Error('Topic image export is unavailable')
      }

      const imageData = await captureScrollableAsDataUrl(captureRef)
      if (!imageData) {
        throw new Error('Failed to capture topic image')
      }

      const saved = await saveImage(removeSpecialCharactersForFileName(meta.imageExportFileName), imageData)
      if (saved === false) {
        throw new Error('Failed to save topic image')
      }
    },
    [copyImage, meta.imageExportFileName, saveImage]
  )

  const enqueueTopicImageCaptureAction = useCallback((action: TopicImageRuntimeAction) => {
    return new Promise<void>((resolve, reject) => {
      const scrollContainer = scrollContainerRef.current
      const captureWidth = scrollContainer?.clientWidth || scrollContainer?.getBoundingClientRect().width || undefined
      const captureAction = { action, captureWidth, reject, resolve }
      setTopicImageCaptureActions((current) => {
        const nextActions = [...current, captureAction]
        topicImageCaptureActionsRef.current = nextActions
        return nextActions
      })
    })
  }, [])

  const runTopicImageAction = useCallback(
    async (action: TopicImageRuntimeAction) => {
      if (data.isInitialLoading || !scrollContainerRef.current) {
        return new Promise<void>((resolve, reject) => {
          enqueuePendingTopicImageAction(topic.id, { action, reject, resolve })
        })
      }

      await enqueueTopicImageCaptureAction(action)
    },
    [data.isInitialLoading, enqueueTopicImageCaptureAction, topic.id]
  )
  const runtimeActionsRef = useRef({
    scrollToBottom,
    scrollToMessageById,
    runTopicImageAction
  })
  runtimeActionsRef.current = {
    scrollToBottom,
    scrollToMessageById,
    runTopicImageAction
  }

  const flushPendingTopicImageAction = useCallback(() => {
    if (data.isInitialLoading || !scrollContainerRef.current) return

    for (const pendingAction of takePendingTopicImageActions(topic.id)) {
      void enqueueTopicImageCaptureAction(pendingAction.action).then(pendingAction.resolve, pendingAction.reject)
    }
  }, [data.isInitialLoading, enqueueTopicImageCaptureAction, topic.id])
  const handleScrollContainerReady = useCallback(
    (element: HTMLDivElement) => {
      scrollContainerRef.current = element
      flushPendingTopicImageAction()
    },
    [flushPendingTopicImageAction]
  )

  useEffect(() => {
    const topicId = topic.id
    return () => {
      const cancelReason = new Error('Topic image export was cancelled')
      rejectPendingTopicImageActions(topicId, cancelReason)
      for (const pendingAction of topicImageCaptureActionsRef.current) {
        pendingAction.reject(cancelReason)
      }
      topicImageCaptureActionsRef.current = []
    }
  }, [topic.id])

  const activeTopicImageCaptureAction = topicImageCaptureActions[0] ?? null

  useEffect(() => {
    topicImageCaptureActionsRef.current = topicImageCaptureActions
  }, [topicImageCaptureActions])

  useEffect(() => {
    if (!activeTopicImageCaptureAction || !topicImageCaptureRef.current) return

    let cancelled = false
    let secondFrame: number | undefined
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        if (cancelled) return

        void executeTopicImageAction(activeTopicImageCaptureAction.action, topicImageCaptureRef)
          .then(activeTopicImageCaptureAction.resolve, activeTopicImageCaptureAction.reject)
          .finally(() => {
            if (cancelled) return

            setTopicImageCaptureActions((current) => {
              const nextActions =
                current[0] === activeTopicImageCaptureAction
                  ? current.slice(1)
                  : current.filter((captureAction) => captureAction !== activeTopicImageCaptureAction)
              topicImageCaptureActionsRef.current = nextActions
              return nextActions
            })
          })
      })
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(firstFrame)
      if (secondFrame !== undefined) {
        cancelAnimationFrame(secondFrame)
      }
    }
  }, [activeTopicImageCaptureAction, executeTopicImageAction])

  useEffect(() => {
    scrollContainerRef.current = (messageListRef.current?.getScrollElement() as HTMLDivElement | null) ?? null
    flushPendingTopicImageAction()
  }, [flushPendingTopicImageAction, groupedMessages])

  useEffect(() => {
    if (shouldTrackMessageOutline) {
      requestActiveMessageOutlineUpdate()
      return
    }
    cancelActiveMessageOutlineUpdate()
    setActiveOutline((current) => (current ? null : current))
  }, [cancelActiveMessageOutlineUpdate, groupedMessages, requestActiveMessageOutlineUpdate, shouldTrackMessageOutline])

  useEffect(() => cancelActiveMessageOutlineUpdate, [cancelActiveMessageOutlineUpdate])

  useEffect(() => {
    if (!shouldTrackMessageOutline) return
    const scrollElement = messageListRef.current?.getScrollElement()
    if (!scrollElement) return

    const handleOutlineUpdate = requestActiveMessageOutlineUpdate
    scrollElement.addEventListener('scroll', handleOutlineUpdate, { passive: true })
    window.addEventListener('resize', handleOutlineUpdate)

    return () => {
      scrollElement.removeEventListener('scroll', handleOutlineUpdate)
      window.removeEventListener('resize', handleOutlineUpdate)
    }
  }, [data.isInitialLoading, data.listKey, requestActiveMessageOutlineUpdate, shouldTrackMessageOutline, topic.id])

  useEffect(() => {
    if (!shouldTrackAnchorPosition) {
      setActiveAnchorMessageId((current) => (current ? null : current))
      return
    }
    updateActiveAnchorMessage()
  }, [groupedMessages, shouldTrackAnchorPosition, updateActiveAnchorMessage])

  useEffect(() => {
    if (!shouldTrackAnchorPosition) {
      setRailGutterPx(0)
      return
    }
    const scrollElement = messageListRef.current?.getScrollElement()
    if (!scrollElement) return

    const updateRailGutter = () => {
      // The content yields a right-hand gutter that grows smoothly with the column
      // width; the rail fades in within it. Tracking width continuously (rather
      // than toggling at a threshold) means the content shifts smoothly and never
      // jumps, and the gutter collapses to 0 when narrow so no space is wasted.
      const ramp = (scrollElement.clientWidth - RAIL_GUTTER_START_PX) / RAIL_GUTTER_FADE_PX
      const gutter = Math.round(Math.max(0, Math.min(1, ramp)) * RAIL_GUTTER_MAX_PX)
      setRailGutterPx(gutter)
    }
    updateRailGutter()
    const resizeObserver = new ResizeObserver(updateRailGutter)
    resizeObserver.observe(scrollElement)

    let frame: number | null = null
    const handleAnchorUpdate = () => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        updateActiveAnchorMessageRef.current()
      })
    }
    scrollElement.addEventListener('scroll', handleAnchorUpdate, { passive: true })
    window.addEventListener('resize', handleAnchorUpdate)

    return () => {
      resizeObserver.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
      scrollElement.removeEventListener('scroll', handleAnchorUpdate)
      window.removeEventListener('resize', handleAnchorUpdate)
      // On unmount the composer must not keep yielding rail space.
      setRailGutterPx(0)
    }
  }, [data.isInitialLoading, data.listKey, setRailGutterPx, shouldTrackAnchorPosition, topic.id])

  useEffect(() => {
    return bindRuntime?.({
      scrollToBottom: () => runtimeActionsRef.current.scrollToBottom(),
      locateMessage: (messageId) => runtimeActionsRef.current.scrollToMessageById(messageId),
      copyTopicImage: () => runtimeActionsRef.current.runTopicImageAction('copy'),
      exportTopicImage: () => runtimeActionsRef.current.runTopicImageAction('export')
    })
  }, [bindRuntime])

  if (data.isInitialLoading && (messages.length === 0 || data.isMessagesStale)) {
    return <MessageListInitialLoading />
  }

  const activeOutlineMessage = activeOutline
    ? messages.find((message) => message.id === activeOutline.messageId)
    : undefined
  const latestAssistantGroupMessages = latestAssistantGroupKey
    ? groupedMessages.find(([key]) => key === latestAssistantGroupKey)?.[1]
    : undefined
  const shouldKeepLatestAssistantGroupMounted =
    latestAssistantGroupMessages?.some(
      (message) =>
        message.role === 'assistant' &&
        (messageUi.getMessageActivityState?.(message).isProcessing ?? message.status === 'pending')
    ) ?? false
  const keepMountedKeys =
    shouldKeepLatestAssistantGroupMounted && latestAssistantGroupKey ? [latestAssistantGroupKey] : []
  const defaultBottomPadding = isMultiSelectMode
    ? MULTI_SELECT_BOTTOM_PADDING_PX
    : MESSAGE_VIRTUAL_LIST_DEFAULT_BOTTOM_PADDING_PX
  const bottomPadding =
    bottomOverlayInsets == null
      ? defaultBottomPadding
      : Math.max(bottomOverlayInsets.contentBottomPadding, isMultiSelectMode ? defaultBottomPadding : 0)
  const scrollerBottomMargin = bottomOverlayInsets?.scrollerBottomMargin ?? 0
  const topPadding = MESSAGE_VIRTUAL_LIST_DEFAULT_TOP_PADDING_PX
  const topicImageCaptureWidth = activeTopicImageCaptureAction?.captureWidth

  return (
    <MessagesContainer
      id="messages"
      className={classNames(['messages-container', { 'multi-select-mode': isMultiSelectMode }])}
      key={data.listKey}>
      {beforeList && (
        <NarrowLayout
          narrowMode={messageListNarrowMode}
          withSidePadding
          className="shrink-0"
          style={{
            paddingLeft: CHAT_SIDE_PADDING_PX + railGutterPx,
            paddingRight: CHAT_SIDE_PADDING_PX + railGutterPx
          }}>
          {beforeList}
        </NarrowLayout>
      )}
      <SelectionContextMenu>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <MessageVirtualList
            handleRef={messageListRef}
            items={groupedMessages}
            getItemKey={([key]) => key}
            estimateSize={data.estimateSize}
            overscan={data.overscan}
            topPadding={topPadding}
            bottomPadding={bottomPadding}
            keepMountedKeys={keepMountedKeys}
            showScrollToBottomButton
            scrollToBottomButtonBottomOffset={Math.max(24, bottomPadding)}
            topicId={topic.id}
            hasMoreTop={hasOlder}
            onScrollContainerReady={handleScrollContainerReady}
            onReachTop={loadMoreMessages}
            renderItem={([key, groupMessages], index) => {
              const groupMessageTail =
                messageTail && groupMessages.some((message) => message.id === messageTail.messageId)
                  ? messageTail
                  : undefined
              const props: MessageGroupLayerProps = {
                groupKey: key,
                isLive: index >= firstLiveGroupIndex,
                narrowMode: messageListNarrowMode,
                railGutterPx,
                isLatestAssistantGroup: key === latestAssistantGroupKey,
                directAssistantModelsByUserId,
                messageTail: groupMessageTail,
                messages: groupMessages,
                partsByMessageId:
                  index < firstLiveGroupIndex && streamingLayers
                    ? streamingLayers.historyPartsByMessageId
                    : partsByMessageId,
                registerMessageElement,
                onMultiModelMessageStyleChange: (style) => {
                  setGroupLayoutOverrides((current) =>
                    current[key] === style ? current : { ...current, [key]: style }
                  )
                }
              }

              return <MessageLayer {...props} />
            }}
            style={{ flex: 1, minHeight: 0, marginBottom: scrollerBottomMargin }}
          />
          {isLoadingMore && (
            <div
              className="pointer-events-none flex w-full justify-center py-2.5"
              style={{ background: 'var(--background)' }}>
              <LoadingIcon color="var(--muted-foreground)" />
            </div>
          )}
        </div>
      </SelectionContextMenu>
      {topicImageCaptureActions.length > 0 && (
        <div
          ref={topicImageCaptureRef}
          aria-hidden="true"
          data-topic-image-capture
          className={classNames(
            '-left-[10000px] pointer-events-none fixed top-0 overflow-visible bg-background text-foreground',
            !topicImageCaptureWidth && 'w-full'
          )}
          style={topicImageCaptureWidth ? { width: `${topicImageCaptureWidth}px` } : undefined}>
          {groupedMessages.map(([key, groupMessages]) => (
            <NarrowLayout key={key} narrowMode={messageListNarrowMode} withSidePadding>
              <MessageGroup
                captureMode
                isLatestAssistantGroup={key === latestAssistantGroupKey}
                directAssistantModelsByUserId={directAssistantModelsByUserId}
                messages={groupMessages}
                partsByMessageId={partsByMessageId}
              />
            </NarrowLayout>
          ))}
        </div>
      )}
      {messageNavigation === 'anchor' && (
        <MessageAnchorLine
          messages={anchorMessages}
          activeMessageId={activeAnchorMessageId}
          hasOlder={hasOlder}
          historyPartsByMessageId={
            streamingLayers?.historyPartsByMessageId ?? partsByMessageId ?? EMPTY_PARTS_BY_MESSAGE_ID
          }
          liveMessageIds={liveMessageIds}
          railOpacity={railGutterPx / RAIL_GUTTER_MAX_PX}
          scrollToMessageId={scrollToMessageById}
        />
      )}
      {activeOutline && activeOutlineMessage && (
        <MessageOutline
          message={activeOutlineMessage}
          multiModelMessageStyle={activeOutline.multiModelMessageStyle}
          onNavigateToElement={scrollToOutlineElement}
        />
      )}
      {messageNavigation === 'buttons' && (
        <MessageNavigation
          scrollContainerRef={scrollContainerRef}
          getMessageElement={getMessageElement}
          messages={messages}
          scrollToMessageId={scrollToMessageById}
          scrollToTop={navigateToTop}
          scrollToBottom={navigateToBottom}
        />
      )}
      {meta.selectionLayer && (
        <SelectionBox
          isMultiSelectMode={isMultiSelectMode}
          scrollContainerRef={scrollContainerRef as React.RefObject<HTMLDivElement>}
          messageElements={messageElements.current}
          handleSelectMessage={(messageId, selected) => actions.selectMessage?.(messageId, selected)}
        />
      )}
      <MultiSelectActionPopup
        selectedMessageIds={selectedMessageIds}
        isMultiSelectMode={isMultiSelectMode}
        deleteDisabledReason={
          selectedMessageIds
            .map((messageId) => actions.getMessageDeleteAvailability?.(messageId))
            .find((availability) => availability?.enabled === false)?.reason
        }
        onSave={
          actions.saveSelectedMessages ? () => void actions.saveSelectedMessages?.(selectedMessageIds) : undefined
        }
        onCopy={
          actions.copySelectedMessages ? () => void actions.copySelectedMessages?.(selectedMessageIds) : undefined
        }
        onDelete={
          actions.deleteSelectedMessages ? () => void actions.deleteSelectedMessages?.(selectedMessageIds) : undefined
        }
        onClose={() => actions.toggleMultiSelectMode?.(false)}
      />
    </MessagesContainer>
  )
}

export default MessageList
