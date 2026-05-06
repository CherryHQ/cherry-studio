import { Chat } from '@ai-sdk/react'
import { loggerService } from '@logger'
import { ExecutionTransport } from '@renderer/transport/IpcChatTransport'
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

export function pickSeed(
  messages: CherryUIMessage[] | undefined,
  executionId: UniqueModelId
): CherryUIMessage[] | undefined {
  const own = messages?.findLast((m) => m.role === 'assistant' && m.metadata?.modelId === executionId)
  return own ? [own] : undefined
}

export function useExecutionChats(
  topicId: string,
  executionIds: readonly UniqueModelId[],
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
      for (const executionId of executionIds) {
        if (next.has(executionId)) continue
        if (next === prev) next = new Map(prev)
        const transport = new ExecutionTransport(topicId, executionId)
        next.set(
          executionId,
          new Chat<CherryUIMessage>({
            id: `${topicId}:${executionId}`,
            transport,
            messages: pickSeed(initialMessagesRef.current, executionId),
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
  }, [topicId, executionIds])

  return chats
}
