import { Popover, PopoverContent, PopoverTrigger, Scrollbar } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { MessageEditingProvider } from '@renderer/context/MessageEditingContext'
import { useTimer } from '@renderer/hooks/useTimer'
import type { Topic } from '@renderer/types'
import { classNames } from '@renderer/utils'
import { scrollIntoView } from '@renderer/utils/dom'
import type { MultiModelMessageStyle } from '@shared/data/preference/preferenceTypes'
import type { ComponentProps, ReactNode, WheelEvent as ReactWheelEvent } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import MessageItem from '../frame/MessageFrame'
import {
  useMessageListActions,
  useMessageListSelection,
  useMessageListUi,
  useMessageRenderConfig
} from '../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListItem, type MessageUiState } from '../types'
import { isMessageListItemProcessing } from '../utils/messageListItem'
import MessageGroupMenuBar from './MessageGroupMenuBar'

const logger = loggerService.withContext('MessageGroup')
interface Props {
  messages: MessageListItem[]
  topic: Topic
  registerMessageElement?: (id: string, element: HTMLElement | null) => void
}

function pickPreferredSelectedMessage(
  messages: MessageListItem[],
  getMessageUiState: (messageId: string) => MessageUiState
) {
  return (
    messages.find((message) => getMessageUiState(message.id).foldSelected) ?? messages.find(isMessageListItemProcessing)
  )
}

