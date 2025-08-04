import { loggerService } from '@logger'
import Scrollbar from '@renderer/components/Scrollbar'
import { MessageEditingProvider } from '@renderer/context/MessageEditingContext'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { useMessageOperations } from '@renderer/hooks/useMessageOperations'
import { useSettings } from '@renderer/hooks/useSettings'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { MultiModelMessageStyle } from '@renderer/store/settings'
import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { classNames } from '@renderer/utils'
import { Popover } from 'antd'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

import { useChatMaxWidth } from '../Chat'
import MessageItem from './Message'
import MessageGroupMenuBar from './MessageGroupMenuBar'

const logger = loggerService.withContext('MessageGroup')
interface Props {
  messages: (Message & { index: number })[]
  topic: Topic
  registerMessageElement?: (id: string, element: HTMLElement | null) => void
}

const MessageGroup = ({ messages, topic, registerMessageElement }: Props) => {
  const messageLength = messages.length

  // Hooks
  const { editMessage } = useMessageOperations(topic)
  const { multiModelMessageStyle: multiModelMessageStyleSetting, gridColumns, gridPopoverTrigger } = useSettings()
  const { isMultiSelectMode } = useChatContext(topic)
  const maxWidth = useChatMaxWidth()

  const isGrouped = isMultiSelectMode ? false : messageLength > 1 && messages.every((m) => m.role === 'assistant')

  // States
  const [_multiModelMessageStyle, setMultiModelMessageStyle] = useState<MultiModelMessageStyle>(
    messages[0].multiModelMessageStyle || multiModelMessageStyleSetting
  )
  const [selectedIndex, setSelectedIndex] = useState(messageLength - 1)

  // Refs
  const prevMessageLengthRef = useRef(messageLength)

  // 对于单模型消息，采用简单的样式，避免 overflow 影响内部的 sticky 效果
  const multiModelMessageStyle = useMemo(
    () => (messageLength < 2 ? 'fold' : _multiModelMessageStyle),
    [_multiModelMessageStyle, messageLength]
  )

  const isGrid = multiModelMessageStyle === 'grid'

  const selectedMessageId = useMemo(() => {
    if (messages.length === 1) return messages[0]?.id
    const selectedMessage = messages.find((message) => message.foldSelected)
    if (selectedMessage) {
      return selectedMessage.id
    }
    return messages[0]?.id
  }, [messages])

  const setSelectedMessage = useCallback(
    (message: Message) => {
      // 前一个
      editMessage(selectedMessageId, { foldSelected: false })
      // 当前选中的消息
      editMessage(message.id, { foldSelected: true })

      setTimeout(() => {
        const messageElement = document.getElementById(`message-${message.id}`)
        if (messageElement) {
          messageElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }, 200)
    },
    [editMessage, selectedMessageId]
  )

  useEffect(() => {
    if (messageLength > prevMessageLengthRef.current) {
      setSelectedIndex(messageLength - 1)
      const lastMessage = messages[messageLength - 1]
      if (lastMessage) {
        setSelectedMessage(lastMessage)
      }
    } else {
      const newIndex = messages.findIndex((msg) => msg.id === selectedMessageId)
      if (newIndex !== -1) {
        setSelectedIndex(newIndex)
      }
    }
    prevMessageLengthRef.current = messageLength
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageLength])

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

  // 添加对LOCATE_MESSAGE事件的监听
  useEffect(() => {
    // 为每个消息注册一个定位事件监听器
    const eventHandlers: { [key: string]: () => void } = {}

    messages.forEach((message) => {
      const eventName = EVENT_NAMES.LOCATE_MESSAGE + ':' + message.id
      const handler = () => {
        // 检查消息是否处于可见状态
        const element = document.getElementById(`message-${message.id}`)
        if (element) {
          const display = window.getComputedStyle(element).display

          if (display === 'none') {
            // 如果消息隐藏，先切换标签
            setSelectedMessage(message)
          } else {
            // 直接滚动
            element.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
        }
      }

      eventHandlers[eventName] = handler
      EventEmitter.on(eventName, handler)
    })

    // 清理函数
    return () => {
      // 移除所有事件监听器
      Object.entries(eventHandlers).forEach(([eventName, handler]) => {
        EventEmitter.off(eventName, handler)
      })
    }
  }, [messages, setSelectedMessage])

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
      if (message.useful) {
        editMessage(msgId, { useful: undefined })
        return
      } else {
        const toResetUsefulMsgs = messages.filter((msg) => msg.id !== msgId && msg.useful)
        toResetUsefulMsgs.forEach(async (msg) => {
          editMessage(msg.id, {
            useful: undefined
          })
        })
        editMessage(msgId, { useful: true })
      }
    },
    [editMessage, messages]
  )

  const groupContextMessageId = useMemo(() => {
    // NOTE: 旧数据可能存在一组消息有多个useful的情况，只取第一个，不再另作迁移
    // find first useful
    const usefulMsg = messages.find((msg) => msg.useful)
    if (usefulMsg) {
      return usefulMsg.id
    } else if (messages.length > 0) {
      return messages[0].id
    } else {
      logger.warn('Empty message group')
      return ''
    }
  }, [messages])

  const renderMessage = useCallback(
    (message: Message & { index: number }) => {
      const isGridGroupMessage = isGrid && message.role === 'assistant' && isGrouped
      const messageProps = {
        isGrouped,
        message,
        topic,
        index: message.index
      }

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
          <Popover
            key={message.id}
            destroyTooltipOnHide
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
            trigger={gridPopoverTrigger}
            styles={{
              root: { maxWidth: '60vw', overflowY: 'auto', zIndex: 1000 },
              body: { padding: 2 }
            }}>
            {messageContent}
          </Popover>
        )
      }

      return messageContent
    },
    [
      isGrid,
      isGrouped,
      topic,
      multiModelMessageStyle,
      messages.length,
      selectedMessageId,
      onUpdateUseful,
      groupContextMessageId,
      gridPopoverTrigger
    ]
  )

  return (
    <MessageEditingProvider>
      <GroupContainer
        id={messages[0].askId ? `message-group-${messages[0].askId}` : undefined}
        className={classNames([multiModelMessageStyle, { 'multi-select-mode': isMultiSelectMode }])}
        style={{ maxWidth }}>
        <GridContainer
          $count={messageLength}
          $gridColumns={gridColumns}
          className={classNames([multiModelMessageStyle, { 'multi-select-mode': isMultiSelectMode }])}>
          {messages.map(renderMessage)}
        </GridContainer>
        {isGrouped && (
          <MessageGroupMenuBar
            multiModelMessageStyle={multiModelMessageStyle}
            setMultiModelMessageStyle={(style) => {
              setMultiModelMessageStyle(style)
              messages.forEach((message) => {
                editMessage(message.id, { multiModelMessageStyle: style })
              })
            }}
            messages={messages}
            selectMessageId={selectedMessageId}
            setSelectedMessage={setSelectedMessage}
            topic={topic}
          />
        )}
      </GroupContainer>
    </MessageEditingProvider>
  )
}

