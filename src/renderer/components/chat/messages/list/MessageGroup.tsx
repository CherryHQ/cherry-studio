import type { ComponentProps, ReactNode } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger, PortalContainerProvider, ScrollArea } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import SelectionContextMenu from '@renderer/components/SelectionContextMenu'
import { useCurrentTabId } from '@renderer/hooks/tab'
import { useTimer } from '@renderer/hooks/useTimer'
import { scrollIntoView } from '@renderer/utils/dom'
import { classNames } from '@renderer/utils/style'
import type { MultiModelMessageStyle } from '@shared/data/preference/preferenceTypes'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'

import MessageItem from '../frame/MessageFrame'
import {
  useMessageListActions,
  useMessageListSelection,
  useMessageListUiSelectors,
  useMessageRenderConfig
} from '../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListItem, type MessageUiState } from '../types'
import { getEffectiveMultiModelMessageStyle, isAssistantMultiModelGroup } from '../utils/messageGroupLayout'
import { isMessageListItemProcessing } from '../utils/messageListItem'
import MessageGroupMenuBar from './MessageGroupMenuBar'
import {
  findVerticalWheelConsumer,
  useScrollRuntimeBoundary,
  useScrollRuntimeNavigation
} from './ScrollOwnershipContext'

const logger = loggerService.withContext('MessageGroup')
const EMPTY_MESSAGE_PARTS: CherryMessagePart[] = []
const WHEEL_LINE_HEIGHT_PX = 16

