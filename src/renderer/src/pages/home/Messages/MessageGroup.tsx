import Scrollbar from '@renderer/components/Scrollbar'
import { useMessageOperations } from '@renderer/hooks/useMessageOperations'
import { useSettings } from '@renderer/hooks/useSettings'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { MultiModelMessageStyle } from '@renderer/store/settings'
import type { Message, Topic } from '@renderer/types'
import { classNames } from '@renderer/utils'
import { Popover } from 'antd'
import { memo, useCallback, useEffect, useState } from 'react'
import styled, { css } from 'styled-components'

import MessageGroupMenuBar from './MessageGroupMenuBar'
import MessageStream from './MessageStream'

interface Props {
  messages: (Message & { index: number })[]
  topic: Topic
  hidePresetMessages?: boolean
}

const MessageGroup = ({ messages, topic, hidePresetMessages }: Props) => {
  const { editMessage } = useMessageOperations(topic)
  const { multiModelMessageStyle: multiModelMessageStyleSetting, gridColumns, gridPopoverTrigger } = useSettings()

  const [multiModelMessageStyle, setMultiModelMessageStyle] = useState<MultiModelMessageStyle>(
    messages[0].multiModelMessageStyle || multiModelMessageStyleSetting
  )

  const messageLength = messages.length
  const [selectedIndex, setSelectedIndex] = useState(messageLength - 1)

  const isGrouped = messageLength > 1 && messages.every((m) => m.role === 'assistant')
  const isHorizontal = multiModelMessageStyle === 'horizontal'
  const isGrid = multiModelMessageStyle === 'grid'

  useEffect(() => {
    setSelectedIndex(messageLength - 1)
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
  }, [messages, selectedIndex, isGrouped, messageLength])

  const setSelectedMessage = useCallback(
    (message: Message) => {
      messages.forEach(async (m) => {
        await editMessage(m.id, { foldSelected: m.id === message.id })
      })

      setTimeout(() => {
        const messageElement = document.getElementById(`message-${message.id}`)
        if (messageElement) {
          messageElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }, 200)
    },
    [editMessage, messages]
  )

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

  const renderMessage = useCallback(
    (message: Message & { index: number }, index: number) => {
      const isGridGroupMessage = isGrid && message.role === 'assistant' && isGrouped
      const messageProps = {
        isGrouped,
        message,
        topic,
        index: message.index,
        hidePresetMessages,
        style: {
          paddingTop: isGrouped && ['horizontal', 'grid'].includes(multiModelMessageStyle) ? 0 : 15
        }
      }

      const messageWrapper = (
        <MessageWrapper
          id={`message-${message.id}`}
          $layout={multiModelMessageStyle}
          $selected={index === selectedIndex}
          $isGrouped={isGrouped}
          key={message.id}
          className={classNames({
            'group-message-wrapper': message.role === 'assistant' && isHorizontal && isGrouped,
            [multiModelMessageStyle]: true,
            selected: 'foldSelected' in message ? message.foldSelected : index === 0
          })}>
          <MessageStream {...messageProps} />
        </MessageWrapper>
      )

      if (isGridGroupMessage) {
        return (
          <Popover
            key={message.id}
            content={
              <MessageWrapper
                $layout={multiModelMessageStyle}
                $selected={index === selectedIndex}
                $isGrouped={isGrouped}
                $isInPopover={true}>
                <MessageStream {...messageProps} />
              </MessageWrapper>
            }
            trigger={gridPopoverTrigger}
            styles={{ root: { maxWidth: '60vw', minWidth: '550px', overflowY: 'auto', zIndex: 1000 } }}
            getPopupContainer={(triggerNode) => triggerNode.parentNode as HTMLElement}>
            {messageWrapper}
          </Popover>
        )
      }

      return messageWrapper
    },
    [
      isGrid,
      isGrouped,
      isHorizontal,
      multiModelMessageStyle,
      selectedIndex,
      topic,
      hidePresetMessages,
      gridPopoverTrigger
    ]
  )

  return (
    <GroupContainer
      id={`message-group-${messages[0].askId}`}
      $isGrouped={isGrouped}
      $layout={multiModelMessageStyle}
      className={classNames([isGrouped && 'group-container', isHorizontal && 'horizontal', isGrid && 'grid'])}>
      <GridContainer
        $count={messageLength}
        $layout={multiModelMessageStyle}
        $gridColumns={gridColumns}
        className={classNames([isGrouped && 'group-grid-container', isHorizontal && 'horizontal', isGrid && 'grid'])}>
        {messages.map((message, index) => renderMessage(message, index))}
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
          setSelectedMessage={setSelectedMessage}
          topic={topic}
        />
      )}
    </GroupContainer>
  )
}

const GroupContainer = styled.div<{ $isGrouped: boolean; $layout: MultiModelMessageStyle }>`
  padding-top: ${({ $isGrouped, $layout }) => ($isGrouped && 'horizontal' === $layout ? '15px' : '0')};
  &.group-container.horizontal,
  &.group-container.grid {
    padding: 0 20px;
    .message {
      padding: 0;
    }
    .group-menu-bar {
      margin-left: 0;
      margin-right: 0;
    }
  }
`

const GridContainer = styled.div<{ $count: number; $layout: MultiModelMessageStyle; $gridColumns: number }>`
  width: 100%;
  display: grid;
  gap: ${({ $layout }) => ($layout === 'horizontal' ? '16px' : '0')};
  overflow-y: auto;
  grid-template-columns: repeat(
    ${({ $layout, $count }) => (['fold', 'vertical'].includes($layout) ? 1 : $count)},
    minmax(550px, 1fr)
  );
  @media (max-width: 800px) {
    grid-template-columns: repeat(
      ${({ $layout, $count }) => (['fold', 'vertical'].includes($layout) ? 1 : $count)},
      minmax(400px, 1fr)
    );
  }
  ${({ $layout }) =>
    $layout === 'horizontal' &&
    css`
      margin-top: 15px;
    `}
  ${({ $gridColumns, $layout, $count }) =>
    $layout === 'grid' &&
    css`
      margin-top: 15px;
      grid-template-columns: repeat(${$count > 1 ? $gridColumns || 2 : 1}, minmax(0, 1fr));
      grid-template-rows: auto;
      gap: 16px;
    `}
`

interface MessageWrapperProps {
  $layout: 'fold' | 'horizontal' | 'vertical' | 'grid'
  $selected: boolean
  $isGrouped: boolean
  $isInPopover?: boolean
}

const MessageWrapper = styled(Scrollbar)<MessageWrapperProps>`
  width: 100%;
  &.horizontal {
    display: inline-block;
  }
  &.grid {
    display: inline-block;
  }
  &.fold {
    display: none;
    &.selected {
      display: inline-block;
    }
  }

  ${({ $layout, $isGrouped }) => {
    if ($layout === 'horizontal' && $isGrouped) {
      return css`
        border: 0.5px solid var(--color-border);
        padding: 10px;
        border-radius: 6px;
        max-height: 600px;
        margin-bottom: 10px;
      `
    }
    return ''
  }}

  ${({ $layout, $isInPopover, $isGrouped }) => {
    return $layout === 'grid' && $isGrouped
      ? css`
          max-height: ${$isInPopover ? '50vh' : '300px'};
          overflow-y: ${$isInPopover ? 'auto' : 'hidden'};
          border: 0.5px solid ${$isInPopover ? 'transparent' : 'var(--color-border)'};
          padding: 10px;
          border-radius: 6px;
          background-color: var(--color-background);
        `
      : css`
          overflow-y: auto;
          border-radius: 6px;
        `
  }}
`

export default memo(MessageGroup)
