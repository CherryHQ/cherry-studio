import type { MessageExportView } from '@renderer/types/messageExport'
import { createPartsByMessageId, exportViewToUIMessage } from '@renderer/utils/message/exportView'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { useEffect, useMemo, useState } from 'react'

interface UseMessageImageCaptureMessagesOptions {
  loadMessages: () => Promise<MessageExportView[]>
  onError: (error: unknown) => void
}

export function useMessageImageCaptureMessages({ loadMessages, onError }: UseMessageImageCaptureMessagesOptions): {
  messages: CherryUIMessage[] | null
  partsByMessageId: Record<string, CherryMessagePart[]>
} {
  const [messages, setMessages] = useState<CherryUIMessage[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setMessages(null)

    void loadMessages()
      .then((exportMessages) => {
        if (!cancelled) setMessages(exportMessages.map(exportViewToUIMessage))
      })
      .catch((error) => {
        if (!cancelled) onError(error)
      })

    return () => {
      cancelled = true
    }
  }, [loadMessages, onError])

  const partsByMessageId = useMemo(() => (messages ? createPartsByMessageId(messages) : {}), [messages])

  return { messages, partsByMessageId }
}
