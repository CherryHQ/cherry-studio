import { useSettings } from '@renderer/hooks/useSettings'
import { Message, Topic } from '@renderer/types'
import { Segmented } from 'antd'
import { Dispatch, FC, SetStateAction, useState } from 'react'
import styled from 'styled-components'

import MessageItem from './Message'

interface Props {
  messages: (Message & { index: number })[]
  topic?: Topic
  hidePresetMessages?: boolean
  onGetMessages?: () => Message[]
  onSetMessages?: Dispatch<SetStateAction<Message[]>>
  onDeleteMessage?: (message: Message) => void
}

const MessageGroup: FC<Props> = ({
  messages,
  topic,
  hidePresetMessages,
  onDeleteMessage,
  onSetMessages,
  onGetMessages
}) => {
  const { multiModelMessageStyle } = useSettings()
  const messageLength = messages.length
  const [selectedIndex, setSelectedIndex] = useState(0)

  return (
    <GroupContainer>
      {messageLength > 1 && multiModelMessageStyle === 'fold' && (
        <Segmented
          value={selectedIndex.toString()}
          onChange={(value) => setSelectedIndex(Number(value))}
          options={messages.map((message, index) => ({
            label: `@${message.modelId}`,
            value: index.toString()
          }))}
          size="small"
        />
      )}
      <GridContainer $count={messageLength} $layout={multiModelMessageStyle}>
        {messages.map((message, index) => (
          <MessageWrapper $layout={multiModelMessageStyle} $selected={index === selectedIndex} key={message.id}>
            <MessageItem
              message={message}
              topic={topic}
              index={message.index}
              hidePresetMessages={hidePresetMessages}
              onSetMessages={onSetMessages}
              onDeleteMessage={onDeleteMessage}
              onGetMessages={onGetMessages}
            />
          </MessageWrapper>
        ))}
      </GridContainer>
    </GroupContainer>
  )
}

const GroupContainer = styled.div``

const GridContainer = styled.div<{ $count: number; $layout: 'fold' | 'horizontal' | 'vertical' }>`
  width: 100%;
  overflow-x: auto;
  display: grid;
  grid-template-columns: repeat(
    ${(props) => (['fold', 'vertical'].includes(props.$layout) ? 1 : props.$count)},
    minmax(400px, 1fr)
  );
  gap: 16px;
`

const MessageWrapper = styled.div<{ $layout: 'fold' | 'horizontal' | 'vertical'; $selected: boolean }>`
  width: 100%;
  display: ${(props) => {
    if (props.$layout === 'fold') {
      return props.$selected ? 'block' : 'none'
    }
    if (props.$layout === 'horizontal') {
      return 'inline-block'
    }
    return 'block'
  }};
`

export default MessageGroup
