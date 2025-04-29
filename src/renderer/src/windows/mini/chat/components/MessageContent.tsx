import Markdown from '@renderer/pages/home/Markdown/Markdown'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { MainTextMessageBlock, Message } from '@renderer/types/newMessage'
import { Flex } from 'antd'
import React from 'react'
import styled from 'styled-components'

interface Props {
  message: Message
  block: MainTextMessageBlock
}

const MessageContent: React.FC<Props> = ({ message, block }) => {
  return (
    <>
      <Flex gap="8px" wrap style={{ marginBottom: 10 }}>
        {message.mentions?.map((model) => <MentionTag key={getModelUniqId(model)}>{'@' + model.name}</MentionTag>)}
      </Flex>
      <Markdown block={block} />
    </>
  )
}

const MentionTag = styled.span`
  color: var(--color-link);
`

export default React.memo(MessageContent)
