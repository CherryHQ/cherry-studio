import { loggerService } from '@logger'
import type { AgentStream } from '@main/services/agents/interfaces/AgentStreamInterface'
import { serializeError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

import type { AiStreamManager } from '../AiStreamManager'

const logger = loggerService.withContext('ClaudeCodeStreamAdapter')

/**
 * Bridges ClaudeCodeService's AgentStream events to AiStreamManager.
 *
 * ClaudeCodeService produces an EventEmitter (AgentStream) with events:
 *   { type: 'chunk', chunk: TextStreamPart }
 *   { type: 'complete' }
 *   { type: 'error', error: Error }
 *   { type: 'cancelled', error?: Error }
 *
 * This adapter subscribes to those events and forwards them to the
 * AiStreamManager via onChunk / onDone / onError, keyed by topicId.
 *
 * It also captures the SDK session_id from the AgentStream for resume support.
 */
export function bridgeAgentStream(params: {
  topicId: string
  agentStream: AgentStream
  manager: AiStreamManager
}): void {
  const { topicId, agentStream, manager } = params

  agentStream.on('data', (event) => {
    switch (event.type) {
      case 'chunk':
        if (event.chunk) {
          // TODO: TextStreamPart → UIMessageChunk conversion.
          // Currently AgentStreamEvent.chunk is TextStreamPart<any>, but
          // AiStreamManager.onChunk expects UIMessageChunk. These are structurally
          // similar for text-delta/tool-call parts but not type-identical.
          // Phase 6 (ClaudeCodeService → unified ToolLoopAgent) will eliminate this
          // mismatch entirely. For now, pass through with assertion.
          manager.onChunk(topicId, event.chunk as unknown as UIMessageChunk)
        }
        break

      case 'complete':
        // TODO: Build CherryUIMessage from accumulated chunks via AI SDK tools,
        // then call manager.setStreamFinalMessage(topicId, cherryMessage).
        // For now, sdkSessionId is stored on the ActiveStream directly.
        void manager.onDone(topicId, 'success')
        break

      case 'error':
        void manager.onError(topicId, serializeError(event.error ?? new Error('Unknown agent error')))
        break

      case 'cancelled':
        // Cancelled = user-initiated abort with possible partial result
        void manager.onDone(topicId, 'paused')
        break

      default:
        logger.warn('Unknown AgentStream event type', { topicId, type: (event as { type: string }).type })
    }
  })
}
