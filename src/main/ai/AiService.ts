import { embedMany as aiCoreEmbedMany, generateImage as aiCoreGenerateImage } from '@cherrystudio/ai-core'
import { assistantDataService } from '@data/services/AssistantService'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { messageService } from '@main/data/services/MessageService'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import { downloadImageAsBase64 } from '@main/services/agents/services/channels/ChannelAdapter'
import { toolApprovalRegistry } from '@main/services/agents/services/claudecode/ToolApprovalRegistry'
import { recordDecision as recordApprovalDecision } from '@main/services/toolApproval/observability'
import { saveRule } from '@main/services/toolApproval/rules'
import type { PermissionRule } from '@main/services/toolApproval/types'
import { type Assistant } from '@shared/data/types/assistant'
import { type Model, parseUniqueModelId } from '@shared/data/types/model'
import { IpcChannel } from '@shared/IpcChannel'
import { serializeError } from '@shared/types/error'
import { isEmbeddingModel } from '@shared/utils/model'
import {
  type EmbeddingModelUsage,
  getToolName,
  isToolUIPart,
  type LanguageModelUsage,
  type ModelMessage,
  type UIMessageChunk
} from 'ai'

import { Agent } from './agent/Agent'
import type { AgentLoopHooks } from './agent/loop'
import { mergeUsage, ZERO_USAGE } from './agent/observers/usage'
import { buildAgentParams } from './agent/params/buildAgentParams'
import type { RequestFeature } from './agent/params/feature'
import { resolveUIMessageFileUrls } from './messages/messageConverter'
import type { ClaudeCodeProviderSettings } from './provider/claude-code/types'
import { listModels as listModelsFromProvider } from './provider/listModels'
import { dispatchStreamRequest } from './stream-manager/context'
import { WebContentsListener } from './stream-manager/listeners/WebContentsListener'
import { registerBuiltinTools } from './tools/builtin'
import type { AppProviderSettingsMap } from './types'
import type { AiBaseRequest, AiStreamRequest, AiTransportOptions } from './types/requests'

const logger = loggerService.withContext('AiService')

/**
 * Best-effort recording of an approval/denial decision into the
 * observability ring buffer. Only records when we can derive a tool
 * name from the renderer-patched anchor parts; missing context is
 * logged at debug level and skipped — the rest of the IPC handler
 * proceeds normally regardless.
 */
async function recordDecisionForObservability(payload: {
  approved: boolean
  reason?: string
  topicId?: string
  anchorId?: string
  toolCallId?: string
}): Promise<void> {
  if (!payload.topicId || !payload.anchorId || !payload.toolCallId) {
    logger.debug('Skipping approval observability record — missing topic/anchor/toolCall id', {
      topicId: payload.topicId,
      anchorId: payload.anchorId,
      toolCallId: payload.toolCallId
    })
    return
  }

  try {
    const anchor = await messageService.getById(payload.anchorId)
    const part = (anchor.data.parts ?? []).find((p) => isToolUIPart(p) && p.toolCallId === payload.toolCallId)
    if (!part || !isToolUIPart(part)) {
      logger.debug('Skipping approval observability record — no matching tool part on anchor', {
        anchorId: payload.anchorId,
        toolCallId: payload.toolCallId
      })
      return
    }
    const toolName = getToolName(part)
    recordApprovalDecision(payload.topicId, {
      toolName,
      toolCallId: payload.toolCallId,
      decision: payload.approved ? 'approved' : 'denied',
      decidedAt: new Date().toISOString(),
      reason: payload.reason
    })
  } catch (err) {
    // Observability is best-effort — never let it crash the IPC handler.
    logger.warn('Failed to record approval observability entry', {
      err: err instanceof Error ? err.message : String(err),
      topicId: payload.topicId,
      anchorId: payload.anchorId,
      toolCallId: payload.toolCallId
    })
  }
}