const GroupContainer = styled.div`
  [navbar-position='left'] & {
    max-width: calc(100vw - var(--sidebar-width) - var(--assistants-width) - 20px);
  }
  &.horizontal,
  &.grid {
    padding: 4px 10px;
    .group-menu-bar {
      margin-left: 0;
      margin-right: 0;
    }
  }
  &.multi-select-mode {
    padding: 5px 10px;
  }
`

const GridContainer = styled(Scrollbar)<{ $count: number; $gridColumns: number }>`
  width: 100%;
  display: grid;
  overflow-y: visible;
  gap: 16px;
  &.horizontal {
    padding-bottom: 4px;
    grid-template-columns: repeat(${({ $count }) => $count}, minmax(420px, 1fr));
    overflow-x: auto;
  }
  &.fold,
  &.vertical {
    grid-template-columns: repeat(1, minmax(0, 1fr));
    gap: 8px;
  }
  &.grid {
    grid-template-columns: repeat(
      ${({ $count, $gridColumns }) => ($count > 1 ? $gridColumns || 2 : 1)},
      minmax(0, 1fr)
    );
    grid-template-rows: auto;
  }

  &.multi-select-mode {
    grid-template-columns: repeat(1, minmax(0, 1fr));
    gap: 10px;
    .grid {
      height: auto;
    }
    .message {
      border: 0.5px solid var(--color-border);
      border-radius: 10px;
      padding: 10px;
      .message-content-container {
        max-height: 200px;
        overflow-y: hidden !important;
      }
      .MessageFooter {
        display: none;
      }
    }
  }
`

interface MessageWrapperProps {
  $isInPopover?: boolean
}

const MessageWrapper = styled.div<MessageWrapperProps>`
  &.horizontal {
    padding-right: 1px;
    overflow-y: auto;
    .message {
      height: 100%;
      border: 0.5px solid var(--color-border);
      border-radius: 10px;
    }
    .message-content-container {
      flex: 1;
      padding-left: 0;
      max-height: calc(100vh - 350px);
      overflow-y: auto !important;
      margin-right: -10px;
    }
    .MessageFooter {
      margin-left: 0;
      margin-top: 2px;
      margin-bottom: 2px;
    }
  }
  &.grid {
    height: 300px;
    overflow-y: hidden;
    border: 0.5px solid var(--color-border);
    border-radius: 10px;
    cursor: pointer;
    .message {
      height: 100%;
    }
    .message-content-container {
      overflow: hidden;
      padding-left: 0;
      flex: 1;
      pointer-events: none;
    }
    .MessageFooter {
      margin-left: 0;
      margin-top: 2px;
      margin-bottom: 2px;
    }
  }
  &.in-popover {
    height: auto;
    border: none;
    max-height: 50vh;
    overflow-y: auto;
    cursor: default;
    .message-content-container {
      padding-left: 0;
      pointer-events: auto;
    }
    .MessageFooter {
      margin-left: 0;
    }
  }
  &.fold {
    display: none;
    &.selected {
      display: inline-block;
    }
  }
`

export default memo(MessageGroup)
