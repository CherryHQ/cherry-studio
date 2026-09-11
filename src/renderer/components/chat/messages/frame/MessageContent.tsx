import { isEmpty } from 'es-toolkit/compat'
import React from 'react'

import { Flex } from '@cherrystudio/ui'
import { createUniqueModelId } from '@shared/data/types/model'

import MessagePartsRenderer from '../blocks/MessagePartsRenderer'
import type { MessageListItem } from '../types'

interface Props {
  message: MessageListItem
  hoistAttachments?: boolean
  defaultUserContentExpanded?: boolean
}

const MessageContent: React.FC<Props> = ({ message, hoistAttachments, defaultUserContentExpanded }) => {
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
      <MessagePartsRenderer
        message={message}
        hoistAttachments={hoistAttachments}
        defaultUserContentExpanded={defaultUserContentExpanded}
      />
    </>
  )
}

export default React.memo(MessageContent)