// ── Request types ──────────────────────────────────────────────────

/**
 * In-process per-request transport config. Extends `AiTransportOptions`
 * with an `AbortSignal` — non-IPC-serialisable, injected by the in-process
 * caller (typically `AiStreamManager` or `AiService.checkModel`), never
 * by renderer payloads.
 *
 * `AiService.*` method signatures expect this full type; IPC entry points
 * narrow to `AiTransportOptions` at the handler boundary.
 */
export interface AiRequestOptions extends AiTransportOptions {
  /**
   * AbortSignal for the whole request (streaming or non-streaming).
   * **Not IPC-serialisable.** Set it only on in-process callers (e.g.
   * `AiStreamManager.runExecutionLoop`). Renderer payloads MUST use
   * `AiTransportOptions` (which omits this field) so Electron's
   * structured-clone doesn't throw when the payload crosses IPC.
   */
  signal?: AbortSignal
}

/**
 * Widen a request type so its `requestOptions` field accepts the full
 * in-process shape (`AiRequestOptions`, which adds `signal`). Use this on
 * `AiService.*` method signatures so in-process callers can attach a
 * `signal` without forcing a structural mismatch.
 */
export type AsInProcess<T extends AiBaseRequest> = Omit<T, 'requestOptions'> & {
  requestOptions?: AiRequestOptions
}

/** Non-streaming text generation request — pure transport data. */
export interface AiGenerateRequest extends AiBaseRequest {
  system?: string
  prompt?: string
  messages?: ModelMessage[]
}

// ── SDK extensions ─────────────────────────────────────────────────

/** Result of non-streaming text generation. */
export interface AiGenerateResult {
  text: string
  usage?: LanguageModelUsage
}

/** Image generation request. */
export interface AiImageRequest extends AiBaseRequest {
  prompt: string
  /** Input images for editing (base64 data URLs or URLs). If provided, uses edit mode. */
  inputImages?: string[]
  /** Mask for inpainting (only with inputImages). */
  mask?: string
  n?: number
  size?: string
  negativePrompt?: string
  seed?: number
  quality?: string
  numInferenceSteps?: number
  guidanceScale?: number
  promptEnhancement?: boolean
  /** TODO(renderer/aiCore-cleanup): wire personGeneration through to the underlying image runtime once the main image contract formally supports it end-to-end. */
  personGeneration?: string
}

export interface GeneratedImagePayload {
  kind: 'base64'
  data: string
  mediaType?: string
}

/** Image generation result. */
export interface AiImageResult {
  images: GeneratedImagePayload[]
}

/** Embedding request. */
export interface AiEmbedRequest extends AiBaseRequest {
  values: string[]
}

/** Embedding result. */
export interface AiEmbedResult {
  embeddings: number[][]
  usage?: EmbeddingModelUsage
}

// ── Service ────────────────────────────────────────────────────────

/**
 * Lifecycle-managed AI service.
 *
 * Two categories of work, sharing provider/model resolution + tool registry:
 *
 * - **Streaming**: `streamText(request)` — returns a raw
 *   `UIMessageChunk` stream that `AiStreamManager` drives through its
 *   execution loop (multicast, finalMessage accumulation, abort/pause
 *   semantics all live there).
 * - **Non-streaming** (IPC-facing): `generateText`, `generateImage`,
 *   `embedMany`, `listModels`, `checkModel`. Registered as IPC handlers
 *   directly; renderers call them via the `window.api.ai.*` bridge.
 *
 * This file consolidates what used to be `AiService` (IPC gateway) and
 * `AiCompletionService` (business logic). After the stream-manager refactor
 * the two classes were forwarding-only wrappers around each other, so they
 * are now a single service — business logic, IPC handlers, and request
 * tracking all live here.
 */
