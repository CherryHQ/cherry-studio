import { useCallback, useEffect, useRef } from 'react'

type SessionStreamChunk = {
  sessionId: string
  agentId: string
  type: 'user-message' | 'chunk' | 'complete' | 'error'
  chunk?: any
  userMessage?: {
    chatId: string
    userId: string
    userName: string
    text: string
    images?: Array<{ data: string; media_type: string }>
  }
  error?: { message: string }
}

export function useSessionStream(sessionId: string | null, onChunk: (chunk: SessionStreamChunk) => void) {
  const onChunkRef = useRef(onChunk)
  onChunkRef.current = onChunk

  const stableOnChunk = useCallback((chunk: SessionStreamChunk) => {
    onChunkRef.current(chunk)
  }, [])

  useEffect(() => {
    if (!sessionId) return

    void window.api.agentSessionStream.subscribe(sessionId)

    const cleanup = window.api.agentSessionStream.onChunk((chunk) => {
      if (chunk.sessionId !== sessionId) return
      stableOnChunk(chunk as SessionStreamChunk)
    })

    return () => {
      cleanup()
      void window.api.agentSessionStream.unsubscribe(sessionId)
    }
  }, [sessionId, stableOnChunk])
}
