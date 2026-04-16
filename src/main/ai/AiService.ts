import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { CherryUIMessage } from '@shared/data/types/message'
import { IpcChannel } from '@shared/IpcChannel'
import { serializeError } from '@shared/types/error'
import { readUIMessageStream } from 'ai'

import {
  type AiBaseRequest,
  AiCompletionService,
  type AiEmbedRequest,
  type AiGenerateRequest,
  type AiImageAbortRequest,
  type AiImageGenerateRequest,
  type AiStreamRequest
} from './AiCompletionService'
import type { StreamTarget } from './stream-manager/types'
import { ToolRegistry } from './tools/ToolRegistry'

const logger = loggerService.withContext('AiService')

/**
 * Lifecycle-managed AI service.
 *
 * Provides two categories of functionality:
 * - **Streaming**: `executeStream(target, request, signal)` — called by AiStreamManager,
 *   which handles all IPC, routing, and lifecycle management
 * - **Non-streaming**: generateText, checkModel, embedMany, generateImage, listModels —
 *   registered as IPC handlers directly
 */
@Injectable('AiService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['PreferenceService', 'MCPService'])
export class AiService extends BaseService {
  private toolRegistry = new ToolRegistry()
  private completionService = new AiCompletionService(this.toolRegistry)

  protected async onInit(): Promise<void> {
    this.registerIpcHandlers()
    logger.info('AiService initialized')
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.Ai_GenerateText, async (_, request: AiGenerateRequest) => {
      return this.completionService.generateText(request)
    })

    this.ipcHandle(IpcChannel.Ai_CheckModel, async (_, request: AiBaseRequest & { timeout?: number }) => {
      return this.completionService.checkModel(request)
    })

    this.ipcHandle(IpcChannel.Ai_EmbedMany, async (_, request: AiEmbedRequest) => {
      return this.completionService.embedMany(request)
    })

    this.ipcHandle(IpcChannel.Ai_GenerateImage, async (_, request: AiImageGenerateRequest) => {
      const controller = new AbortController()
      this.completionService.registerRequest(request.requestId, controller)
      try {
        return await this.completionService.generateImage(request.payload, controller.signal)
      } finally {
        this.completionService.removeRequest(request.requestId)
      }
    })

    this.ipcHandle(IpcChannel.Ai_AbortImage, async (_, request: AiImageAbortRequest) => {
      this.completionService.abort(request.requestId)
    })

    this.ipcHandle(IpcChannel.Ai_ListModels, async (_, request: AiBaseRequest) => {
      return this.completionService.listModels(request)
    })
  }

  /**
   * Execute an AI stream and push chunks to the target.
   *
   * Called by AiStreamManager, which provides an InternalStreamTarget (routes
   * chunks back to the manager for multicast) and an AbortSignal from the
   * manager's own AbortController.
   *
   * AiService does not manage stream lifecycle — it simply reads from the
   * AI SDK ReadableStream and writes chunks to the target until done or aborted.
   */
  async executeStream(target: StreamTarget, request: AiStreamRequest, signal: AbortSignal): Promise<void> {
    const requestId = request.chatId

    let finalMessagePromise: Promise<CherryUIMessage | undefined> | undefined
    try {
      const [forChunks, forAccum] = this.completionService.streamText(request, signal).tee()

      // Background: accumulate final UIMessage via AI SDK's readUIMessageStream
      finalMessagePromise = this.consumeLastUIMessage(forAccum)

      // Main path: forward chunks to target
      const reader = forChunks.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done || target.isDestroyed()) break
        target.send(IpcChannel.Ai_StreamChunk, { requestId, chunk: value })
      }

      // Set finalMessage before signaling done
      const finalMessage = await finalMessagePromise
      if (finalMessage) target.setFinalMessage?.(finalMessage)

      if (!target.isDestroyed()) {
        target.send(IpcChannel.Ai_StreamDone, { requestId })
      }
    } catch (error) {
      // Try to salvage partial message from the accumulator for persistence
      if (finalMessagePromise) {
        try {
          const partial = await finalMessagePromise
          if (partial) target.setFinalMessage?.(partial)
        } catch {
          // Accumulator also failed — no partial content to save
        }
      }

      if (signal.aborted) {
        logger.debug('Stream aborted', { requestId, reason: signal.reason })
      } else {
        logger.error('Stream error', { requestId, error })
      }
      if (!target.isDestroyed()) {
        target.send(IpcChannel.Ai_StreamError, {
          requestId,
          error: serializeError(error)
        })
      }
    }
  }

  /** Consume a UIMessageChunk stream via AI SDK's readUIMessageStream, return the final accumulated UIMessage. */
  private async consumeLastUIMessage(stream: ReadableStream): Promise<CherryUIMessage | undefined> {
    const uiStream = readUIMessageStream({ stream })
    const reader = uiStream.getReader()
    let last: CherryUIMessage | undefined
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      last = value as CherryUIMessage
    }
    return last
  }

  async generateText(request: AiGenerateRequest) {
    return this.completionService.generateText(request)
  }
}
