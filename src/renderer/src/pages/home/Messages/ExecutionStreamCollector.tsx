import { useChat } from '@ai-sdk/react'
import { loggerService } from '@logger'
import { ExecutionTransport } from '@renderer/transport/IpcChatTransport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { useEffect, useMemo } from 'react'

const logger = loggerService.withContext('ExecutionStreamCollector')

interface ExecutionStreamCollectorProps {
  topicId: string
  executionId: string
  initialMessages?: CherryUIMessage[]
  onMessagesChange: (executionId: string, messages: CherryUIMessage[]) => void
  onDispose?: (executionId: string) => void
}

export default function ExecutionStreamCollector({
  topicId,
  executionId,
  initialMessages,
  onMessagesChange,
  onDispose
}: ExecutionStreamCollectorProps) {
  const transport = useMemo(() => new ExecutionTransport(topicId, executionId as UniqueModelId), [topicId, executionId])

  const { messages } = useChat<CherryUIMessage>({
    id: `${topicId}:${executionId}`,
    transport,
    messages: initialMessages,
    resume: true,
    experimental_throttle: 50,
    onError: (error) => {
      // Per-execution terminal state (including this error) is surfaced to
      // the renderer via `useChatWithHistory`'s `onStreamError` listener,
      // which triggers a DataApi refresh so the overlay picks up the
      // backend-persisted `status='error'` + `data-error` part for this
      // bubble. This callback only needs to log — treating the collector
      // as a log endpoint, not as the source of truth.
      logger.warn('Execution stream collector error', { topicId, executionId, error })
    }
  })

  useEffect(() => {
    onMessagesChange(executionId, messages)
  }, [executionId, messages, onMessagesChange])

  useEffect(() => {
    return () => {
      onDispose?.(executionId)
    }
  }, [executionId, onDispose])

  return null
}
