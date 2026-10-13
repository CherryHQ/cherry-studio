import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { toast } from '@renderer/services/toast'

export function useQuotedMessageLocateRequest(topicId: string) {
  const [request, setRequest] = useState<{ topicId: string; messageId: string }>()
  const { t } = useTranslation()

  useEffect(() => {
    setRequest(undefined)
    return EventEmitter.on(EVENT_NAMES.LOCATE_QUOTED_MESSAGE, (payload) => {
      const next = payload as { topicId: string; messageId: string }
      if (next.topicId === topicId) setRequest(next)
    })
  }, [topicId])

  const finish = useCallback(
    (found: boolean) => {
      if (!found) toast.info(t('chat.message.quotes.missing'))
      setRequest(undefined)
    },
    [t]
  )

  return { quotedMessageId: request?.topicId === topicId ? request.messageId : undefined, finish }
}