function normalizeWheelDelta(delta: number, deltaMode: number, pageSize: number): number {
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * WHEEL_LINE_HEIGHT_PX
  if (deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * pageSize
  return delta
}

interface Props {
  messages: MessageListItem[]
  partsByMessageId?: Record<string, CherryMessagePart[]> | null
  captureMode?: boolean
  registerMessageElement?: (id: string, element: HTMLElement | null) => void
  isLatestAssistantGroup?: boolean
  directAssistantModelsByUserId?: ReadonlyMap<string, Model[]>
  onMultiModelMessageStyleChange?: (style: MultiModelMessageStyle) => void
  messageTail?: {
    messageId: string
    content: ReactNode
  }
}

function pickPreferredSelectedMessage(
  messages: MessageListItem[],
  getMessageUiState: (messageId: string) => MessageUiState,
  activeBranchMessageId: string | null = messages.find((message) => message.isActiveBranch)?.id ?? null
) {
  return (
    messages.find((message) => {
      const ui = getMessageUiState(message.id)
      return ui.foldSelected && (ui.foldSelectedBranchId ?? null) === activeBranchMessageId
    }) ??
    messages.find((message) => message.isActiveBranch) ??
    messages.find(isMessageListItemProcessing)
  )
}

const MessageGroup = ({
  messages,
  partsByMessageId,
  captureMode = false,
  registerMessageElement,
  isLatestAssistantGroup = false,
  directAssistantModelsByUserId,
  onMultiModelMessageStyleChange,
  messageTail
}: Props) => {
  const messageLength = messages.length

  // Hooks
  const actions = useMessageListActions()
  const renderConfig = useMessageRenderConfig() ?? defaultMessageRenderConfig
  const selection = useMessageListSelection()
  const messageUi = useMessageListUiSelectors()
  const multiModelMessageStyleSetting = renderConfig.multiModelMessageStyle
  const gridPopoverTrigger = renderConfig.multiModelGridPopoverTrigger
  const { setTimeoutTimer } = useTimer()
  const currentTabId = useCurrentTabId()
  const navigateWithScrollRuntime = useScrollRuntimeNavigation()
  const { getScrollContainer, scrollByWheel } = useScrollRuntimeBoundary()
  const isMultiSelectMode = selection?.isMultiSelectMode ?? false
  const getMessageUiState = useCallback(
    (messageId: string) => messageUi.getMessageUiState?.(messageId) ?? {},
    [messageUi]
  )
  const updateMessageUiState = useCallback(
    (messageId: string, updates: MessageUiState) => {
      actions.updateMessageUiState?.(messageId, updates)
    },
    [actions]
  )

  const isMultiModelGroup = isAssistantMultiModelGroup(messages)
  const isGrouped = isMultiSelectMode ? false : isMultiModelGroup
  const isHistoricalProcessGroup =
    !!messages[0]?.historicalProcessGroupId &&
    messages.every((message) => message.historicalProcessGroupId === messages[0].historicalProcessGroupId)
  const historicalParts = useMemo(
    () =>
      isHistoricalProcessGroup
        ? messages.flatMap((message) => partsByMessageId?.[message.id] ?? [])
        : EMPTY_MESSAGE_PARTS,
    [isHistoricalProcessGroup, messages, partsByMessageId]
  )

  // States — initialize from Cache, then tracked in React state
  const [_multiModelMessageStyle, setMultiModelMessageStyle] = useState<MultiModelMessageStyle>(() =>
    getEffectiveMultiModelMessageStyle(messages, getMessageUiState, multiModelMessageStyleSetting)
  )
  const previousMessageIdsRef = useRef(messages.map((message) => message.id))
  const activeBranchSelectionQueueRef = useRef<Promise<void>>(Promise.resolve())
  const horizontalGroupRef = useRef<HTMLDivElement>(null)
  const messageElementsRef = useRef<Map<string, HTMLElement>>(new Map())

  const registerRenderedMessageElement = useCallback(
    (messageId: string, element: HTMLElement | null) => {
      if (element) {
        messageElementsRef.current.set(messageId, element)
      } else {
        messageElementsRef.current.delete(messageId)
      }
      registerMessageElement?.(messageId, element)
    },
    [registerMessageElement]
  )
  const registerHistoricalElement = useCallback(
    (_messageId: string, element: HTMLElement | null) => {
      for (const message of messages) registerRenderedMessageElement(message.id, element)
    },
    [messages, registerRenderedMessageElement]
  )

  const multiModelMessageStyle = useMemo(
    () => (messageLength < 2 ? 'fold' : _multiModelMessageStyle),
    [_multiModelMessageStyle, messageLength]
  )

  const isGrid = multiModelMessageStyle === 'grid'

  const activeBranchMessage = useMemo(() => messages.find((message) => message.isActiveBranch), [messages])
  const activeBranchMessageId = activeBranchMessage?.id ?? null

  // Track the selected message ID in React state. The active branch remains
  // the single source of truth for which grouped reply is used as context.
  const [selectedMessageId, setSelectedMessageIdState] = useState<string>(() => {
    if (messages.length === 1) return messages[0]?.id
    return (
      pickPreferredSelectedMessage(messages, getMessageUiState, activeBranchMessageId)?.id ??
      messages.at(-1)?.id ??
      messages[0]?.id
    )
  })
  const previousActiveBranchMessageIdRef = useRef(activeBranchMessageId)

  // Branch navigation overrides browsing; streaming updates preserve it.
  useEffect(() => {
    if (captureMode) return

    const previousIds = previousMessageIdsRef.current
    const previousIdSet = new Set(previousIds)
    const addedMessages = messages.filter((message) => !previousIdSet.has(message.id))
    previousMessageIdsRef.current = messages.map((message) => message.id)

    const hasSelected = messages.some((m) => m.id === selectedMessageId)
    const activeBranchChanged = activeBranchMessageId !== previousActiveBranchMessageIdRef.current
    previousActiveBranchMessageIdRef.current = activeBranchMessageId
    let nextSelectedMessage: MessageListItem | undefined

    if (activeBranchChanged && activeBranchMessage && activeBranchMessage.id !== selectedMessageId) {
      nextSelectedMessage = activeBranchMessage
    } else if (!hasSelected) {
      nextSelectedMessage =
        pickPreferredSelectedMessage(messages, getMessageUiState, activeBranchMessageId) ??
        messages.at(-1) ??
        messages[0]
    } else if (addedMessages.length > 0) {
      nextSelectedMessage =
        pickPreferredSelectedMessage(addedMessages, getMessageUiState, activeBranchMessageId) ?? addedMessages.at(-1)
    }

    const visibleMessageId = nextSelectedMessage?.id ?? selectedMessageId
    for (const message of messages) {
      const ui = getMessageUiState(message.id)
      if (message.id === visibleMessageId) {
        if (!ui.foldSelected || ui.foldSelectedBranchId !== activeBranchMessageId) {
          updateMessageUiState(message.id, { foldSelected: true, foldSelectedBranchId: activeBranchMessageId })
        }
      } else if (ui.foldSelected) {
        updateMessageUiState(message.id, { foldSelected: false })
      }
    }
    if (visibleMessageId !== selectedMessageId) setSelectedMessageIdState(visibleMessageId)
  }, [
    activeBranchMessage,
    activeBranchMessageId,
    captureMode,
    getMessageUiState,
    messages,
    selectedMessageId,
    updateMessageUiState
  ])

  const setSelectedMessage = useCallback(
    (message: MessageListItem) => {
      // Browsing changes only the visible reply; context changes use onSelectContext.
      setSelectedMessageIdState(message.id)

      setTimeoutTimer(
        'setSelectedMessage',
        () => {
          const messageElement = messageElementsRef.current.get(message.id)
          if (messageElement) {
            if (!navigateWithScrollRuntime(messageElement)) {
              scrollIntoView(messageElement, { behavior: 'smooth', block: 'start', container: 'nearest' })
            }
          }
        },
        200
      )
    },
    [navigateWithScrollRuntime, setTimeoutTimer]
  )
  useEffect(() => {
    if (captureMode) return

    return actions.bindMessageGroupRuntime?.(
      messages.map((message) => message.id),
      {
        locateMessage: (messageId) => {
          const message = messages.find((item) => item.id === messageId)
          if (!message) return

          const element = messageElementsRef.current.get(message.id)
          if (!element) return

          const display = window.getComputedStyle(element).display
          if (display === 'none') {
            setSelectedMessage(message)
            return
          }

          if (!navigateWithScrollRuntime(element)) {
            scrollIntoView(element, { behavior: 'smooth', block: 'start', container: 'nearest' })
          }
        }
      }
    )
  }, [actions, captureMode, messages, navigateWithScrollRuntime, setSelectedMessage])

  const onSelectContext = useCallback(
    (msgId: string) => {
      const message = messages.find((msg) => msg.id === msgId)
      if (!message) {
        logger.error("the message to update doesn't exist in this group")
        return
      }
      const setActiveBranch = actions.setActiveBranch
      if (!setActiveBranch) return

      activeBranchSelectionQueueRef.current = activeBranchSelectionQueueRef.current
        .then(() => setActiveBranch(message.id))
        .catch((error) => {
          logger.error('Failed to set active branch from context selection', error as Error, { messageId: message.id })
          actions.notifyError?.(error instanceof Error ? error.message : String(error))
        })
    },
    [actions, messages]
  )

  const groupContextMessageId = useMemo(() => {
    if (activeBranchMessageId) return activeBranchMessageId
    if (messages.length > 0) return messages[0].id

    logger.warn('Empty message group')
    return ''
  }, [activeBranchMessageId, messages])

  const handleHorizontalGroupWheel = useCallback(
    (event: WheelEvent) => {
      const target = event.target as HTMLElement | null
      const groupContainer = event.currentTarget as HTMLDivElement
      const verticalPageSize = getScrollContainer()?.clientHeight ?? groupContainer.clientHeight
      const horizontalWheelDelta = normalizeWheelDelta(event.deltaX, event.deltaMode, groupContainer.clientWidth)
      const verticalWheelDelta = normalizeWheelDelta(event.deltaY, event.deltaMode, verticalPageSize)
      const horizontalDelta = event.shiftKey
        ? horizontalWheelDelta || normalizeWheelDelta(event.deltaY, event.deltaMode, groupContainer.clientWidth)
        : Math.abs(horizontalWheelDelta) > Math.abs(verticalWheelDelta)
          ? horizontalWheelDelta
          : 0
      const inMessageColumn = Boolean(target?.closest('.message-content-container'))

      // Column owns vertical while it can scroll. At its boundary the group's
      // overflow-y:hidden blocks chaining, so forward vertical-dominant wheels
      // to the list runtime — but keep dominant-horizontal pans on the row.
      if (inMessageColumn) {
        if (verticalWheelDelta !== 0 && findVerticalWheelConsumer(target, verticalWheelDelta, groupContainer)) {
          return
        }
        if (horizontalDelta === 0) {
          if (verticalWheelDelta !== 0 && scrollByWheel(verticalWheelDelta)) {
            event.preventDefault()
            event.stopPropagation()
          }
          return
        }
      } else if (horizontalDelta === 0) {
        if (horizontalWheelDelta !== 0 && verticalWheelDelta !== 0 && scrollByWheel(verticalWheelDelta)) {
          event.preventDefault()
          event.stopPropagation()
        }
        return
      }

      const maxScrollLeft = groupContainer.scrollWidth - groupContainer.clientWidth
      const canScrollHorizontally =
        horizontalDelta < 0 ? groupContainer.scrollLeft > 0 : groupContainer.scrollLeft < maxScrollLeft

      if (!canScrollHorizontally && !event.shiftKey) return

      event.preventDefault()
      event.stopPropagation()
      if (canScrollHorizontally) {
        groupContainer.scrollLeft += horizontalDelta
      }
    },
    [getScrollContainer, scrollByWheel]
  )

  useEffect(() => {
    const groupContainer = horizontalGroupRef.current
    if (!groupContainer || multiModelMessageStyle !== 'horizontal') return

    groupContainer.addEventListener('wheel', handleHorizontalGroupWheel, { capture: true, passive: false })
    return () => groupContainer.removeEventListener('wheel', handleHorizontalGroupWheel, true)
  }, [handleHorizontalGroupWheel, multiModelMessageStyle])

  const renderMessage = useCallback(
    (message: MessageListItem, index: number) => {
      const isGridGroupMessage = isGrid && message.role === 'assistant' && isGrouped
      const messageProps = {
        isGrouped,
        isHorizontalMultiModelLayout: multiModelMessageStyle === 'horizontal',
        isLatestAssistantMessage: isLatestAssistantGroup && message.role === 'assistant',
        showModelIdentity: !isMultiModelGroup || multiModelMessageStyle !== 'fold',
        lockedMentionedModels: directAssistantModelsByUserId?.get(message.id),
        messageTail: messageTail?.messageId === message.id ? messageTail.content : undefined,
        message,
        messageParts: partsByMessageId ? (partsByMessageId[message.id] ?? EMPTY_MESSAGE_PARTS) : undefined,
        index
      } satisfies ComponentProps<typeof MessageItem>

      const messageContent = (
        <MessageWrapper
          id={`message-${currentTabId ? `${currentTabId}-` : ''}${captureMode ? 'capture-' : ''}${message.id}`}
          key={message.id}
          data-message-id={message.id}
          messageId={message.id}
          onElementChange={registerRenderedMessageElement}
          className={classNames([
            {
              [multiModelMessageStyle]: message.role === 'assistant' && messages.length > 1,
              selected: message.id === selectedMessageId
            }
          ])}>
          <MessageItem
            onSelectContext={onSelectContext}
            isGroupContextMessage={isGrouped && message.id === groupContextMessageId}
            {...messageProps}
          />
        </MessageWrapper>
      )

      if (isGridGroupMessage) {
        return (
          <GridMessagePopover
            key={message.id}
            trigger={gridPopoverTrigger}
            content={
              <SelectionContextMenu openBrowserUrl={actions.openBrowserUrl}>
                <MessageWrapper
                  tabIndex={0}
                  className={classNames([
                    'in-popover',
                    {
                      [multiModelMessageStyle]: message.role === 'assistant' && messages.length > 1,
                      selected: message.id === selectedMessageId
                    }
                  ])}>
                  <MessageItem onSelectContext={onSelectContext} {...messageProps} />
                </MessageWrapper>
              </SelectionContextMenu>
            }
            triggerContent={messageContent}
          />
        )
      }

      return messageContent
    },
    [
      actions.openBrowserUrl,
      isGrid,
      isGrouped,
      isMultiModelGroup,
      isLatestAssistantGroup,
      multiModelMessageStyle,
      messages,
      directAssistantModelsByUserId,
      selectedMessageId,
      onSelectContext,
      groupContextMessageId,
      gridPopoverTrigger,
      partsByMessageId,
      messageTail,
      captureMode,
      currentTabId,
      registerRenderedMessageElement
    ]
  )

  if (isHistoricalProcessGroup && messages.length > 1 && !isMultiSelectMode && !captureMode) {
    const anchor = messages[messages.length - 1]
    return (
      <GroupContainer>
        <MessageWrapper
          id={`message-${currentTabId ? `${currentTabId}-` : ''}${anchor.id}`}
          data-message-id={anchor.id}
          messageId={anchor.id}
          onElementChange={registerHistoricalElement}>
          <MessageItem message={anchor} messageParts={historicalParts} hideMenuBar />
        </MessageWrapper>
      </GroupContainer>
    )
  }

  return (
    <GroupContainer
      id={messages[0].parentId ? `message-group-${messages[0].parentId}` : undefined}
      className={classNames([multiModelMessageStyle, { 'multi-select-mode': isMultiSelectMode }])}>
      <GridContainer
        ref={horizontalGroupRef}
        $count={messageLength}
        className={classNames([multiModelMessageStyle, { 'multi-select-mode': isMultiSelectMode }])}>
        {messages.map(renderMessage)}
      </GridContainer>
      {isGrouped && (
        <MessageGroupMenuBar
          multiModelMessageStyle={multiModelMessageStyle}
          setMultiModelMessageStyle={(style) => {
            setMultiModelMessageStyle(style)
            onMultiModelMessageStyleChange?.(style)
            messages.forEach((message) => {
              updateMessageUiState(message.id, { multiModelMessageStyle: style })
            })
          }}
          messages={messages}
          selectMessageId={selectedMessageId}
          setSelectedMessage={setSelectedMessage}
        />
      )}
    </GroupContainer>
  )
}

const GroupContainer = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-ui="chat.message.group"
    className={classNames(
      '[&.grid]:py-1 [&.grid_.group-menu-bar]:mx-0 [&.horizontal]:py-1 [&.horizontal_.group-menu-bar]:mx-0 [&.multi-select-mode]:px-2.5 [&.multi-select-mode]:py-[5px]',
      className
    )}
    {...props}
  />
)

