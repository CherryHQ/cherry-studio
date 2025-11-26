import { getModelUniqId } from '@renderer/services/ModelService'
import type { Message } from '@renderer/types/newMessage'
import { Flex } from 'antd'
import { isEmpty } from 'lodash'
import React from 'react'
import styled from 'styled-components'

import MessageBlockRenderer from './Blocks'
import FinishReasonWarning from './FinishReasonWarning'

interface Props {
  message: Message
  onContinueGeneration?: (message: Message) => void
  onDismissWarning?: (message: Message) => void
}

const MessageContent: React.FC<Props> = ({ message, onContinueGeneration, onDismissWarning }) => {
  // Check if we should show finish reason warning
  const showFinishReasonWarning =
    message.role === 'assistant' &&
    message.finishReason &&
    message.finishReason !== 'stop' &&
    message.finishReason !== 'tool-calls'

  const handleContinue = () => {
    onContinueGeneration?.(message)
  }

  const handleDismiss = () => {
    onDismissWarning?.(message)
  }

  return (
    <>
      {!isEmpty(message.mentions) && (
        <Flex gap="8px" wrap style={{ marginBottom: '10px' }}>
          {message.mentions?.map((model) => (
            <MentionTag key={getModelUniqId(model)}>{'@' + model.name}</MentionTag>
          ))}
        </Flex>
      )}
      <MessageBlockRenderer blocks={message.blocks} message={message} />
      {showFinishReasonWarning && (
        <FinishReasonWarning
          finishReason={message.finishReason!}
          onContinue={onContinueGeneration ? handleContinue : undefined}
          onDismiss={onDismissWarning ? handleDismiss : undefined}
        />
      )}
    </>
  )
}

const MentionTag = styled.span`
  color: var(--color-link);
`

// const SearchingText = styled.div`
//   font-size: 14px;
//   line-height: 1.6;
//   text-decoration: none;
//   color: var(--color-text-1);
// `

export default React.memo(MessageContent)