const MessageGroup = ({ messages, topic, registerMessageElement }: Props) => {
  const messageLength = messages.length

  // Hooks
  const actions = useMessageListActions()
  const renderConfig = useMessageRenderConfig() ?? defaultMessageRenderConfig
  const selection = useMessageListSelection()
  const messageUi = useMessageListUi()
  const multiModelMessageStyleSetting = renderConfig.multiModelMessageStyle
  const gridColumns = renderConfig.multiModelGridColumns
  const gridPopoverTrigger = renderConfig.multiModelGridPopoverTrigger
  const { setTimeoutTimer } = useTimer()
  const isMultiSelectMode = selection?.isMultiSelectMode ?? false
  const getMessageUiState = useCallback(
    (messageId: string) => messageUi.getMessageUiState?.(messageId) ?? {},
    [messageUi.getMessageUiState]
  )
  const updateMessageUiState = useCallback(
    (messageId: string, updates: MessageUiState) => {
      actions.updateMessageUiState?.(messageId, updates)
    },
    [actions.updateMessageUiState]
  )

  const isGrouped = isMultiSelectMode ? false : messageLength > 1 && messages.every((m) => m.role === 'assistant')

  // States — initialize from Cache, then tracked in React state
  const [_multiModelMessageStyle, setMultiModelMessageStyle] = useState<MultiModelMessageStyle>(
    () =>
      (getMessageUiState(messages[0]?.id).multiModelMessageStyle as MultiModelMessageStyle) ||
      multiModelMessageStyleSetting
  )
  const [selectedIndex, setSelectedIndex] = useState(messageLength - 1)
  const previousMessageIdsRef = useRef(messages.map((message) => message.id))

  const multiModelMessageStyle = useMemo(
    () => (messageLength < 2 ? 'fold' : _multiModelMessageStyle),
    [_multiModelMessageStyle, messageLength]
  )

  const isGrid = multiModelMessageStyle === 'grid'

  // Track selected and useful message IDs in React state
  const [selectedMessageId, setSelectedMessageIdState] = useState<string>(() => {
    if (messages.length === 1) return messages[0]?.id
    return pickPreferredSelectedMessage(messages, getMessageUiState)?.id ?? messages.at(-1)?.id ?? messages[0]?.id
  })

  const [usefulMessageId, setUsefulMessageIdState] = useState<string | null>(() => {
    const useful = messages.find((m) => getMessageUiState(m.id).useful)
    return useful?.id ?? null
  })

  // Re-sync selected/useful ids when the group's membership changes
  // (e.g., retry adds a new sibling and flips activeNodeId, so the old
  // selected id falls off-path). Without this, `selectedMessageId` can
  // point to a message no longer in `messages`, and the fold-mode CSS
  // renders NOTHING (no wrapper gets the `selected` class) — the whole
  // group looks empty until the component re-mounts on topic switch.
  useEffect(() => {
    const previousIds = previousMessageIdsRef.current
    const previousIdSet = new Set(previousIds)
    const addedMessages = messages.filter((message) => !previousIdSet.has(message.id))
    previousMessageIdsRef.current = messages.map((message) => message.id)

    const hasSelected = messages.some((m) => m.id === selectedMessageId)
    const nextSelectedMessage = !hasSelected
      ? (pickPreferredSelectedMessage(messages, getMessageUiState) ?? messages.at(-1) ?? messages[0])
      : addedMessages.length > 0
        ? (pickPreferredSelectedMessage(addedMessages, getMessageUiState) ?? addedMessages.at(-1))
        : undefined

    if (nextSelectedMessage && nextSelectedMessage.id !== selectedMessageId) {
      if (selectedMessageId) {
        updateMessageUiState(selectedMessageId, { foldSelected: false })
      }
      updateMessageUiState(nextSelectedMessage.id, { foldSelected: true })
      setSelectedMessageIdState(nextSelectedMessage.id)
      setSelectedIndex(messages.findIndex((message) => message.id === nextSelectedMessage.id))
    }

    if (usefulMessageId && !messages.some((m) => m.id === usefulMessageId)) {
      setUsefulMessageIdState(null)
    }
  }, [getMessageUiState, messages, selectedMessageId, updateMessageUiState, usefulMessageId])

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
        void actions.setActiveBranch?.(message.id)
      }

      setTimeoutTimer(
        'setSelectedMessage',
        () => {
          const messageElement = document.getElementById(`message-${message.id}`)
          if (messageElement) {
            scrollIntoView(messageElement, { behavior: 'smooth', block: 'start', container: 'nearest' })
          }
        },
        200
      )
    },
    [actions, selectedMessageId, setTimeoutTimer, updateMessageUiState]
  )
  // 添加对流程图节点点击事件的监听
  useEffect(() => {
    // 只在组件挂载和消息数组变化时添加监听器
    if (!isGrouped || messageLength <= 1) return

    const handleFlowNavigate = (event: CustomEvent) => {
      const { messageId } = event.detail

      // 查找对应的消息在当前消息组中的索引
      const targetIndex = messages.findIndex((msg) => msg.id === messageId)

      // 如果找到消息且不是当前选中的索引，则切换标签
      if (targetIndex !== -1 && targetIndex !== selectedIndex) {
        setSelectedIndex(targetIndex)

        // 使用setSelectedMessage函数来切换标签，这是处理foldSelected的关键
        const targetMessage = messages[targetIndex]
        if (targetMessage) {
          setSelectedMessage(targetMessage)
        }
      }
    }

    // 添加事件监听器
    document.addEventListener('flow-navigate-to-message', handleFlowNavigate as EventListener)

    // 清理函数
    return () => {
      document.removeEventListener('flow-navigate-to-message', handleFlowNavigate as EventListener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, selectedIndex, isGrouped, messageLength])

  useEffect(() => {
    return actions.bindMessageGroupRuntime?.(
      messages.map((message) => message.id),
      {
        locateMessage: (messageId) => {
          const message = messages.find((item) => item.id === messageId)
          if (!message) return

          const element = document.getElementById(`message-${message.id}`)
          if (!element) return

          const display = window.getComputedStyle(element).display
          if (display === 'none') {
            setSelectedMessage(message)
            return
          }

          scrollIntoView(element, { behavior: 'smooth', block: 'start', container: 'nearest' })
        }
      }
    )
  }, [actions, messages, setSelectedMessage])

  useEffect(() => {
    messages.forEach((message) => {
      const element = document.getElementById(`message-${message.id}`)
      element && registerMessageElement?.(message.id, element)
    })
    return () => messages.forEach((message) => registerMessageElement?.(message.id, null))
  }, [messages, registerMessageElement])

  const onUpdateUseful = useCallback(
    (msgId: string) => {
      const message = messages.find((msg) => msg.id === msgId)
      if (!message) {
        logger.error("the message to update doesn't exist in this group")
        return
      }
      if (usefulMessageId === msgId) {
        updateMessageUiState(msgId, { useful: undefined })
        setUsefulMessageIdState(null)
      } else {
        // Reset previous useful message
        if (usefulMessageId) {
          updateMessageUiState(usefulMessageId, { useful: undefined })
        }
        updateMessageUiState(msgId, { useful: true })
        setUsefulMessageIdState(msgId)
      }
    },
    [messages, updateMessageUiState, usefulMessageId]
  )

  const groupContextMessageId = useMemo(() => {
    if (usefulMessageId && messages.some((msg) => msg.id === usefulMessageId)) {
      return usefulMessageId
    } else if (messages.length > 0) {
      return messages[0].id
    } else {
      logger.warn('Empty message group')
      return ''
    }
  }, [messages, usefulMessageId])

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
        multiModelMessageStyle,
        message,
        topic,
        index
      } satisfies ComponentProps<typeof MessageItem>

      const messageContent = (
        <MessageWrapper
          id={`message-${message.id}`}
          key={message.id}
          className={classNames([
            {
              [multiModelMessageStyle]: message.role === 'assistant' && messages.length > 1,
              selected: message.id === selectedMessageId
            }
          ])}>
          <MessageItem
            onUpdateUseful={onUpdateUseful}
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
                className={classNames([
                  'in-popover',
                  {
                    [multiModelMessageStyle]: message.role === 'assistant' && messages.length > 1,
                    selected: message.id === selectedMessageId
                  }
                ])}>
                <MessageItem onUpdateUseful={onUpdateUseful} {...messageProps} />
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
      topic,
      multiModelMessageStyle,
      messages,
      selectedMessageId,
      onUpdateUseful,
      groupContextMessageId,
      gridPopoverTrigger
    ]
  )

  return (
    <MessageEditingProvider>
      <GroupContainer
        id={messages[0].parentId ? `message-group-${messages[0].parentId}` : undefined}
        className={classNames([multiModelMessageStyle, { 'multi-select-mode': isMultiSelectMode }])}>
        <GridContainer
          $count={messageLength}
          $gridColumns={gridColumns}
          className={classNames([multiModelMessageStyle, { 'multi-select-mode': isMultiSelectMode }])}
          onWheelCapture={multiModelMessageStyle === 'horizontal' ? handleHorizontalGroupWheel : undefined}>
          {messages.map(renderMessage)}
        </GridContainer>
        {isGrouped && (
          <MessageGroupMenuBar
            multiModelMessageStyle={multiModelMessageStyle}
            setMultiModelMessageStyle={(style) => {
              setMultiModelMessageStyle(style)
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
    </MessageEditingProvider>
  )
}

const GroupContainer = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    className={classNames(
      '[&.grid]:px-2.5 [&.grid]:py-1 [&.grid_.group-menu-bar]:mx-0 [&.horizontal]:px-2.5 [&.horizontal]:py-1 [&.horizontal_.group-menu-bar]:mx-0 [&.multi-select-mode]:px-2.5 [&.multi-select-mode]:py-[5px]',
      className
    )}
    {...props}
  />
)

const GridContainer = ({
  className,
  $count,
  $gridColumns,
  style,
  ...props
}: ComponentProps<typeof Scrollbar> & { $count: number; $gridColumns: number }) => {
  const isHorizontal = className?.includes('horizontal')
  const isGrid = className?.includes('grid')
  const isFoldOrVertical = className?.includes('fold') || className?.includes('vertical')
  const gridTemplateColumns = isHorizontal
    ? `repeat(${$count}, minmax(420px, 1fr))`
    : isGrid
      ? `repeat(${$count > 1 ? $gridColumns || 2 : 1}, minmax(0, 1fr))`
      : isFoldOrVertical
        ? 'repeat(1, minmax(0, 1fr))'
        : undefined

  const overflowStyle = isHorizontal ? ({ overflowX: 'auto', overflowY: 'hidden' } as const) : undefined

  return (
    <Scrollbar
      className={classNames(
        '[&.multi-select-mode_.message-content-container]:overflow-y-hidden! grid w-full gap-4 overflow-y-visible [&.fold]:gap-2 [&.grid]:grid-rows-[auto] [&.horizontal]:overflow-x-auto [&.horizontal]:overflow-y-hidden [&.horizontal]:pb-1 [&.multi-select-mode]:gap-2.5 [&.multi-select-mode_.MessageFooter]:hidden [&.multi-select-mode_.grid]:h-auto [&.multi-select-mode_.message-content-container]:max-h-[200px] [&.multi-select-mode_.message]:rounded-[10px] [&.multi-select-mode_.message]:border-[0.5px] [&.multi-select-mode_.message]:border-border [&.multi-select-mode_.message]:p-2.5',
        className
      )}
      style={{ gridTemplateColumns, ...overflowStyle, ...style }}
      {...props}
    />
  )
}

interface MessageWrapperProps {
  $isInPopover?: boolean
}

const MessageWrapper = ({ className, $isInPopover, ...props }: ComponentProps<'div'> & MessageWrapperProps) => {
  void $isInPopover
  const isHorizontal = className?.includes('horizontal')
  return (
    <div
      className={classNames(
        '[&.horizontal_.message-content-container]:overflow-y-auto! [&.fold.selected]:inline-block [&.fold]:hidden [&.grid]:block [&.grid]:h-[300px] [&.grid]:cursor-pointer [&.grid]:overflow-y-hidden [&.grid]:rounded-[10px] [&.grid]:border-[0.5px] [&.grid]:border-border [&.grid_.MessageFooter]:mt-0.5 [&.grid_.MessageFooter]:mb-0.5 [&.grid_.MessageFooter]:ml-0 [&.grid_.message-content-container]:pointer-events-none [&.grid_.message-content-container]:flex-1 [&.grid_.message-content-container]:overflow-hidden [&.grid_.message-content-container]:pl-0 [&.grid_.message]:h-full [&.horizontal]:overflow-y-visible [&.horizontal]:p-px [&.horizontal_.MessageFooter]:mt-0.5 [&.horizontal_.MessageFooter]:mb-0.5 [&.horizontal_.MessageFooter]:ml-0 [&.horizontal_.message-content-container]:mr-[-10px] [&.horizontal_.message-content-container]:max-h-[calc(100vh-350px)] [&.horizontal_.message-content-container]:flex-1 [&.horizontal_.message-content-container]:pl-0 [&.horizontal_.message]:h-full [&.horizontal_.message]:rounded-[10px] [&.horizontal_.message]:border-[0.5px] [&.horizontal_.message]:border-border [&.in-popover]:h-auto [&.in-popover]:max-h-[50vh] [&.in-popover]:cursor-default [&.in-popover]:overflow-y-auto [&.in-popover]:border-none [&.in-popover_.MessageFooter]:ml-0 [&.in-popover_.message-content-container]:pointer-events-auto [&.in-popover_.message-content-container]:pl-0',
        className
      )}
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
        className="z-1000 max-h-[60vh] w-auto max-w-[60vw] overflow-y-auto p-0.5"
        side="top"
        align="center">
        {content}
      </PopoverContent>
    </Popover>
  )
}

export default memo(MessageGroup)