const GridContainer = ({
  className,
  $count,
  style,
  ...props
}: Omit<ComponentProps<'div'>, 'dir'> & { $count: number }) => {
  const isHorizontal = className?.includes('horizontal')
  const isGrid = className?.includes('grid')
  const isFoldOrVertical = className?.includes('fold') || className?.includes('vertical')
  const gridTemplateColumns = isHorizontal
    ? `repeat(${$count}, minmax(420px, 1fr))`
    : isGrid
      ? 'repeat(2, minmax(0, 1fr))'
      : isFoldOrVertical
        ? 'repeat(1, minmax(0, 1fr))'
        : undefined

  const gridClassName = classNames(
    '[&.multi-select-mode_.message-content-container]:overflow-y-hidden! [&.multi-select-mode_.message-content-container>[data-slot=scroll-area-viewport]]:overflow-y-hidden! grid w-full gap-4 overflow-y-visible [&.fold]:gap-2 [&.grid]:grid-rows-[auto] [&.multi-select-mode]:gap-2.5 [&.multi-select-mode_.MessageFooter]:hidden [&.multi-select-mode_.grid]:h-auto [&.multi-select-mode_.message-content-container]:pointer-events-none [&.multi-select-mode_.message-content-container]:max-h-[200px] [&.multi-select-mode_.message]:rounded-[10px] [&.multi-select-mode_.message]:border-[0.5px] [&.multi-select-mode_.message]:border-border [&.multi-select-mode_.message]:p-2.5',
    className
  )

  if (!isHorizontal) {
    return <div className={gridClassName} style={{ gridTemplateColumns, ...style }} {...props} />
  }

  const { children, onWheel, ref, ...rootProps } = props
  return (
    <ScrollArea
      {...rootProps}
      className={classNames('w-full', className)}
      style={style}
      type="hover"
      orientation="horizontal"
      viewportProps={{ ref, onWheel, style: { overflowX: 'auto', overflowY: 'hidden' } }}
      contentProps={{ className: classNames(gridClassName, 'pb-1'), style: { display: 'grid', gridTemplateColumns } }}>
      {children}
    </ScrollArea>
  )
}

