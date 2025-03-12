import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import { updateMessage } from '@renderer/store/messages'
import { Message, Topic } from '@renderer/types'
import { FC, memo, useCallback, useMemo, useState } from 'react'
import { useDispatch } from 'react-redux'
import styled from 'styled-components'

interface Props {
  message: Message
  topic: Topic
}

const MessageNavigator: FC<Props> = ({ message, topic }) => {
  const { historyList = [] } = message
  const totalMessages = useMemo(() => historyList.length, [historyList.length])
  const [currentMessageIndex, setCurrentMessageIndex] = useState(historyList?.length ?? 1)
  const dispatch = useDispatch()
  const setCurrentMessage = useCallback(
    (index: number) => {
      setCurrentMessageIndex(index)
      const currentMessage = historyList[index - 1]
      dispatch(
        updateMessage({
          topicId: topic.id,
          messageId: message.id,
          updates: { ...currentMessage, historyList, id: currentMessage.id }
        })
      )
    },
    [dispatch, historyList, message.id, topic.id]
  )
  const handlePrev = () => setCurrentMessage(Math.max(1, currentMessageIndex - 1))
  const handleNext = () => setCurrentMessage(Math.min(totalMessages, currentMessageIndex + 1))

  if (totalMessages <= 1) return null

  return (
    <NavigationWrapper>
      <ActionButton disabled={currentMessageIndex === 1} onClick={handlePrev}>
        <LeftOutlined />
      </ActionButton>
      <MessageCounter>{`${currentMessageIndex}/${totalMessages}`}</MessageCounter>
      <ActionButton disabled={currentMessageIndex === totalMessages} onClick={handleNext}>
        <RightOutlined />
      </ActionButton>
    </NavigationWrapper>
  )
}

const NavigationWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  .anticon {
    font-size: 16px;
    color: var(--color-text-2);
  }
`

const ActionButton = styled.div<{ disabled: boolean }>`
  pointer-events: ${({ disabled }) => (disabled ? 'none' : 'auto')};
  cursor: ${({ disabled }) => (disabled ? 'not-allowed' : 'pointer')};
  border-radius: 8px;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 30px;
  height: 30px;
  transition: all 0.2s ease;

  ${({ disabled }) =>
    !disabled &&
    `
    &:hover {
      background-color: var(--color-background-mute);
      .anticon {
        color: var(--color-text-1);
      }
    }
  `}

  .anticon {
    font-size: 14px;
    color: var(--color-icon);
  }
`

const MessageCounter = styled.div`
  font-size: 12px;
  color: var(--color-text-2);
`

export default memo(MessageNavigator)
