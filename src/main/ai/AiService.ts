import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'
import { type SerializedError, serializeError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

import { AiCompletionService, type AiGenerateRequest, type AiStreamRequest } from './AiCompletionService'
import { ToolRegistry } from './tools/ToolRegistry'

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
    // Renderer-initiated stream request
    this.ipcHandle(IpcChannel.Ai_StreamRequest, async (event, request: AiStreamRequest) => {
      await this.executeStream(event.sender, request)
    })

    // Renderer-initiated abort (fire-and-forget)
    this.ipcOn(IpcChannel.Ai_Abort, (_, requestId: string) => {
      this.completionService.abort(requestId)
    })

    // Non-streaming text generation (topic naming, summaries, etc.)
    this.ipcHandle(IpcChannel.Ai_GenerateText, async (_, request: AiGenerateRequest) => {
      return this.completionService.generateText(request)
    })
  }

  /**
   * Execute an AI stream and push chunks to the target webContents.
   *
   * Used by both:
   * - User-initiated requests (Renderer invokes via IPC, this method is called from the handler)
   * - Server-push scenarios (Channel/Agent calls this method directly with a webContents reference)
   *
   * @param target - The Electron webContents to send chunks to.
   * @param request - The stream request payload.
   */
  async executeStream(target: Electron.WebContents, request: AiStreamRequest): Promise<void> {
    const { requestId } = request
    const abortController = new AbortController()
    this.completionService.registerRequest(requestId, abortController)

    try {
      const stream = this.completionService.streamText(request, abortController.signal)
      const reader = stream.getReader()

      while (true) {
        const { done, value } = await reader.read()
        if (done || target.isDestroyed()) break
        target.send(IpcChannel.Ai_StreamChunk, { requestId, chunk: value } satisfies AiStreamChunkPayload)
      }

      if (!target.isDestroyed()) {
        target.send(IpcChannel.Ai_StreamDone, { requestId } satisfies AiStreamDonePayload)
      }
    } catch (error) {
      logger.error('Stream error', { requestId, error })
      if (!target.isDestroyed()) {
        target.send(IpcChannel.Ai_StreamError, {
          requestId,
          error: serializeError(error)
        } satisfies AiStreamErrorPayload)
      }
    } finally {
      this.completionService.removeRequest(requestId)
    }
  }
}
