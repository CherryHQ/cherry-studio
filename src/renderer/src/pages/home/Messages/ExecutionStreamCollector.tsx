import { useChat } from '@ai-sdk/react'
import { loggerService } from '@logger'
import { ExecutionTransport } from '@renderer/transport/IpcChatTransport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { ChatStatus } from 'ai'
import { useEffect, useMemo } from 'react'

const logger = loggerService.withContext('ExecutionStreamCollector')

/**
 * Per-execution live state reported back to the parent overlay. The
 * parent needs *per-execution* status so overlay bubbles can show the
 * correct state when only one of N multi-model executions has errored
 * — the outer `useChatWithHistory` status is a topic-level aggregate
 * that stays `'streaming'` as long as any execution is still alive,
 * which would otherwise keep errored bubbles stuck on the processing
 * spinner.
 */
export interface ExecutionStreamState {
  status: ChatStatus
  error: Error | undefined
}

interface ExecutionStreamCollectorProps {
  topicId: string
  executionId: string
  onMessagesChange: (executionId: string, messages: CherryUIMessage[]) => void
  onStateChange?: (executionId: string, state: ExecutionStreamState) => void
  onDispose?: (executionId: string) => void
}

export default function ExecutionStreamCollector({
  topicId,
  executionId,
  onMessagesChange,
  onStateChange,
  onDispose
}: ExecutionStreamCollectorProps) {
  const transport = useMemo(() => new ExecutionTransport(topicId, executionId as UniqueModelId), [topicId, executionId])

  const { messages, status, error } = useChat<CherryUIMessage>({
    id: `${topicId}:${executionId}`,
    transport,
    messages: [],
    resume: true,
    experimental_throttle: 50,
    onError: (streamError) => {
      logger.warn('Execution stream collector error', { topicId, executionId, streamError })
    }
  })

  useEffect(() => {
    onMessagesChange(executionId, messages)
  }, [executionId, messages, onMessagesChange])

  useEffect(() => {
    onStateChange?.(executionId, { status, error })
  }, [executionId, status, error, onStateChange])

  useEffect(() => {
    return () => {
      onDispose?.(executionId)
    }
  }, [executionId, onDispose])

  return null
}
