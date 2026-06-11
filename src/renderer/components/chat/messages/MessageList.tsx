import { useChatLayoutMode } from '@renderer/components/chat/layout/ChatLayoutModeContext'
import { useChatBottomOverlayInset } from '@renderer/components/chat/layout/ChatViewportInsetContext'
import { useImmersiveNavbar, useReportImmersiveNarrow } from '@renderer/components/chat/layout/ImmersiveNavbarContext'
import { LoadingIcon } from '@renderer/components/Icons'
import MultiSelectActionPopup from '@renderer/components/Popups/MultiSelectionPopup'
import SelectionContextMenu from '@renderer/components/SelectionContextMenu'
import { useTimer } from '@renderer/hooks/useTimer'
import {
  captureScrollableAsBlob,
  captureScrollableAsDataURL,
  classNames,
  removeSpecialCharactersForFileName
} from '@renderer/utils'
import type { MultiModelMessageStyle } from '@shared/data/preference/preferenceTypes'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import NarrowLayout from '../layout/NarrowLayout'
import { MessageEnterMotionProvider, useMessageEnterMotionIds } from '../motion/messageEnterMotion'
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
import { getDirectAssistantModelsByUserId } from './utils/messageListItem'
import { createStableGroupedMessagesCache, stableGroupedMessages } from './utils/stableGroupedMessages'

const MULTI_SELECT_BOTTOM_PADDING_PX = 96
const MESSAGE_OUTLINE_LAYOUTS: MultiModelMessageStyle[] = ['horizontal', 'vertical', 'fold', 'grid']

interface ActiveMessageOutline {
  messageId: string
  multiModelMessageStyle: MultiModelMessageStyle
}

type TopicImageRuntimeAction = 'copy' | 'export'