@Injectable('AiService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['PreferenceService', 'McpService'])
export class AiService extends BaseService {
  protected async onInit(): Promise<void> {
    registerBuiltinTools()
    this.registerIpcHandlers()
    logger.info('AiService initialized')
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.Ai_GenerateText, async (_, request: AiGenerateRequest) => {
      return this.generateText(request)
    })

    this.ipcHandle(IpcChannel.Ai_CheckModel, async (_, request: AiBaseRequest & { timeout?: number }) => {
      return this.checkModel(request)
    })

    this.ipcHandle(IpcChannel.Ai_EmbedMany, async (_, request: AiEmbedRequest) => {
      return this.embedMany(request)
    })

    // Image generation uses MessagePort instead of `ipcHandle` so the
    // renderer can drive abort without a main-side request registry. The
    // renderer-side helper (`preload/invokeWithAbort.ts`) creates a
    // MessageChannel per call and transfers `port2` here; we receive it as
    // `event.ports[0]`. Caller posts `'abort'`, we post one terminal
    // `result` / `error` and close. AC lifetime = handler invocation; no
    // shared state on the service.
    this.ipcOn(IpcChannel.Ai_GenerateImage, (event, payload: AiImageRequest) => {
      const port = event.ports[0]
      if (!port) {
        logger.error('Ai_GenerateImage received without a MessagePort — caller bypassed invokeWithAbort')
        return
      }

      const controller = new AbortController()
      port.on('message', (msg) => {
        if ((msg.data as { type?: string } | undefined)?.type === 'abort') controller.abort()
      })
      port.start()

      void (async () => {
        try {
          const result = await this.generateImage({
            ...payload,
            requestOptions: { ...payload.requestOptions, signal: controller.signal }
          })
          port.postMessage({ type: 'result', value: result })
        } catch (err) {
          port.postMessage({ type: 'error', error: serializeError(err) })
        } finally {
          port.close()
        }
      })()
    })

    this.ipcHandle(IpcChannel.Ai_ListModels, async (_, request: AiBaseRequest) => {
      return this.listModels(request)
    })

    this.ipcHandle(
      IpcChannel.Ai_ToolApproval_Respond,
      async (
        event,
        payload: {
          approvalId: string
          approved: boolean
          reason?: string
          updatedInput?: Record<string, unknown>
          topicId?: string
          anchorId?: string
          /** AI-SDK toolCallId — used to clear the per-call shared-cache suggestedRule entry. */
          toolCallId?: string
          persistRule?: PermissionRule
        }
      ): Promise<{ ok: boolean }> => {
        if (payload.persistRule) {
          try {
            await saveRule(payload.persistRule)
          } catch (err) {
            logger.error('Failed to persist tool-approval rule', err as Error)
          }
        }

        if (payload.toolCallId) {
          const cacheService = application.get('CacheService')
          cacheService.deleteShared(`tool_approval.suggested_rule.${payload.toolCallId}`)
        }

        // Observability hint for context-chef's `dynamicState` slot. The
        // model gets a system-message summary of recent decisions on the
        // next iteration so it doesn't have to infer "did approval just
        // come through?" from history scanning. Best-effort: requires
        // `topicId` + `toolCallId` + an anchor we can read to derive the
        // tool name; missing any one of these, we skip silently.
        await recordDecisionForObservability(payload)

        // 1. Claude-Agent path — registry still has the pending approval,
        // dispatching unblocks `canUseTool` so the in-flight stream resumes.
        const dispatched = toolApprovalRegistry.dispatch(payload.approvalId, {
          approved: payload.approved,
          reason: payload.reason,
          updatedInput: payload.updatedInput
        })
        if (dispatched) return { ok: true }

        // 2. MCP path — renderer has already PATCHed the anchor's parts via
        // DataApi (see useToolApprovalBridge). We just re-read from DB and,
        // if no `approval-requested` remains, dispatch the
        // continue-conversation stream.
        if (!payload.topicId || !payload.anchorId) {
          logger.warn('Tool-approval response had no live registry entry and no anchor context', {
            approvalId: payload.approvalId
          })
          return { ok: false }
        }

        const anchor = await messageService.getById(payload.anchorId)
        const parts = anchor.data.parts ?? []
        const stillPending = parts.some((p) => isToolUIPart(p) && p.state === 'approval-requested')
        if (stillPending) {
          return { ok: true }
        }

        const aiStreamManager = application.get('AiStreamManager')
        const subscriber = new WebContentsListener(event.sender, payload.topicId)
        await dispatchStreamRequest(aiStreamManager, subscriber, {
          trigger: 'continue-conversation',
          topicId: payload.topicId,
          parentAnchorId: payload.anchorId,
          approvalDecisions: []
        })
        return { ok: true }
      }
    )
  }

  // ── Streaming chat (agent.stream) ──

  /**
   * Start a streaming chat request and return the raw AI SDK UIMessageChunk
   * stream directly from `Agent.stream`. The caller (AiStreamManager) owns
   * the read loop, multicast, final-message accumulation, and terminal
   * dispatching.
   *
   * Errors split cleanly by phase:
   *  - pre-stream (resolving the assistant, building agent params) → the
   *    returned Promise rejects before any stream exists;
   *  - mid-stream (provider failure, tool error, abort) → the stream
   *    itself errors and the caller's reader.read() rejects.
   */
  async streamText(
    request: AsInProcess<AiStreamRequest>,
    extraFeatures: readonly RequestFeature[] = []
  ): Promise<ReadableStream<UIMessageChunk>> {
    logger.info('streamText started', { chatId: request.chatId })
    const signal = request.requestOptions?.signal
    if (!signal) {
      throw new Error('streamText requires requestOptions.signal — no AbortController was attached by the caller')
    }

    const { sdkConfig, tools, plugins, system, options, model, hookParts } = await this.buildAgentParamsFor(
      request,
      signal,
      extraFeatures
    )

    // Wire injectedMessageSource for Claude Code: PendingMessageQueue implements AsyncIterable<Message>
    if (request.pendingMessages && sdkConfig.providerId === 'claude-code') {
      const ccSettings = sdkConfig.providerSettings as ClaudeCodeProviderSettings
      ccSettings.defaultSettings = {
        ...ccSettings.defaultSettings,
        injectedMessageSource: request.pendingMessages
      }
    }

    // Inline any `file://` URLs in the UIMessages' file parts as base64
    // data URLs. AI SDK's `convertToModelMessages` doesn't fetch
    // `file://`, so the provider would otherwise see bogus links.
    const preparedMessages = await resolveUIMessageFileUrls(request.messages ?? [])

    const agent = new Agent({
      providerId: sdkConfig.providerId,
      providerSettings: sdkConfig.providerSettings,
      modelId: sdkConfig.modelId,
      messageId: request.messageId,
      plugins,
      tools,
      system,
      options,
      pendingMessages: request.pendingMessages,
      hookParts: [this.analyticsHookPart(model), ...hookParts],
      inject: (msg) => request.pendingMessages?.push(msg) ?? false
    })

    return agent.stream(preparedMessages, signal)
  }

  private analyticsHookPart(model: Model): Partial<AgentLoopHooks> {
    let total: LanguageModelUsage = ZERO_USAGE
    return {
      onStepFinish: (step) => {
        if (step.usage) total = mergeUsage(total, step.usage)
      },
      onFinish: () => this.trackUsage(model, total)
    }
  }

  // ── Non-streaming text generation (agent.generate) ──

  async generateText(
    request: AsInProcess<AiGenerateRequest>,
    extraFeatures: readonly RequestFeature[] = []
  ): Promise<AiGenerateResult> {
    logger.info('generateText started', { assistantId: request.assistantId })
    const signal = request.requestOptions?.signal

    const { sdkConfig, tools, plugins, system, options, model, hookParts } = await this.buildAgentParamsFor(
      request,
      signal,
      extraFeatures
    )

    const agent = new Agent({
      providerId: sdkConfig.providerId,
      providerSettings: sdkConfig.providerSettings,
      modelId: sdkConfig.modelId,
      plugins,
      tools,
      system: request.system ?? system,
      options,
      hookParts: [this.analyticsHookPart(model), ...hookParts]
    })

    return agent.generate(request.prompt ? { prompt: request.prompt } : { messages: request.messages ?? [] }, signal)
  }

  // ── Image generation ──

  async generateImage(request: AsInProcess<AiImageRequest>): Promise<AiImageResult> {
    logger.info('generateImage started', { assistantId: request.assistantId, uniqueModelId: request.uniqueModelId })
    const signal = request.requestOptions?.signal

    const { sdkConfig } = await this.buildAgentParamsFor(request, signal)

    const promptParam = request.inputImages
      ? { text: request.prompt, images: request.inputImages, ...(request.mask && { mask: request.mask }) }
      : request.prompt

    const imageParams = {
      model: sdkConfig.modelId,
      prompt: promptParam,
      n: request.n ?? 1,
      size: (request.size ?? '1024x1024') as `${number}x${number}`,
      ...(request.negativePrompt ? { negativePrompt: request.negativePrompt } : {}),
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
      ...(request.quality ? { quality: request.quality } : {}),
      ...(request.numInferenceSteps !== undefined ? { numInferenceSteps: request.numInferenceSteps } : {}),
      ...(request.guidanceScale !== undefined ? { guidanceScale: request.guidanceScale } : {}),
      ...(request.promptEnhancement !== undefined ? { promptEnhancement: request.promptEnhancement } : {}),
      ...(signal ? { abortSignal: signal } : {}),
      experimental_download: async (downloads) => {
        return Promise.all(
          downloads.map(async ({ url }) => {
            if (signal?.aborted) return null
            const downloaded = await downloadImageAsBase64(url.toString())
            if (signal?.aborted) return null
            if (!downloaded) return null
            return {
              data: Buffer.from(downloaded.data, 'base64'),
              mediaType: downloaded.media_type
            }
          })
        )
      }
    }

    const result = await aiCoreGenerateImage<AppProviderSettingsMap>(
      sdkConfig.providerId,
      sdkConfig.providerSettings,
      imageParams
    )

    const images: GeneratedImagePayload[] = []
    let filteredCount = 0
    for (const image of result.images ?? []) {
      if (image.base64) {
        images.push({
          kind: 'base64',
          data: `data:${image.mediaType || 'image/png'};base64,${image.base64}`,
          ...(image.mediaType ? { mediaType: image.mediaType } : {})
        })
        continue
      }

      filteredCount += 1
    }

    if (filteredCount > 0) {
      logger.warn('Filtered invalid generated images', {
        uniqueModelId: request.uniqueModelId,
        providerId: sdkConfig.providerId,
        modelId: sdkConfig.modelId,
        filteredCount
      })
    }

    return { images }
  }

  // ── Embedding ──

  async embedMany(request: AsInProcess<AiEmbedRequest>): Promise<AiEmbedResult> {
    logger.info('embedMany started', { assistantId: request.assistantId, count: request.values.length })
    const signal = request.requestOptions?.signal

    const { sdkConfig, model } = await this.buildAgentParamsFor(request, signal)

    const result = await aiCoreEmbedMany<AppProviderSettingsMap>(sdkConfig.providerId, sdkConfig.providerSettings, {
      model: sdkConfig.modelId,
      values: request.values,
      ...(signal ? { abortSignal: signal } : {})
    })

    this.trackUsage(model, { inputTokens: result.usage?.tokens ?? 0, outputTokens: 0 })
    return { embeddings: result.embeddings, usage: result.usage }
  }

  // ── Model listing ──

  async listModels(request: AiBaseRequest): Promise<Partial<Model>[]> {
    const { provider } = await this.getProviderAndModel(request)
    return listModelsFromProvider(provider)
  }

  // ── API validation ──

  /**
   * Validate that a provider/model pair is working by sending a minimal probe.
   *
   * Automatically dispatches to `embedMany` for embedding models and
   * `generateText` otherwise — renderers do not need to know anything about
   * model types to run a health check.
   */
  async checkModel(request: AiBaseRequest & { timeout?: number }): Promise<{ latency: number }> {
    const { model } = await this.getProviderAndModel(request)
    const start = performance.now()
    const timeout = request.timeout ?? 15000

    // Wire an AbortController through the probe so that when the timeout wins
    // the race, we also cancel the underlying HTTP work (otherwise tokens keep
    // burning server-side). Always clear the timer on both success and failure
    // paths so it cannot keep the event loop alive.
    const controller = new AbortController()
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        controller.abort(new Error('Check model timeout'))
        reject(new Error('Check model timeout'))
      }, timeout)
    })

    const probeRequest = {
      ...request,
      requestOptions: { ...request.requestOptions, signal: controller.signal }
    }
    const probe = isEmbeddingModel(model)
      ? this.embedMany({ ...probeRequest, values: ['test'] })
      : this.generateText({ ...probeRequest, system: 'test', prompt: 'hi' })

    try {
      await Promise.race([probe, timeoutPromise])
      return { latency: performance.now() - start }
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }
  }

  // ── Shared agent parameter resolution ──

  private async buildAgentParamsFor(
    request: AsInProcess<AiBaseRequest> & { chatId?: string },
    signal: AbortSignal | undefined,
    extraFeatures: readonly RequestFeature[] = []
  ) {
    const { provider, model, assistant } = await this.getProviderAndModel(request)
    const built = await buildAgentParams({ request, signal, provider, model, assistant, extraFeatures })
    return { ...built, provider, model, assistant }
  }

  // ── Token usage tracking ──

  private trackUsage(model: Model, usage?: { inputTokens?: number; outputTokens?: number }): void {
    if (!usage || !model.providerId || !model.apiModelId) return
    const inputTokens = usage.inputTokens ?? 0
    const outputTokens = usage.outputTokens ?? 0
    if (inputTokens === 0 && outputTokens === 0) return

    try {
      const analyticsService = application.get('AnalyticsService')
      analyticsService.trackTokenUsage({
        provider: model.providerId,
        model: model.apiModelId ?? model.id,
        input_tokens: inputTokens,
        output_tokens: outputTokens
      })
    } catch {
      // AnalyticsService may not be activated (data collection disabled)
    }
  }

  /**
   * Get provider + model for this request.
   * All from v2 DataApi (SQLite). Priority: explicit uniqueModelId > assistant.modelId
   */
  private async getProviderAndModel(request: AiBaseRequest & { chatId?: string }) {
    let assistant: Assistant | undefined
    if (request.assistantId) {
      assistant = await assistantDataService.getById(request.assistantId).catch(() => undefined)
    }

    // Parse UniqueModelId or fall back to assistant.modelId
    let providerId: string | undefined
    let modelId: string | undefined
    if (request.uniqueModelId) {
      const parsed = parseUniqueModelId(request.uniqueModelId)
      providerId = parsed.providerId
      modelId = parsed.modelId
    } else if (assistant?.modelId) {
      const parsed = parseUniqueModelId(assistant.modelId)
      providerId = parsed.providerId
      modelId = parsed.modelId
    }
    if (!providerId) throw new Error('Cannot resolve providerId: not in request and assistant has no model')
    if (!modelId) throw new Error('Cannot resolve modelId: not in request and assistant has no model')

    const provider = await providerService.getByProviderId(providerId)
    const model = await modelService.getByKey(providerId, modelId)

    return { provider, model, assistant }
  }
}