interface MessageWrapperProps {
  $isInPopover?: boolean
  messageId?: string
  onElementChange?: (messageId: string, element: HTMLElement | null) => void
}

const MessageWrapper = ({
  className,
  $isInPopover,
  messageId,
  onElementChange,
  ...props
}: Omit<ComponentProps<'div'>, 'ref'> & MessageWrapperProps) => {
  void $isInPopover
  const isHorizontal = className?.includes('horizontal')
  const isGridCard = className?.includes('grid') && !className?.includes('in-popover')
  const setElementRef = useCallback(
    (element: HTMLDivElement | null) => {
      if (messageId) onElementChange?.(messageId, element)
    },
    [messageId, onElementChange]
  )
  return (
    <div
      ref={messageId ? setElementRef : undefined}
      data-ui="chat.message"
      className={classNames([
        '[&.fold.selected]:inline-block [&.fold]:hidden [&.grid]:block [&.grid]:h-[300px] [&.grid]:cursor-pointer [&.grid]:overflow-y-hidden [&.grid]:rounded-[10px] [&.grid]:border-[0.5px] [&.grid]:border-border [&.grid_.MessageFooter]:mt-0.5 [&.grid_.MessageFooter]:mb-0.5 [&.grid_.MessageFooter]:ml-0 [&.grid_.message-body-column]:h-full [&.grid_.message-body-column]:min-h-0 [&.grid_.message-body-content]:flex [&.grid_.message-body-content]:min-h-0 [&.grid_.message-body-content]:flex-1 [&.grid_.message-content-container]:pointer-events-none [&.grid_.message-content-container]:flex-1 [&.grid_.message-content-container]:overflow-hidden [&.grid_.message-content-container]:pl-0 [&.grid_.message-header]:h-full [&.grid_.message]:h-full [&.grid_.message]:pt-0 [&.horizontal]:overflow-y-visible [&.horizontal]:p-px [&.horizontal_.MessageFooter]:mt-0.5 [&.horizontal_.MessageFooter]:mb-0.5 [&.horizontal_.MessageFooter]:ml-0 [&.horizontal_.message-body-column]:h-full [&.horizontal_.message-body-column]:min-h-0 [&.horizontal_.message-body-content]:flex [&.horizontal_.message-body-content]:min-h-0 [&.horizontal_.message-body-content]:flex-1 [&.horizontal_.message-content-container]:max-h-[calc(100vh-350px)] [&.horizontal_.message-content-container]:flex-1 [&.horizontal_.message-content-container]:pl-0 [&.horizontal_.message-header]:h-full [&.horizontal_.message]:h-full [&.horizontal_.message]:rounded-[10px] [&.horizontal_.message]:border-[0.5px] [&.horizontal_.message]:border-border [&.horizontal_.message]:p-2.5 [&.in-popover]:h-auto [&.in-popover]:max-h-[50vh] [&.in-popover]:cursor-default [&.in-popover]:overflow-y-auto [&.in-popover]:border-none [&.in-popover_.MessageFooter]:ml-0 [&.in-popover_.message-content-container]:pointer-events-auto [&.in-popover_.message-content-container]:pl-0',
        { 'p-2.5': isGridCard },
        className
      ])}
      {...props}
      style={isHorizontal ? { overflowY: 'visible', ...props.style } : props.style}
    />
  )
}

