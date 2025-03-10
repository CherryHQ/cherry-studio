import { useAppSelector } from '@renderer/store'
import { selectStreamMessage } from '@renderer/store/messages'
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
  onSetMessages?: React.Dispatch<React.SetStateAction<Message[]>>
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
  style,
  onSetMessages
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

  // 在hooks调用后进行条件判断
  const isStreaming = !!(streamMessage && streamMessage.id === _message.id)
  const message = isStreaming ? streamMessage : regularMessage
  console.log('isStreaming', isStreaming)
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
        onSetMessages={onSetMessages}
      />
    </MessageStreamContainer>
  )
}

export default memo(MessageStream)
