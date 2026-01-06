import { Flex } from '@cherrystudio/ui'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { isEmpty } from 'lodash'
import React from 'react'
import styled from 'styled-components'

import MessageBlockRenderer from './Blocks'
interface Props {
  message: Message
  blocks?: MessageBlock[]
}

const MessageContent: React.FC<Props> = ({ message, blocks }) => {
  return (
    <>
      {!isEmpty(message.mentions) && (
        <Flex className="mb-2.5 flex-wrap gap-2">
          {message.mentions?.map((model) => (
            <MentionTag key={getModelUniqId(model)}>{'@' + model.name}</MentionTag>
          ))}
        </Flex>
      )}
      {/* NOTE: [v2 Migration] blocks prop takes priority over message.blocks.
          When blocks is provided (from DataApi/Streaming), use it directly.
          Otherwise fall back to message.blocks (string[] for Redux path). */}
      <MessageBlockRenderer blocks={blocks ?? message.blocks} message={message} />
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