const GridMessagePopover = ({
  content,
  triggerContent,
  trigger
}: {
  content: ReactNode
  triggerContent: ReactNode
  trigger: 'hover' | 'click'
}) => {
  const [open, setOpen] = useState(false)
  const [contentElement, setContentElement] = useState<HTMLDivElement | null>(null)
  const isHover = trigger === 'hover'

  return (
    <Popover open={isHover ? open : undefined} onOpenChange={isHover ? setOpen : undefined}>
      <PopoverTrigger asChild>
        <div
          onMouseEnter={isHover ? () => setOpen(true) : undefined}
          onMouseLeave={isHover ? () => setOpen(false) : undefined}>
          {triggerContent}
        </div>
      </PopoverTrigger>
      <PopoverContent
        ref={setContentElement}
        onMouseEnter={isHover ? () => setOpen(true) : undefined}
        onMouseLeave={isHover ? () => setOpen(false) : undefined}
        className="z-1000 max-h-[60vh] w-auto max-w-[60vw] overflow-y-auto p-4"
        side="top"
        align="center">
        <PortalContainerProvider container={contentElement}>{content}</PortalContainerProvider>
      </PopoverContent>
    </Popover>
  )
}

function messageArrayShallowEqual(a: MessageListItem[], b: MessageListItem[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function messagePartsShallowEqual(
  previous: Record<string, CherryMessagePart[]> | null | undefined,
  next: Record<string, CherryMessagePart[]> | null | undefined,
  messages: MessageListItem[]
): boolean {
  if (previous === next) return true
  return messages.every((message) => previous?.[message.id] === next?.[message.id])
}

// Custom comparator: bail out only when latest flag / derived model map /
// per-message refs are all identical. Inline callback props (onMultiModelMessageStyleChange,
// registerMessageElement) are intentionally ignored — they close over
// per-key state in the parent and behave identically across renders for the
// same key, so treating them as equal lets the memo actually do its job in
// production (where the parent's inline arrow would otherwise bust it every
// render). Per-message ref equality is the right granularity because the
// upstream `stableGroupedMessages` helper preserves refs when contents are
// unchanged, while truly changed messages (e.g. `isActiveBranch` flipped)
// arrive as new objects.
export default memo(MessageGroup, (prev, next) => {
  return (
    prev.captureMode === next.captureMode &&
    prev.isLatestAssistantGroup === next.isLatestAssistantGroup &&
    prev.directAssistantModelsByUserId === next.directAssistantModelsByUserId &&
    prev.messageTail === next.messageTail &&
    messageArrayShallowEqual(prev.messages, next.messages) &&
    messagePartsShallowEqual(prev.partsByMessageId, next.partsByMessageId, prev.messages)
  )
})
