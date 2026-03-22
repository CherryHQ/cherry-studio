import { EventEmitter } from 'node:events'

import type { TextStreamPart } from 'ai'

export type SessionStreamChunk = {
  sessionId: string
  agentId: string
  type: 'user-message' | 'chunk' | 'complete' | 'error'
  chunk?: TextStreamPart<Record<string, any>>
  userMessage?: { chatId: string; userId: string; userName: string; text: string }
  error?: { message: string }
}

class SessionStreamBus {
  private static instance: SessionStreamBus | null = null
  private readonly emitter = new EventEmitter()

  static getInstance(): SessionStreamBus {
    if (!SessionStreamBus.instance) {
      SessionStreamBus.instance = new SessionStreamBus()
    }
    return SessionStreamBus.instance
  }

  publish(sessionId: string, event: SessionStreamChunk): void {
    this.emitter.emit(sessionId, event)
  }

  subscribe(sessionId: string, listener: (event: SessionStreamChunk) => void): () => void {
    this.emitter.on(sessionId, listener)
    return () => this.emitter.removeListener(sessionId, listener)
  }

  hasSubscribers(sessionId: string): boolean {
    return this.emitter.listenerCount(sessionId) > 0
  }

  cleanup(sessionId: string): void {
    this.emitter.removeAllListeners(sessionId)
  }
}

export const sessionStreamBus = SessionStreamBus.getInstance()
