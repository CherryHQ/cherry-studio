import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'
import { type SerializedError, serializeError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

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

/** Options for executeStream when called by the Broker (Phase 2). */
export interface ExecuteStreamOptions {
  /** Broker-owned AbortSignal. When provided, executeStream does NOT create its own AbortController. */
  signal?: AbortSignal
}

const logger = loggerService.withContext('AiService')

/** IPC payload: Main → Renderer stream chunk. */
export interface AiStreamChunkPayload {
  /** Request identifier for chunk routing. */
  requestId: string
  /** A single UIMessageChunk from the AI stream. */
  chunk: UIMessageChunk
}

/** IPC payload: Main → Renderer stream completion signal. */
export interface AiStreamDonePayload {
  /** Request identifier indicating which stream has completed. */
  requestId: string
}

/** IPC payload: Main → Renderer stream error. */
export interface AiStreamErrorPayload {
  /** Request identifier indicating which stream errored. */
  requestId: string
  /** Structured error with name, message, stack, and optional i18n/provider context. */
  error: SerializedError
}

/**
 * Lifecycle-managed AI service.
 *
 * Bridges Renderer ↔ AiCompletionService via IPC:
 * - Renderer-initiated: `ipcRenderer.invoke(Ai_StreamRequest)` → stream chunks back via `webContents.send`
 * - Server-push (Channel/Agent): `executeStream(webContents, request)` called directly from Main
 *
 * Chunks are delivered as `Ai_StreamChunk` IPC events, with `Ai_StreamDone` / `Ai_StreamError`
 * signaling completion. The Renderer routes chunks by `requestId`.
 */
@Injectable('AiService')
@ServicePhase(Phase.WhenReady)
// TODO (Step 2): Add 'SearchService' when web search is integrated.
// KnowledgeService is a non-lifecycle singleton (direct import, no @DependsOn needed).
@DependsOn(['PreferenceService', 'MCPService'])
export class AiService extends BaseService {
  private toolRegistry = new ToolRegistry()
  private completionService = new AiCompletionService(this.toolRegistry)

  protected async onInit(): Promise<void> {
    this.registerIpcHandlers()
    logger.info('AiService initialized')
  }

  private registerIpcHandlers(): void {
    // Non-streaming text generation (topic naming, summaries, translate, etc.)
    this.ipcHandle(IpcChannel.Ai_GenerateText, async (_, request: AiGenerateRequest) => {
      return this.completionService.generateText(request)
    })

    // API validation (minimal request to check provider/model works)
    this.ipcHandle(IpcChannel.Ai_CheckModel, async (_, request: AiBaseRequest & { timeout?: number }) => {
      return this.completionService.checkModel(request)
    })

    // Embedding
    this.ipcHandle(IpcChannel.Ai_EmbedMany, async (_, request: AiEmbedRequest) => {
      return this.completionService.embedMany(request)
    })

    // Image generation
    this.ipcHandle(IpcChannel.Ai_GenerateImage, async (_, request: AiImageRequest) => {
      return this.completionService.generateImage(request)
    })

    // Model listing
    this.ipcHandle(IpcChannel.Ai_ListModels, async (_, request: AiBaseRequest) => {
      return this.completionService.listModels(request)
    })
  }

  /**
   * Execute an AI stream and push chunks to the target.
   *
   * Used by both:
   * - Legacy path: Renderer invokes Ai_StreamRequest IPC → handler passes `event.sender` (WebContents)
   * - Broker path: AiStreamManager passes a `BrokerStreamTarget` + `{ signal }` from the Broker's AbortController
   *
   * @param target - Any object with `send(channel, payload)` and `isDestroyed()`.
   *                 Real WebContents and BrokerStreamTarget both satisfy this.
   * @param request - The stream request payload.
   * @param options - When provided by the Broker, `signal` is the Broker-owned AbortSignal.
   *                  executeStream will NOT create its own AbortController in this case.
   */
  async executeStream(target: StreamTarget, request: AiStreamRequest, options?: ExecuteStreamOptions): Promise<void> {
    const { requestId } = request

    // If the Broker provides a signal, use it directly. Otherwise (legacy path)
    // create our own AbortController and register it for Ai_Abort IPC.
    const brokerOwned = !!options?.signal
    let signal: AbortSignal

    if (brokerOwned) {
      signal = options.signal!
    } else {
      const abortController = new AbortController()
      signal = abortController.signal
      this.completionService.registerRequest(requestId, abortController)
    }

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
    } finally {
      if (!brokerOwned) {
        this.completionService.removeRequest(requestId)
      }
    }
  }
}
