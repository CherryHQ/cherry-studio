import { isEmpty } from 'es-toolkit/compat'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { Flex } from '@cherrystudio/ui'
import { createUniqueModelId } from '@shared/data/types/model'

import MessagePartsRenderer from '../blocks/MessagePartsRenderer'
import type { MessageListItem } from '../types'

interface Props {
  message: MessageListItem
  hoistAttachments?: boolean
}

const MessageContent: React.FC<Props> = ({ message, hoistAttachments }) => {
  const { t } = useTranslation()
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
      <MessagePartsRenderer message={message} hoistAttachments={hoistAttachments} />
      {message.role === 'assistant' && message.finishReason === 'length' && (
        <Flex role="status" aria-live="polite" className="mt-2 text-sm text-muted-foreground">
          {t('message.finish_reason.length')}
        </Flex>
      )}
    </>
  )
}

export default React.memo(MessageContent)
