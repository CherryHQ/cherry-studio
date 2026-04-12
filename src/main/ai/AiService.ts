import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'
import { serializeError } from '@shared/types/error'

import {
  type AiBaseRequest,
  AiCompletionService,
  type AiEmbedRequest,
  type AiGenerateRequest,
  type AiImageRequest,
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

    this.ipcHandle(IpcChannel.Ai_GenerateImage, async (_, request: AiImageRequest) => {
      return this.completionService.generateImage(request)
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
    const { requestId } = request

    try {
      const stream = this.completionService.streamText(request, signal)
      const reader = stream.getReader()

      while (true) {
        const { done, value } = await reader.read()
        if (done || target.isDestroyed()) break
        target.send(IpcChannel.Ai_StreamChunk, { requestId, chunk: value })
      }

      if (!target.isDestroyed()) {
        target.send(IpcChannel.Ai_StreamDone, { requestId })
      }
    } catch (error) {
      logger.error('Stream error', { requestId, error })
      if (!target.isDestroyed()) {
        target.send(IpcChannel.Ai_StreamError, {
          requestId,
          error: serializeError(error)
        })
      }
    }
  }
}
