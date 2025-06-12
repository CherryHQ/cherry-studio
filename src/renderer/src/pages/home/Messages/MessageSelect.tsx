import { useChatContext } from '@renderer/hooks/useChatContext'
import { Topic } from '@renderer/types'
import { Checkbox } from 'antd'
import { FC, ReactNode, useEffect, useRef } from 'react'
import styled from 'styled-components'

interface SelectableMessageProps {
  children: ReactNode
  messageId: string
  topic: Topic
  isClearMessage?: boolean
}

const SelectableMessage: FC<SelectableMessageProps> = ({ children, messageId, topic, isClearMessage = false }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const {
    registerMessageElement: contextRegister,
    isMultiSelectMode,
    selectedMessageIds,
    handleSelectMessage
  } = useChatContext(topic)

  const isSelected = selectedMessageIds?.includes(messageId)

  useEffect(() => {
    if (containerRef.current) {
      contextRegister(messageId, containerRef.current)
      return () => {
        contextRegister(messageId, null)
      }
    }
    return undefined
  }, [messageId, contextRegister])

  return (
    <Container ref={containerRef}>
      {isMultiSelectMode && !isClearMessage && (
        <CheckboxWrapper>
          <Checkbox checked={isSelected} onChange={(e) => handleSelectMessage(messageId, e.target.checked)} />
        </CheckboxWrapper>
      )}
      <MessageContent isMultiSelectMode={isMultiSelectMode}>{children}</MessageContent>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  width: 100%;
  position: relative;
`

const CheckboxWrapper = styled.div`
  padding: 22px 0 10px 20px;
  margin-right: -10px;
  display: flex;
  align-items: flex-start;
`

const MessageContent = styled.div<{ isMultiSelectMode: boolean }>`
  flex: 1;
  min-width: 0;
  ${(props) => props.isMultiSelectMode && 'margin-left: 8px;'}
`

export default SelectableMessage
