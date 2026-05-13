import { Flex } from '@cherrystudio/ui'
import type { Message } from '@renderer/types/newMessage'
import { createUniqueModelId } from '@shared/data/types/model'
import { isEmpty } from 'lodash'
import React from 'react'

import MessagePartsRenderer from '../blocks/MessagePartsRenderer'

interface Props {
  message: Message
}

const MessageContent: React.FC<Props> = ({ message }) => {
  return (
    <>
      {!isEmpty(message.mentions) && (
        <Flex className="mb-2.5 flex-wrap gap-2">
          {message.mentions?.map((model) => (
            <span key={createUniqueModelId(model.provider, model.id)} className="text-primary">
              {'@' + model.name}
            </span>
          ))}
        </Flex>
      )}
      <MessagePartsRenderer message={message} />
    </>
  )
}

export default React.memo(MessageContent)
