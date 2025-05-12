import { getModelUniqId } from '@renderer/services/ModelService'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { Flex } from 'antd'
import React from 'react'
import styled from 'styled-components'

import MessageBlockRenderer from './Blocks'
import MessageEditor from './MessageEditor'
interface Props {
  message: Message
  isEditing?: boolean
  onSave: (blocks: MessageBlock[]) => Promise<void>
  onResend: (blocks: MessageBlock[]) => Promise<void>
  onCancel: () => void
}

const MessageContent: React.FC<Props> = ({ message, isEditing, onSave, onResend, onCancel }) => {
  if (isEditing) {
    return <MessageEditor message={message} onSave={onSave} onResend={onResend} onCancel={onCancel} />
  }
  return (
    <>
      <Flex gap="8px" wrap style={{ marginBottom: 10 }}>
        {message.mentions?.map((model) => <MentionTag key={getModelUniqId(model)}>{'@' + model.name}</MentionTag>)}
      </Flex>
      <MessageBlockRenderer blocks={message.blocks} message={message} />
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