interface PendingTopicImageRuntimeAction {
  action: TopicImageRuntimeAction
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

const MessageList = () => {
  const data = useMessageListData()
  const actions = useMessageListActions()
  const meta = useMessageListMeta()
  const renderConfig = useMessageRenderConfig() ?? defaultMessageRenderConfig
  const selection = useMessageListSelection()
  const messageUi = useMessageListUi()
  const { setForceWideLayout } = useChatLayoutMode()
  const { topic, messages, beforeList, hasOlder = false, messageNavigation } = data
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const { setTimeoutTimer } = useTimer()
  const isMultiSelectMode = selection?.isMultiSelectMode ?? false
  const selectedMessageIds = selection?.selectedMessageIds ?? []
  const [activeOutline, setActiveOutline] = useState<ActiveMessageOutline | null>(null)
  const bottomOverlayInsets = useChatBottomOverlayInset()
  const { insetHeight: topOverlayInset } = useImmersiveNavbar()
  const reportImmersiveNarrow = useReportImmersiveNarrow()

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
  const messageById = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages])
  const directAssistantModelsByUserId = useMemo(() => getDirectAssistantModelsByUserId(messages), [messages])
  const messageByIdRef = useRef(messageById)
  messageByIdRef.current = messageById
  const latestAssistantGroupKey = useMemo(() => getLatestAssistantGroupKey(messages), [messages])
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

  // Declare whether the message column is rendered narrow (centered) so the shell can decide
  // whether the navbar may float over it. The shell owns the geometry (it measures the center
  // width); we only publish this boolean — no probe, no layout read, so loading/mount timing
  // can't desync it.
  useEffect(() => {
    reportImmersiveNarrow(messageListNarrowMode)
    return () => reportImmersiveNarrow(false)
  }, [messageListNarrowMode, reportImmersiveNarrow])

  const enteringMessageIds = useMessageEnterMotionIds({
    messages,
    scopeKey: data.listKey ?? topic.id
  })

  const registerMessageElement = useCallback((id: string, element: HTMLElement | null) => {
    if (element) {
      messageElements.current.set(id, element)
    } else {
      messageElements.current.delete(id)
    }
  }, [])

  const scrollToBottom = useCallback(() => {
    messageListRef.current?.scrollToBottom('instant')
  }, [])

  const scrollToMessageById = useCallback((messageId: string) => {
    const target = messageByIdRef.current.get(messageId)
    if (!target) return
    const groupKey =
      target.role === 'assistant' && target.parentId ? 'assistant' + target.parentId : target.role + target.id
    messageListRef.current?.scrollToKey(groupKey, 'start')
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
      if (message.role !== 'assistant' || message.type === 'clear') continue

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
        await captureScrollableAsBlob(captureRef, async (blob) => {
          if (blob) {
            await copyImage?.(blob)
          }
        })
        return
      }

      if (!meta.imageExportFileName || !saveImage) {
        throw new Error('Topic image export is unavailable')
      }

      const imageData = await captureScrollableAsDataURL(captureRef)
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
      const captureAction = { action, reject, resolve }
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
  const runtimeActionsRef = useRef({ scrollToBottom, scrollToMessageById, runTopicImageAction })
  runtimeActionsRef.current = { scrollToBottom, scrollToMessageById, runTopicImageAction }

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
      updateActiveMessageOutline()
      return
    }
    setActiveOutline((current) => (current ? null : current))
  }, [groupedMessages, shouldTrackMessageOutline, updateActiveMessageOutline])

  useEffect(() => {
    if (!shouldTrackMessageOutline) return
    const scrollElement = messageListRef.current?.getScrollElement()
    if (!scrollElement) return

    const handleOutlineUpdate = () => updateActiveMessageOutlineRef.current()
    scrollElement.addEventListener('scroll', handleOutlineUpdate, { passive: true })
    window.addEventListener('resize', handleOutlineUpdate)

    return () => {
      scrollElement.removeEventListener('scroll', handleOutlineUpdate)
      window.removeEventListener('resize', handleOutlineUpdate)
    }
  }, [data.isInitialLoading, data.listKey, shouldTrackMessageOutline, topic.id])

  useEffect(() => {
    return bindRuntime?.({
      scrollToBottom: () => runtimeActionsRef.current.scrollToBottom(),
      locateMessage: (messageId) => runtimeActionsRef.current.scrollToMessageById(messageId),
      copyTopicImage: () => runtimeActionsRef.current.runTopicImageAction('copy'),
      exportTopicImage: () => runtimeActionsRef.current.runTopicImageAction('export')
    })
  }, [bindRuntime])

  if (data.isInitialLoading) {
    return <MessageListInitialLoading />
  }

  const activeOutlineMessage = activeOutline
    ? messages.find((message) => message.id === activeOutline.messageId)
    : undefined
  const latestUserMessage = messages.findLast((message) => message.role === 'user' && message.type !== 'clear')
  const latestAssistantGroupMessages = latestAssistantGroupKey
    ? groupedMessages.find(([key]) => key === latestAssistantGroupKey)?.[1]
    : undefined
  const preserveScrollAnchor =
    latestAssistantGroupMessages?.some((message) => message.role === 'assistant' && message.status === 'pending') ??
    false
  // The runtime now treats this key as the group to scroll to the viewport
  // top (rather than scrolling to the absolute bottom). User-message groups
  // are keyed by `user${msgId}` — see stableGroupedMessages.
  const forceScrollToBottomKey = latestUserMessage ? `user${latestUserMessage.id}` : undefined
  const defaultBottomPadding = isMultiSelectMode
    ? MULTI_SELECT_BOTTOM_PADDING_PX
    : MESSAGE_VIRTUAL_LIST_DEFAULT_BOTTOM_PADDING_PX
  const bottomPadding =
    bottomOverlayInsets == null
      ? defaultBottomPadding
      : Math.max(bottomOverlayInsets.contentBottomPadding, isMultiSelectMode ? defaultBottomPadding : 0)
  const scrollerBottomMargin = bottomOverlayInsets?.scrollerBottomMargin ?? 0
  const topPadding = topOverlayInset || MESSAGE_VIRTUAL_LIST_DEFAULT_TOP_PADDING_PX
  const topicImageCaptureWidth =
    scrollContainerRef.current?.clientWidth || scrollContainerRef.current?.getBoundingClientRect().width || undefined

  return (
    <MessagesContainer
      id="messages"
      className={classNames(['messages-container', { 'multi-select-mode': isMultiSelectMode }])}
      key={data.listKey}>
      {beforeList && (
        <NarrowLayout narrowMode={messageListNarrowMode} withSidePadding className="shrink-0">
          {beforeList}
        </NarrowLayout>
      )}
      <SelectionContextMenu>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <MessageEnterMotionProvider enteringMessageIds={enteringMessageIds}>
            <MessageVirtualList
              handleRef={messageListRef}
              items={groupedMessages}
              getItemKey={([key]) => key}
              estimateSize={data.estimateSize}
              overscan={data.overscan}
              topPadding={topPadding}
              bottomPadding={bottomPadding}
              forceScrollToBottomKey={forceScrollToBottomKey}
              preserveScrollAnchor={preserveScrollAnchor}
              showScrollToBottomButton
              scrollToBottomButtonBottomOffset={Math.max(24, bottomPadding)}
              topicId={topic.id}
              hasMoreTop={hasOlder}
              onScrollContainerReady={handleScrollContainerReady}
              onReachTop={loadMoreMessages}
              renderItem={([key, groupMessages]) => {
                return (
                  <NarrowLayout narrowMode={messageListNarrowMode} withSidePadding>
                    <MessageGroup
                      key={key}
                      isLatestAssistantGroup={key === latestAssistantGroupKey}
                      directAssistantModelsByUserId={directAssistantModelsByUserId}
                      messages={groupMessages}
                      topic={topic}
                      registerMessageElement={registerMessageElement}
                      onMultiModelMessageStyleChange={(style) => {
                        setGroupLayoutOverrides((current) =>
                          current[key] === style ? current : { ...current, [key]: style }
                        )
                      }}
                    />
                  </NarrowLayout>
                )
              }}
              style={{ flex: 1, minHeight: 0, marginBottom: scrollerBottomMargin }}
            />
          </MessageEnterMotionProvider>
          {isLoadingMore && (
            <div
              className="pointer-events-none flex w-full justify-center py-2.5"
              style={{ background: 'var(--color-background)' }}>
              <LoadingIcon color="var(--color-foreground-secondary)" />
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
                topic={topic}
                onMultiModelMessageStyleChange={(style) => {
                  setGroupLayoutOverrides((current) =>
                    current[key] === style ? current : { ...current, [key]: style }
                  )
                }}
              />
            </NarrowLayout>
          ))}
        </div>
      )}
      {messageNavigation === 'anchor' && (
        <MessageAnchorLine
          messages={messages}
          scrollToMessageId={scrollToMessageById}
          scrollToBottom={scrollToBottom}
        />
      )}
      {activeOutline && activeOutlineMessage && (
        <MessageOutline message={activeOutlineMessage} multiModelMessageStyle={activeOutline.multiModelMessageStyle} />
      )}
      {messageNavigation === 'buttons' && (
        <MessageNavigation containerId="messages" messages={messages} scrollToMessageId={scrollToMessageById} />
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
