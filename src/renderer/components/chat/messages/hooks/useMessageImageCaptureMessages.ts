import { useEffect, useMemo, useState } from 'react'

import { createPartsByMessageId } from '@renderer/utils/message/exportView'
import type { CherryUIMessage } from '@shared/data/types/message'

interface UseMessageImageCaptureMessagesOptions<TMessage> {
  loadMessages: () => Promise<TMessage[]>
  mapMessage: (message: TMessage) => CherryUIMessage
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Injected message loading or projection can throw arbitrary values; pass the current failure to the owning capture host.
  onError: (error: unknown) => void
}

export function useMessageImageCaptureMessages<TMessage>({
  loadMessages,
  mapMessage,
  onError
}: UseMessageImageCaptureMessagesOptions<TMessage>) {
  const [messages, setMessages] = useState<CherryUIMessage[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setMessages(null)

    void loadMessages()
      .then((loadedMessages) => {
        if (!cancelled) setMessages(loadedMessages.map(mapMessage))
      })
      .catch((error) => {
        if (!cancelled) onError(error)
      })

    return () => {
      cancelled = true
    }
  }, [loadMessages, onError, mapMessage])

  const partsByMessageId = useMemo(() => (messages ? createPartsByMessageId(messages) : {}), [messages])

  return { messages, partsByMessageId }
}
