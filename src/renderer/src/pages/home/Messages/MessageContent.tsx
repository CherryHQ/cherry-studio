import { Flex } from '@cherrystudio/ui'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { Message } from '@renderer/types/newMessage'
import { isEmpty } from 'lodash'
import React from 'react'
import styled from 'styled-components'

import MessageBlockRenderer from './Blocks'
import PartsRenderer from './Blocks/PartsRenderer'
import { useIsV2Chat } from './Blocks/V2Contexts'

interface Props {
  message: Message
}

const MessageContent: React.FC<Props> = ({ message }) => {
  const isV2 = useIsV2Chat()

  return (
    <>
      {!isEmpty(message.mentions) && (
        <Flex className="mb-2.5 flex-wrap gap-2">
          {message.mentions?.map((model) => (
            <MentionTag key={getModelUniqId(model)}>{'@' + model.name}</MentionTag>
          ))}
        </Flex>
      )}
      {isV2 ? <PartsRenderer message={message} /> : <MessageBlockRenderer blocks={message.blocks} message={message} />}
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
