import type { Chat } from '@ai-sdk/react'
import { useChat } from '@ai-sdk/react'
import type { CherryUIMessage } from '@shared/data/types/message'
import { useEffect, useRef } from 'react'

interface ExecutionStreamCollectorProps {
  executionId: string
  chat: Chat<CherryUIMessage>
  onMessagesChange: (executionId: string, messages: CherryUIMessage[]) => void
  onDispose?: (executionId: string) => void
}

export default function ExecutionStreamCollector({
  executionId,
  chat,
  onMessagesChange,
  onDispose
}: ExecutionStreamCollectorProps) {
  const { messages } = useChat<CherryUIMessage>({ chat, resume: true, experimental_throttle: 50 })

  const seedRef = useRef(messages)
  const hasReceivedChunkRef = useRef(false)

  useEffect(() => {
    if (!hasReceivedChunkRef.current) {
      if (messages === seedRef.current) return
      hasReceivedChunkRef.current = true
    }
    onMessagesChange(executionId, messages)
  }, [executionId, messages, onMessagesChange])

  useEffect(() => {
    return () => {
      onDispose?.(executionId)
    }
  }, [executionId, onDispose])

  return null
}
