/**
 * Headless component: runs useChat for one multi-model execution.
 *
 * Accumulates chunks filtered by executionId, reports messages to parent via callback.
 * Renders nothing — parent merges into adaptedMessages for existing Messages/MessageGroup rendering.
 */

import { useChat } from '@ai-sdk/react'
import { ExecutionTransport } from '@renderer/transport/IpcChatTransport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { FC } from 'react'
import { useEffect, useMemo } from 'react'

interface Props {
  topicId: string
  executionId: string
  initialMessages: CherryUIMessage[]
  onMessages: (executionId: string, messages: CherryUIMessage[]) => void
}

const ExecutionStreamCollector: FC<Props> = ({ topicId, executionId, initialMessages, onMessages }) => {
  const transport = useMemo(() => new ExecutionTransport(topicId, executionId), [topicId, executionId])

  const { messages } = useChat<CherryUIMessage>({
    id: `${topicId}:${executionId}`,
    transport,
    messages: initialMessages,
    resume: true,
    experimental_throttle: 50
  })

  // Report accumulated messages to parent
  useEffect(() => {
    onMessages(executionId, messages)
  }, [executionId, messages, onMessages])

  return null // Headless — rendering handled by parent's <Messages>
}

export default ExecutionStreamCollector
