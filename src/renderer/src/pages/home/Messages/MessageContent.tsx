import { getModelUniqId } from '@renderer/services/ModelService'
import type { Message } from '@renderer/types/newMessage'
import { Flex } from 'antd'
import { isEmpty } from 'lodash'
import React from 'react'
import styled from 'styled-components'

import MessageBlockRenderer from './Blocks'
interface Props {
  message: Message
}

const MessageContent: React.FC<Props> = ({ message }) => {
  return (
    <>
      {!isEmpty(message.mentions) && (
        <Flex gap="8px" wrap style={{ marginBottom: '10px' }}>
          {message.mentions?.map((model) => <MentionTag key={getModelUniqId(model)}>{'@' + model.name}</MentionTag>)}
        </Flex>
      )}
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
