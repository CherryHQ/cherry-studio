import { Flex } from '@cherrystudio/ui'
import type { Message } from '@renderer/types/newMessage'
import { createUniqueModelId } from '@shared/data/types/model'
import { isEmpty } from 'lodash'
import React from 'react'

import PartsRenderer from './Blocks/PartsRenderer'

interface Props {
  message: Message
}

const MessageContent: React.FC<Props> = ({ message }) => {
  return (
    <>
      {!isEmpty(message.mentions) && (
        <Flex className="mb-2.5 flex-wrap gap-2">
          {message.mentions?.map((model) => (
            <span key={createUniqueModelId(model.provider, model.id)} className="text-(--color-link)">
              {'@' + model.name}
            </span>
          ))}
        </Flex>
      )}
      <PartsRenderer message={message} />
    </>
  )
}

// const SearchingText = styled.div`
//   font-size: 14px;
//   line-height: 1.6;
//   text-decoration: none;
//   color: var(--color-text-1);
// `

export default React.memo(MessageContent)
