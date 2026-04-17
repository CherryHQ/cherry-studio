import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'
import type { UIMessageChunk } from 'ai'

import {
  type AiBaseRequest,
  AiCompletionService,
  type AiEmbedRequest,
  type AiGenerateRequest,
  type AiImageAbortRequest,
  type AiImageGenerateRequest,
  type AiStreamRequest
} from './AiCompletionService'
import { ToolRegistry } from './tools/ToolRegistry'

const logger = loggerService.withContext('AiService')

/**
 * Lifecycle-managed AI service.
 *
 * Provides two categories of functionality:
 * - **Streaming**: `streamText(request, signal)` — called by AiStreamManager,
 *   which handles chunk pumping, multicast, persistence, and lifecycle
 * - **Non-streaming**: generateText, checkModel, embedMany, generateImage, listModels —
 *   registered as IPC handlers directly
 *
 * `AiService` no longer participates in the stream transport chain. It is a
 * thin lifecycle wrapper around `AiCompletionService`; chunk forwarding,
 * final-message accumulation, and abort/pause semantics live in AiStreamManager.
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
   * Start a streaming chat request and return the raw AI SDK UIMessageChunk
   * stream. The caller (AiStreamManager) owns the read loop, multicast,
   * final-message accumulation, and terminal dispatching.
   */
  streamText(request: AiStreamRequest, signal: AbortSignal): ReadableStream<UIMessageChunk> {
    return this.completionService.streamText(request, signal)
  }

  async generateText(request: AiGenerateRequest) {
    return this.completionService.generateText(request)
  }
}
