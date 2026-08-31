import { Popover, PopoverContent, PopoverTrigger, Scrollbar } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useCurrentTabId } from '@renderer/hooks/tab'
import { useTimer } from '@renderer/hooks/useTimer'
import { scrollIntoView } from '@renderer/utils/dom'
import { classNames } from '@renderer/utils/style'
import type { MultiModelMessageStyle } from '@shared/data/preference/preferenceTypes'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'
import type { ComponentProps, ReactNode, WheelEvent as ReactWheelEvent } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
import { useScrollRuntimeNavigation } from './ScrollOwnershipContext'

const logger = loggerService.withContext('MessageGroup')
const EMPTY_MESSAGE_PARTS: CherryMessagePart[] = []

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
  getMessageUiState: (messageId: string) => MessageUiState
) {
  return (
    messages.find((message) => message.isActiveBranch) ??
    messages.find((message) => getMessageUiState(message.id).foldSelected) ??
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

  // States — initialize from Cache, then tracked in React state
  const [_multiModelMessageStyle, setMultiModelMessageStyle] = useState<MultiModelMessageStyle>(() =>
    getEffectiveMultiModelMessageStyle(messages, getMessageUiState, multiModelMessageStyleSetting)
  )
  const previousMessageIdsRef = useRef(messages.map((message) => message.id))
  const activeBranchSelectionQueueRef = useRef<Promise<void>>(Promise.resolve())
  const pendingBranchTargetRef = useRef<string | null>(null)
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

  const multiModelMessageStyle = useMemo(
    () => (messageLength < 2 ? 'fold' : _multiModelMessageStyle),
    [_multiModelMessageStyle, messageLength]
  )

  const isGrid = multiModelMessageStyle === 'grid'

  // Track the selected message ID in React state. The active branch remains
  // the single source of truth for which grouped reply is used as context.
  const [selectedMessageId, setSelectedMessageIdState] = useState<string>(() => {
    if (messages.length === 1) return messages[0]?.id
    return pickPreferredSelectedMessage(messages, getMessageUiState)?.id ?? messages.at(-1)?.id ?? messages[0]?.id
  })

  // Re-sync the selected ID when the active branch or group membership changes.
  // Without this, fold mode can keep showing an old model column even after
  // branch navigation moves the active path to another multi-model node.
  useEffect(() => {
    if (captureMode) return

    const previousIds = previousMessageIdsRef.current
    const previousIdSet = new Set(previousIds)
    const addedMessages = messages.filter((message) => !previousIdSet.has(message.id))
    previousMessageIdsRef.current = messages.map((message) => message.id)

    const hasSelected = messages.some((m) => m.id === selectedMessageId)
    const activeBranchMessage = messages.find((message) => message.isActiveBranch)
    let nextSelectedMessage: MessageListItem | undefined

    if (pendingBranchTargetRef.current !== null) {
      // A branch switch is in flight — suppress all auto-sync so streaming
      // updates and newly added assistant messages cannot override the user's
      // model selection.  The pending ref is cleared in setSelectedMessage's
      // finally block once the switch settles.
    } else if (
      activeBranchMessage &&
      activeBranchMessage.id !== selectedMessageId
    ) {
      nextSelectedMessage = activeBranchMessage
    } else if (!hasSelected) {
      nextSelectedMessage = pickPreferredSelectedMessage(messages, getMessageUiState) ?? messages.at(-1) ?? messages[0]
    } else if (addedMessages.length > 0) {
      nextSelectedMessage = pickPreferredSelectedMessage(addedMessages, getMessageUiState) ?? addedMessages.at(-1)
    }

    if (nextSelectedMessage && nextSelectedMessage.id !== selectedMessageId) {
      if (selectedMessageId) {
        updateMessageUiState(selectedMessageId, { foldSelected: false })
      }
      updateMessageUiState(nextSelectedMessage.id, { foldSelected: true })
      setSelectedMessageIdState(nextSelectedMessage.id)
    }
  }, [captureMode, getMessageUiState, messages, selectedMessageId, updateMessageUiState])

  const setSelectedMessage = useCallback(
    (message: MessageListItem) => {
      // 前一个
      if (selectedMessageId) {
        updateMessageUiState(selectedMessageId, { foldSelected: false })
      }
      // 当前选中的消息
      updateMessageUiState(message.id, { foldSelected: true })
      setSelectedMessageIdState(message.id)

      if (message.role === 'assistant' && message.id !== selectedMessageId) {
        pendingBranchTargetRef.current = message.id
        void Promise.resolve(actions.setActiveBranch?.(message.id))
          .catch((error) => {
            logger.error('Failed to set active branch from message group', error as Error, { messageId: message.id })
            actions.notifyError?.(error instanceof Error ? error.message : String(error))
          })
          .finally(() => {
            if (pendingBranchTargetRef.current === message.id) pendingBranchTargetRef.current = null
          })
      }

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
    [actions, navigateWithScrollRuntime, selectedMessageId, setTimeoutTimer, updateMessageUiState]
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

      pendingBranchTargetRef.current = message.id
      activeBranchSelectionQueueRef.current = activeBranchSelectionQueueRef.current
        .then(() => setActiveBranch(message.id))
        .catch((error) => {
          logger.error('Failed to set active branch from context selection', error as Error, { messageId: message.id })
          actions.notifyError?.(error instanceof Error ? error.message : String(error))
        })
        .finally(() => {
          if (pendingBranchTargetRef.current === message.id) pendingBranchTargetRef.current = null
        })
    },
    [actions, messages]
  )

  const groupContextMessageId = useMemo(() => {
    const activeBranchMessage = messages.find((message) => message.isActiveBranch)
    if (activeBranchMessage) return activeBranchMessage.id
    if (messages.length > 0) return messages[0].id

    logger.warn('Empty message group')
    return ''
  }, [messages])

  const handleHorizontalGroupWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null
    if (target?.closest('.message-content-container')) {
      return
    }

    const groupContainer = event.currentTarget
    const contentContainers = Array.from(groupContainer.querySelectorAll<HTMLElement>('.message-content-container'))
    const hasInnerVerticalScroll = contentContainers.some(
      (contentContainer) => contentContainer.scrollHeight > contentContainer.clientHeight + 1
    )
    const hasHorizontalScroll = groupContainer.scrollWidth > groupContainer.clientWidth + 1
    const horizontalDelta = Math.abs(event.deltaX) > 0 ? event.deltaX : event.shiftKey ? event.deltaY : 0

    if (horizontalDelta !== 0 && hasHorizontalScroll) {
      event.preventDefault()
      event.stopPropagation()
      groupContainer.scrollLeft += horizontalDelta
      return
    }

    if (hasInnerVerticalScroll) {
      event.preventDefault()
      event.stopPropagation()
    }
  }, [])

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
            }
            triggerContent={messageContent}
          />
        )
      }

      return messageContent
    },
    [
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

  return (
    <GroupContainer
      id={messages[0].parentId ? `message-group-${messages[0].parentId}` : undefined}
      className={classNames([multiModelMessageStyle, { 'multi-select-mode': isMultiSelectMode }])}>
      <GridContainer
        $count={messageLength}
        className={classNames([multiModelMessageStyle, { 'multi-select-mode': isMultiSelectMode }])}
        onWheelCapture={multiModelMessageStyle === 'horizontal' ? handleHorizontalGroupWheel : undefined}>
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
}: ComponentProps<typeof Scrollbar> & { $count: number }) => {
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

  const overflowStyle = isHorizontal ? ({ overflowX: 'auto', overflowY: 'hidden' } as const) : undefined

  return (
    <Scrollbar
      className={classNames(
        '[&.multi-select-mode_.message-content-container]:overflow-y-hidden! grid w-full gap-4 overflow-y-visible [&.fold]:gap-2 [&.grid]:grid-rows-[auto] [&.horizontal]:overflow-x-auto [&.horizontal]:overflow-y-hidden [&.horizontal]:pb-1 [&.multi-select-mode]:gap-2.5 [&.multi-select-mode_.MessageFooter]:hidden [&.multi-select-mode_.grid]:h-auto [&.multi-select-mode_.message-content-container]:pointer-events-none [&.multi-select-mode_.message-content-container]:max-h-[200px] [&.multi-select-mode_.message]:rounded-[10px] [&.multi-select-mode_.message]:border-[0.5px] [&.multi-select-mode_.message]:border-border [&.multi-select-mode_.message]:p-2.5',
        className
      )}
      style={{ gridTemplateColumns, ...overflowStyle, ...style }}
      {...props}
    />
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
        '[&.horizontal_.message-content-container]:overflow-y-auto! [&.fold.selected]:inline-block [&.fold]:hidden [&.grid]:block [&.grid]:h-[300px] [&.grid]:cursor-pointer [&.grid]:overflow-y-hidden [&.grid]:rounded-[10px] [&.grid]:border-[0.5px] [&.grid]:border-border [&.grid_.MessageFooter]:mt-0.5 [&.grid_.MessageFooter]:mb-0.5 [&.grid_.MessageFooter]:ml-0 [&.grid_.message-body-column]:h-full [&.grid_.message-body-column]:min-h-0 [&.grid_.message-body-content]:flex [&.grid_.message-body-content]:min-h-0 [&.grid_.message-body-content]:flex-1 [&.grid_.message-content-container]:pointer-events-none [&.grid_.message-content-container]:flex-1 [&.grid_.message-content-container]:overflow-hidden [&.grid_.message-content-container]:pl-0 [&.grid_.message-header]:h-full [&.grid_.message]:h-full [&.grid_.message]:pt-0 [&.horizontal]:overflow-y-visible [&.horizontal]:p-px [&.horizontal_.MessageFooter]:mt-0.5 [&.horizontal_.MessageFooter]:mb-0.5 [&.horizontal_.MessageFooter]:ml-0 [&.horizontal_.message-body-column]:h-full [&.horizontal_.message-body-column]:min-h-0 [&.horizontal_.message-body-content]:flex [&.horizontal_.message-body-content]:min-h-0 [&.horizontal_.message-body-content]:flex-1 [&.horizontal_.message-content-container]:max-h-[calc(100vh-350px)] [&.horizontal_.message-content-container]:flex-1 [&.horizontal_.message-content-container]:pl-0 [&.horizontal_.message-header]:h-full [&.horizontal_.message]:h-full [&.horizontal_.message]:rounded-[10px] [&.horizontal_.message]:border-[0.5px] [&.horizontal_.message]:border-border [&.horizontal_.message]:p-2.5 [&.in-popover]:h-auto [&.in-popover]:max-h-[50vh] [&.in-popover]:cursor-default [&.in-popover]:overflow-y-auto [&.in-popover]:border-none [&.in-popover_.MessageFooter]:ml-0 [&.in-popover_.message-content-container]:pointer-events-auto [&.in-popover_.message-content-container]:pl-0',
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
        onMouseEnter={isHover ? () => setOpen(true) : undefined}
        onMouseLeave={isHover ? () => setOpen(false) : undefined}
        className="z-1000 max-h-[60vh] w-auto max-w-[60vw] overflow-y-auto p-4"
        side="top"
        align="center">
        {content}
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
