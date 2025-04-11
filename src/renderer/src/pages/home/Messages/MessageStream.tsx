import { useAppDispatch, useAppSelector } from '@renderer/store'
import { selectStreamMessage, updateMessage } from '@renderer/store/messages'
import { Assistant, Message, Topic } from '@renderer/types'
import { memo } from 'react'
import styled from 'styled-components'

import MessageItem from './Message'

interface MessageStreamProps {
  message: Message
  topic: Topic
  assistant?: Assistant
  index?: number
  hidePresetMessages?: boolean
  isGrouped?: boolean
  style?: React.CSSProperties
}

const MessageStreamContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1rem;
`

const MessageStream: React.FC<MessageStreamProps> = ({
  message: _message,
  topic,
  assistant,
  index,
  hidePresetMessages,
  isGrouped,
  style
}) => {
  // 获取流式消息
  const streamMessage = useAppSelector((state) => selectStreamMessage(state, _message.topicId, _message.id))
  // 获取常规消息
  const regularMessage = useAppSelector((state) => {
    // 如果是用户消息，直接使用传入的_message
    if (_message.role === 'user') {
      return _message
    }

    // 对于助手消息，从store中查找最新状态
    const topicMessages = state.messages.messagesByTopic[_message.topicId]
    if (!topicMessages) return _message

    return topicMessages.find((m) => m.id === _message.id) || _message
  })

  // 添加dispatch用于更新消息
  const dispatch = useAppDispatch()

  // 创建一个函数来更新消息状态
  const handleSetMessages = (updater: React.SetStateAction<Message[]>) => {
    // 如果updater是函数，则调用它获取新的消息数组
    if (typeof updater === 'function') {
      const currentMessages = [regularMessage] // 当前只处理单条消息
      const updatedMessages = updater(currentMessages)
      const updatedMessage = updatedMessages.find((m) => m.id === regularMessage.id)

      if (updatedMessage) {
        // 使用Redux的action更新消息
        dispatch(
          updateMessage({
            topicId: topic.id,
            messageId: updatedMessage.id,
            updates: updatedMessage
          })
        )
      }
    }
  }

  // 在hooks调用后进行条件判断
  const isStreaming = !!(streamMessage && streamMessage.id === _message.id)
  const message = isStreaming ? streamMessage : regularMessage

  return (
    <MessageStreamContainer>
      <MessageItem
        message={message}
        topic={topic}
        assistant={assistant}
        index={index}
        hidePresetMessages={hidePresetMessages}
        isGrouped={isGrouped}
        style={style}
        isStreaming={isStreaming}
        onSetMessages={handleSetMessages} // 添加消息更新函数
      />
    </MessageStreamContainer>
  )
}

export default memo(MessageStream)
