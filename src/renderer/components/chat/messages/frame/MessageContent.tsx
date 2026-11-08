import { isEmpty } from 'es-toolkit/compat'
import React from 'react'

import { Flex } from '@cherrystudio/ui'
import { createUniqueModelId } from '@shared/data/types/model'

import { MessagePartsScopeProvider } from '../blocks/MessagePartsContext'
import MessagePartsRenderer from '../blocks/MessagePartsRenderer'
import { useMessageHeldParts } from '../MessageListProvider'
import type { MessageListItem } from '../types'

interface Props {
  message: MessageListItem
  hoistAttachments?: boolean
}

const MessageContent: React.FC<Props> = ({ message, hoistAttachments }) => {
  const heldParts = useMessageHeldParts(message.id)
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
      {heldParts ? (
        <MessagePartsScopeProvider messageId={message.id} parts={heldParts}>
          <MessagePartsRenderer message={message} hoistAttachments={hoistAttachments} activity="held" />
        </MessagePartsScopeProvider>
      ) : (
        <MessagePartsRenderer message={message} hoistAttachments={hoistAttachments} />
      )}
    </>
  )
}

export default React.memo(MessageContent)
