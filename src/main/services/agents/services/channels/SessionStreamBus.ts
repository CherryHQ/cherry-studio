import { EventEmitter } from 'node:events'

import type { TextStreamPart } from 'ai'

export type SessionStreamChunk = {
  sessionId: string
  agentId: string
  type: 'user-message' | 'chunk' | 'complete' | 'error'
  chunk?: TextStreamPart<Record<string, any>>
  userMessage?: {
    chatId: string
    userId: string
    userName: string
    text: string
    images?: Array<{ data: string; media_type: string }>
  }
  error?: { message: string }
}

class SessionStreamBus extends EventEmitter {
  private static instance: SessionStreamBus | null = null

  static getInstance(): SessionStreamBus {
    if (!SessionStreamBus.instance) {
      SessionStreamBus.instance = new SessionStreamBus()
    }
    return SessionStreamBus.instance
  }

  publish(sessionId: string, event: SessionStreamChunk): void {
    this.emit(sessionId, event)
  }

  subscribe(sessionId: string, listener: (event: SessionStreamChunk) => void): () => void {
    this.on(sessionId, listener)
    return () => this.removeListener(sessionId, listener)
  }

  hasSubscribers(sessionId: string): boolean {
    return this.listenerCount(sessionId) > 0
  }

  cleanup(sessionId: string): void {
    this.removeAllListeners(sessionId)
  }
}

export const sessionStreamBus = SessionStreamBus.getInstance()
