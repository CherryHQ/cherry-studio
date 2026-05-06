import { Chat } from '@ai-sdk/react'
import { loggerService } from '@logger'
import { ExecutionTransport } from '@renderer/transport/IpcChatTransport'
import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { useEffect, useRef, useState } from 'react'

const logger = loggerService.withContext('useExecutionChats')

export interface ExecutionFinishEvent {
  message: CherryUIMessage
  isAbort: boolean
  isError: boolean
}

interface UseExecutionChatsOptions {
  initialMessages?: CherryUIMessage[]
  onFinish?: (executionId: string, event: ExecutionFinishEvent) => void
}

/**
 * Look up the seed message by anchor id directly. Main broadcasts the
 * `anchorMessageId` for each live execution alongside the executionId, so
 * the renderer can seed `Chat` with the exact placeholder/anchor by id —
 * no `findLast(modelId)` heuristic, no race vs SWR refresh.
 *
 * Returns `undefined` if the anchor isn't (yet) in `messages`. AI SDK then
 * creates a fresh assistant from the start chunk's `messageId`. SWR catches
 * up shortly and `mergedPartsMap` reconciles by id.
 */
export function pickSeed(
  messages: CherryUIMessage[] | undefined,
  anchorMessageId: string | undefined
): CherryUIMessage[] | undefined {
  if (!anchorMessageId) return undefined
  const own = messages?.find((m) => m.id === anchorMessageId)
  return own ? [own] : undefined
}

export function useExecutionChats(
  topicId: string,
  activeExecutions: readonly ActiveExecution[],
  { initialMessages, onFinish }: UseExecutionChatsOptions = {}
): Map<UniqueModelId, Chat<CherryUIMessage>> {
  const [chats, setChats] = useState<Map<UniqueModelId, Chat<CherryUIMessage>>>(() => new Map())

  const initialMessagesRef = useRef(initialMessages)
  initialMessagesRef.current = initialMessages

  const onFinishRef = useRef(onFinish)
  onFinishRef.current = onFinish

  useEffect(() => {
    setChats((prev) => {
      let next = prev
      for (const { executionId, anchorMessageId } of activeExecutions) {
        if (next.has(executionId)) continue
        if (next === prev) next = new Map(prev)
        const transport = new ExecutionTransport(topicId, executionId)
        next.set(
          executionId,
          new Chat<CherryUIMessage>({
            id: `${topicId}:${executionId}`,
            transport,
            messages: pickSeed(initialMessagesRef.current, anchorMessageId),
            onError: (error) => {
              logger.warn('Execution chat error', { topicId, executionId, error })
            },
            onFinish: ({ message, isAbort, isError }) => {
              onFinishRef.current?.(executionId, { message, isAbort, isError })
            }
          })
        )
      }
      return next
    })
  }, [topicId, activeExecutions])

  return chats
}
