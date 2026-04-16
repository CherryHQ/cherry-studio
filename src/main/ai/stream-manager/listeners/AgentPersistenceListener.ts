/**
 * Persists agent session messages to the agents DB (session_messages table)
 * when the stream ends.
 *
 * Unlike PersistenceListener (which writes to the main message table via MessageService),
 * this writes to the agents DB via AgentMessageRepository — the source of truth for
 * agent session history.
 */

import { loggerService } from '@logger'
import { agentMessageRepository } from '@main/services/agents/database/sessionMessageRepository'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { SerializedError } from '@shared/types/error'
import type { UIMessage } from 'ai'

import type { StreamDoneResult, StreamListener, StreamPausedResult } from '../types'

const logger = loggerService.withContext('AgentPersistenceListener')

export interface AgentPersistenceListenerOptions {
  /** Cherry Studio session ID (not the SDK session ID). */
  sessionId: string
  /** Agent ID. */
  agentId: string
  /** SDK session ID for resume (from providerMetadata['claude-code'].sessionId). */
  agentSessionId?: string
}

export class AgentPersistenceListener implements StreamListener {
  readonly id: string

  constructor(private readonly ctx: AgentPersistenceListenerOptions) {
    this.id = `agent-persistence:${ctx.sessionId}`
  }

  onChunk(): void {
    // Persistence only writes on terminal events.
  }

  async onDone(result: StreamDoneResult): Promise<void> {
    const { finalMessage } = result

    if (!finalMessage) {
      logger.warn('onDone without finalMessage, skipping agent persistence', {
        sessionId: this.ctx.sessionId,
        status: 'success'
      })
      return
    }

    try {
      // Persist user message (extracted from the stream's first user part)
      // Note: for agent sessions, the user message was already sent as part of the request.
      // We persist the assistant response here.
      await this.persistAssistantMessage(finalMessage)
      logger.info('Agent assistant message persisted', { sessionId: this.ctx.sessionId, status: 'success' })
    } catch (err) {
      logger.error('Failed to persist agent message', { sessionId: this.ctx.sessionId, err })
    }
  }

  async onPaused(result: StreamPausedResult): Promise<void> {
    const { finalMessage } = result

    if (!finalMessage) {
      logger.warn('onPaused without finalMessage, skipping agent persistence', {
        sessionId: this.ctx.sessionId
      })
      return
    }

    try {
      await this.persistAssistantMessage(finalMessage, 'paused')
      logger.info('Agent paused message persisted', { sessionId: this.ctx.sessionId })
    } catch (err) {
      logger.error('Failed to persist paused agent message', { sessionId: this.ctx.sessionId, err })
    }
  }

  async onError(error: SerializedError, partialMessage?: UIMessage): Promise<void> {
    try {
      const partialParts = (partialMessage?.parts ?? []) as CherryMessagePart[]
      const errorPart = { type: 'data-error' as const, data: { ...error } }

      const finalMessage = {
        id: partialMessage?.id ?? crypto.randomUUID(),
        role: 'assistant' as const,
        parts: [...partialParts, errorPart] as UIMessage['parts']
      } as UIMessage

      await this.persistAssistantMessage(finalMessage, 'error')
      logger.info('Agent error message persisted', { sessionId: this.ctx.sessionId, hasPartial: !!partialMessage })
    } catch (err) {
      logger.error('Failed to persist agent error message', { sessionId: this.ctx.sessionId, err })
    }
  }

  isAlive(): boolean {
    return true
  }

  private async persistAssistantMessage(
    finalMessage: UIMessage,
    status: 'success' | 'paused' | 'error' = 'success'
  ): Promise<void> {
    const now = new Date().toISOString()

    await agentMessageRepository.persistAssistantMessage({
      sessionId: this.ctx.sessionId,
      agentSessionId: this.ctx.agentSessionId ?? '',
      payload: {
        message: {
          id: finalMessage.id,
          role: 'assistant',
          assistantId: this.ctx.agentId,
          topicId: `agent-session:${this.ctx.sessionId}`,
          createdAt: now,
          status,
          data: { parts: finalMessage.parts as CherryMessagePart[] }
        },
        blocks: []
      }
    })
  }
}
