import { loggerService } from '@logger'
import type { AgentStream } from '@main/services/agents/interfaces/AgentStreamInterface'
import { serializeError } from '@shared/types/error'
import { createUIMessageStream } from 'ai'

import type { AiStreamManager } from '../AiStreamManager'

const logger = loggerService.withContext('ClaudeCodeStreamAdapter')

/**
 * Bridges ClaudeCodeService's AgentStream (TextStreamPart events) to AiStreamManager
 * (UIMessageChunk). Uses AI SDK's createUIMessageStream for type-safe conversion.
 */
export function bridgeAgentStream(params: {
  topicId: string
  agentStream: AgentStream
  manager: AiStreamManager
}): void {
  const { topicId, agentStream, manager } = params

  // Create a UIMessageChunk stream from the AgentStream's TextStreamPart events.
  // createUIMessageStream gives us a writer that accepts UIMessageChunk writes,
  // and produces a ReadableStream<UIMessageChunk> output.
  const uiStream = createUIMessageStream({
    execute: ({ writer }) => {
      return new Promise<void>((resolve, reject) => {
        agentStream.on('data', (event) => {
          switch (event.type) {
            case 'chunk':
              if (event.chunk) {
                // TextStreamPart → UIMessageChunk: the writer handles the conversion
                // by accepting UIMessageChunk directly via write()
                writer.write(event.chunk as never) // TextStreamPart overlaps structurally
              }
              break

            case 'complete':
              resolve()
              break

            case 'error':
              reject(event.error ?? new Error('Unknown agent error'))
              break

            case 'cancelled':
              resolve()
              break

            default:
              logger.warn('Unknown AgentStream event type', {
                topicId,
                type: (event as { type: string }).type
              })
          }
        })
      })
    },
    onError: (error) => {
      logger.error('Agent stream error', { topicId, error })
      return error instanceof Error ? error.message : String(error)
    }
  })

  // Consume the UIMessageChunk stream and forward to AiStreamManager
  const reader = uiStream.getReader()

  void (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        manager.onChunk(topicId, value)
      }
      void manager.onDone(topicId, 'success')
    } catch (err) {
      void manager.onError(topicId, serializeError(err))
    } finally {
      reader.releaseLock()
    }
  })()
}
