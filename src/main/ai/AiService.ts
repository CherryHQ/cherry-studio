import {
  embedMany as aiCoreEmbedMany,
  generateImage as aiCoreGenerateImage,
  rerank as aiCoreRerank
} from '@cherrystudio/ai-core'
import { assistantDataService } from '@data/services/AssistantService'
import type { PersonGeneration } from '@google/genai'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import type { JobHandle } from '@main/core/job/types'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { messageService } from '@main/data/services/MessageService'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import { type TranslateOpenRequest, translateService } from '@main/services/translate/translateService'
import { downloadImageAsBase64 } from '@main/utils/downloadAsBase64'
import type { AiToolApprovalRespondResponse } from '@shared/ai/transport'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'
import { type Assistant } from '@shared/data/types/assistant'
import type { FileEntry } from '@shared/data/types/file/fileEntry'
import { type Model, parseUniqueModelId } from '@shared/data/types/model'
import { IpcChannel } from '@shared/IpcChannel'
import type { Base64String, URLString } from '@shared/types/file/common'
import { isEmbeddingModel, isRerankModel } from '@shared/utils/model'
import {
  type EmbeddingModelUsage,
  isToolUIPart,
  type LanguageModelUsage,
  type ModelMessage,
  type UIMessageChunk
} from 'ai'
import * as z from 'zod'

import { isAgentSessionTopic } from './agentSession/topic'
import { resolveUIMessageFileUrls } from './messages/messageConverter'
import { resolveImageTransport } from './provider/custom/imageTransportRegistry'
import { deleteImageInputEntries, imageGenerationJobHandler } from './provider/custom/tasks/imageGenerationJobHandler'
import type { ImageGenerationJobOutput, ImageGenerationJobPayload } from './provider/custom/tasks/jobTypes'
import { listModels as listModelsFromProvider } from './provider/listModels'
import { Agent } from './runtime/aiSdk/Agent'
import type { AgentLoopHooks } from './runtime/aiSdk/loop'
import { mergeUsage, ZERO_USAGE } from './runtime/aiSdk/observers/usage'
import { buildAgentParams } from './runtime/aiSdk/params/buildAgentParams'
import type { RequestFeature } from './runtime/aiSdk/params/feature'
import { WebContentsListener } from './streamManager/listeners/WebContentsListener'
import { registerBuiltinTools } from './tools/adapters/aiSdk/builtin'
import type { AppProviderSettingsMap } from './types'
import type { AiBaseRequest, AiStreamRequest, AiTransportOptions, ListModelsRequest } from './types/requests'
import { buildImageProviderOptions, normalizeAspectRatio } from './utils/imageOptions'

const logger = loggerService.withContext('AiService')

// ── Request types ──────────────────────────────────────────────────

/** In-process variant of `AiTransportOptions` — adds `signal`, which is not IPC-serialisable. */
export interface AiRequestOptions extends AiTransportOptions {
  /** In-process only. Renderer payloads use `AiTransportOptions` (no signal). */
  signal?: AbortSignal
}

/** Widens `requestOptions` to accept the in-process shape on `AiService.*` method signatures. */
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
  personGeneration?: PersonGeneration
  aspectRatio?: string
  background?: string
  moderation?: string
  style?: string
  /** Vendor-specific image params keyed by provider id; mapped to AI SDK provider options in main. */
  providerOptions?: Record<string, Record<string, unknown>>
}

/** Image generation result — persisted file entries (main writes the bytes). */
export interface AiImageResult {
  files: FileEntry[]
}

/**
 * Map a painting input-image / mask string to FileManager create params. Preserves
 * the `AiImageRequest.inputImages` contract ("base64 data URLs or URLs") when routing
 * image edits through the job: `data:` strings become base64 entries, `http(s)` URLs
 * become downloaded url entries. Either way the handler later reads the bytes by id.
 */
export function imageInputEntryParams(
  value: string
): { source: 'base64'; data: Base64String } | { source: 'url'; url: URLString } {
  return value.startsWith('data:')
    ? { source: 'base64', data: value as Base64String }
    : { source: 'url', url: value as URLString }
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

/** Validates the `Ai_ToolApproval_Respond` IPC payload at the renderer boundary. */
const ToolApprovalRespondSchema = z.object({
  approvalId: z.string().min(1),
  approved: z.boolean(),
  reason: z.string().optional(),
  updatedInput: z.record(z.string(), z.unknown()).optional(),
  topicId: z.string().optional(),
  anchorId: z.string().optional()
})

export interface AiRerankRequest extends AiBaseRequest {
  query: string
  documents: string[]
  topN?: number
}

export interface AiRerankResult {
  ranking: Array<{
    originalIndex: number
    score: number
  }>
}

// ── Service ────────────────────────────────────────────────────────

/**
 * Lifecycle AI service. See `docs/references/ai/core-architecture.md`.
 *
 * DO NOT mirror `@DependsOn(['AiService'])` on AiStreamManager —
 * `runExecutionLoop` looks AiService up at runtime, and every `send()`
 * caller routes through AiService first.
 */
@Injectable('AiService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['McpRuntimeService', 'McpCatalogService', 'AiStreamManager', 'JobManager'])
export class AiService extends BaseService {
  // Per-request AbortControllers for `Ai_GenerateImage`, paired with the
  // `Ai_AbortImage` channel. Key is the renderer-generated requestId
  // (see `src/preload/index.ts`). Entries are self-cleaning via the
  // handler's `finally` block; abort on an unknown id is a no-op.
  // TODO(abort-registry): collapse with MCP/stream/LAN registries once
  // the shared `ipcHandleWithAbort` helper lands.
  private readonly imageRequests = new Map<string, AbortController>()

  protected async onInit(): Promise<void> {
    registerBuiltinTools()
    this.registerIpcHandlers()
    application.get('JobManager').registerHandler('image-generation.generate', imageGenerationJobHandler)
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

    this.ipcHandle(IpcChannel.Ai_GenerateImage, async (_, request: { requestId: string; payload: AiImageRequest }) => {
      const { requestId, payload } = request
      const controller = new AbortController()
      this.imageRequests.set(requestId, controller)
      try {
        return await this.generateImage({
          ...payload,
          requestOptions: { ...payload.requestOptions, signal: controller.signal }
        })
      } finally {
        this.imageRequests.delete(requestId)
      }
    })

    this.ipcOn(IpcChannel.Ai_AbortImage, (_, request: { requestId: string }) => {
      this.imageRequests.get(request.requestId)?.abort()
    })

    this.ipcHandle(IpcChannel.Ai_ListModels, async (_, request: ListModelsRequest) => {
      return this.listModels(request)
    })

    this.ipcHandle(IpcChannel.Ai_Translate_Open, async (event, request: TranslateOpenRequest) => {
      return translateService.open(event.sender, request)
    })

    this.ipcHandle(
      IpcChannel.Ai_ToolApproval_Respond,
      async (event, rawPayload: unknown): Promise<AiToolApprovalRespondResponse> => {
        // Validate the renderer payload at the IPC boundary before any registry dispatch or DB read.
        const parsed = ToolApprovalRespondSchema.safeParse(rawPayload)
        if (!parsed.success) {
          logger.warn('Tool-approval response rejected: invalid payload', { issues: parsed.error.issues })
          return { ok: false }
        }
        const payload = parsed.data

        // Claude-Agent fast-path: live registry entry unblocks `canUseTool`.
        const dispatched = application.get('AgentSessionRuntimeService').respondToolApproval(payload.approvalId, {
          approved: payload.approved,
          reason: payload.reason,
          updatedInput: payload.updatedInput
        })
        if (dispatched) return { ok: true }

        // MCP path: write decisions to DB, then dispatch continue-conversation when nothing is pending.
        if (!payload.topicId || !payload.anchorId) {
          logger.warn('Tool-approval response had no live registry entry and no anchor context', {
            approvalId: payload.approvalId
          })
          return { ok: false }
        }

        // The approval card is clickable the moment the `tool-approval-request` chunk arrives (the live
        // overlay), not only at terminal. So a response can land while a stream is still live on this
        // topic — a sibling exec in a multi-model turn, or another approved continuation already
        // running. The continue-conversation dispatch below would then hit send()'s inject path and
        // silently discard the approved turn (its models dropped, the tool never runs, the row stays
        // `pending`) while still returning a success-shaped response. This cheap pre-check refuses the
        // common case before mutating the row; the narrow TOCTOU that slips through (a submit starts a
        // turn between here and the dispatch) is closed under the dispatch lock by send() throwing,
        // caught below. The renderer surfaces the failure and resets the card; this backend slice does
        // not promise an automatic retry.
        if (application.get('AiStreamManager').hasLiveStream(payload.topicId)) {
          logger.warn(
            'Tool-approval response arrived while a stream is live — refusing to avoid a swallowed continuation',
            {
              approvalId: payload.approvalId,
              topicId: payload.topicId
            }
          )
          return { ok: false }
        }

        // Main is the single authority for the approval mutation: the
        // renderer no longer PATCHes (it sourced parts from a DB projection
        // that didn't carry the overlay-only `approval-requested` part and
        // raced/overwrote the persisted row). The decision is carried
        // explicitly in the IPC payload; apply it here to the DB-authoritative
        // parts (the original stream's terminal persistence wrote the
        // `approval-requested` part onto this row) and persist.
        const decision = {
          approvalId: payload.approvalId,
          approved: payload.approved,
          ...(payload.reason !== undefined && { reason: payload.reason }),
          ...(payload.updatedInput !== undefined && { updatedInput: payload.updatedInput })
        }
        // A stale click on a deleted message must resolve through the documented
        // result shape, not throw out of the handler (getById rejects when the
        // anchor is missing), consistent with the no-context branch above.
        // Serialize the parts mutation per anchor inside one write transaction: a multi-tool turn can
        // request several approvals on one row, and two concurrent responses must not read the same
        // stale parts and clobber each other's decision (or both compute a stale "still pending" and
        // neither resume). Returns the committed parts, or null when the anchor row is gone — a stale
        // click on a deleted message, resolved through the result shape instead of throwing.
        const approvalResult = await messageService.applyToolApprovalDecisions(payload.anchorId, [decision])
        if (approvalResult === null) {
          logger.warn('Tool-approval response anchor is missing or deleted', {
            approvalId: payload.approvalId,
            anchorId: payload.anchorId
          })
          return { ok: false }
        }
        const { parts: committedParts, appliedApprovalIds, alreadySettledApprovalIds } = approvalResult
        if (appliedApprovalIds.length === 0 && alreadySettledApprovalIds.includes(decision.approvalId)) {
          logger.warn('Ignoring duplicate tool-approval response for an already-settled approval', {
            approvalId: decision.approvalId,
            anchorId: payload.anchorId
          })
          return { ok: true }
        }

        // Only resume once every approval on this turn is decided — a turn can request several tools
        // at once; the not-yet-decided ones keep their cards. Reading the committed post-write parts
        // means concurrent responders agree on who fires the continuation.
        const anyStillPending = committedParts.some((p) => isToolUIPart(p) && p.state === 'approval-requested')
        if (anyStillPending) {
          return { ok: true }
        }

        const aiStreamManager = application.get('AiStreamManager')
        const subscriber = new WebContentsListener(event.sender, payload.topicId)
        try {
          await aiStreamManager.dispatch(subscriber, {
            trigger: 'continue-conversation',
            topicId: payload.topicId,
            parentAnchorId: payload.anchorId,
            // Idempotent against the conditional write above; safety net when the part wasn't on the row.
            approvalDecisions: [decision]
          })
        } catch (error) {
          // dispatch runs prepareDispatch+send under the per-topic dispatch lock. If a concurrent submit
          // started a live turn after the hasLiveStream pre-check above, send() refuses to inject-drop the
          // prepared continuation (throws) rather than swallowing it with a success shape. Resolve through
          // the result shape so the renderer can reset the card instead of leaving it stuck submitting.
          logger.warn('Tool-approval continuation dispatch failed (likely raced a live submit)', {
            approvalId: payload.approvalId,
            topicId: payload.topicId,
            error: error instanceof Error ? error.message : String(error)
          })
          return { ok: false }
        }
        return { ok: true }
      }
    )
  }

  // ── Streaming chat (agent.stream) ──

  /**
   * Raw `UIMessageChunk` stream from `Agent.stream`. Caller (usually
   * `AiStreamManager`) owns read/multicast/accumulation/terminal dispatch.
   * Pre-stream errors reject the Promise; mid-stream errors come through
   * the stream itself.
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

    if (request.runtime?.kind === 'agent-session') {
      return application.get('AgentSessionRuntimeService').openTurnStream({
        sessionId: request.runtime.sessionId,
        turnId: request.runtime.turnId,
        signal
      })
    }

    if (isAgentSessionTopic(request.chatId)) {
      throw new Error(`Agent session stream ${request.chatId} requires an agent-session runtime request`)
    }

    const { sdkConfig, tools, plugins, system, options, model, hookParts } = await this.buildAgentParamsFor(
      request,
      signal,
      extraFeatures
    )

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
      hookParts: [this.analyticsHookPart(model), ...hookParts]
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

    // prompt and messages are mutually exclusive in AI SDK; preserve that.
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

    // Map the canonical painting params onto each vendor's real image-API field
    // names (negative_prompt / seed / imageConfig / …). AI SDK image models
    // spread `providerOptions[<providerId>]` into the request body, so this is
    // how negativePrompt/seed/steps/guidance/aspectRatio actually reach vendors.
    const imageProviderOptions = buildImageProviderOptions(sdkConfig.providerId, {
      negativePrompt: request.negativePrompt,
      seed: request.seed !== undefined ? String(request.seed) : undefined,
      numInferenceSteps: request.numInferenceSteps,
      guidanceScale: request.guidanceScale,
      promptEnhancement: request.promptEnhancement,
      personGeneration: request.personGeneration,
      quality: request.quality,
      aspectRatio: request.aspectRatio,
      imageSize: request.size,
      providerOptions: request.providerOptions,
      background: request.background,
      moderation: request.moderation,
      style: request.style
    })
    // Async custom-provider transports (ppio / dashscope / modelscope /
    // dmxapi-bespoke) run the submit/poll loop on the job system so it survives
    // a restart (resumes the same remote task instead of re-submitting). Other
    // providers/models keep the in-SDK path below. The vendor params bag handed
    // to the transport is identical to what the SDK path forwards.
    if (
      request.uniqueModelId &&
      resolveImageTransport(sdkConfig.providerId, sdkConfig.modelId, sdkConfig.providerSettings)
    ) {
      return await this.generateImageViaJob(request, imageProviderOptions[sdkConfig.providerId] ?? {}, signal)
    }

    const aspectRatio = normalizeAspectRatio(request.aspectRatio)

    const imageParams = {
      model: sdkConfig.modelId,
      prompt: promptParam,
      n: request.n ?? 1,
      // Client-side default: when the caller omits `size`, fall back to 1024x1024
      // rather than letting the server pick its own default. Dropping this fallback
      // (to truly let the server choose) is a behavior decision, not done here.
      size: (request.size ?? '1024x1024') as `${number}x${number}`,
      ...(request.negativePrompt ? { negativePrompt: request.negativePrompt } : {}),
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
      ...(request.quality ? { quality: request.quality } : {}),
      ...(request.numInferenceSteps !== undefined ? { numInferenceSteps: request.numInferenceSteps } : {}),
      ...(request.guidanceScale !== undefined ? { guidanceScale: request.guidanceScale } : {}),
      ...(request.promptEnhancement !== undefined ? { promptEnhancement: request.promptEnhancement } : {}),
      ...(aspectRatio ? { aspectRatio: aspectRatio as `${number}:${number}` } : {}),
      ...(Object.keys(imageProviderOptions).length > 0 ? { providerOptions: imageProviderOptions } : {}),
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

    const dataUrls: Base64String[] = []
    let filteredCount = 0
    for (const image of result.images ?? []) {
      if (image.base64) {
        dataUrls.push(`data:${image.mediaType || 'image/png'};base64,${image.base64}`)
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
    const fileManager = application.get('FileManager')
    const files = await Promise.all(dataUrls.map((data) => fileManager.createInternalEntry({ source: 'base64', data })))

    return { files }
  }

  /**
   * Run an async custom-provider image generation through the job system. The
   * handler owns submit/poll/download/persist and survives a restart; here we
   * enqueue, bridge the existing IPC abort signal to job cancellation, and
   * await the terminal snapshot. Input images / mask are persisted as
   * FileEntries up front and referenced by id so the payload stays small.
   */
  private async generateImageViaJob(
    request: AsInProcess<AiImageRequest>,
    providerParams: Record<string, unknown>,
    signal: AbortSignal | undefined
  ): Promise<AiImageResult> {
    const uniqueModelId = request.uniqueModelId
    if (!uniqueModelId) throw new Error('generateImageViaJob requires a uniqueModelId')

    const fileManager = application.get('FileManager')
    const jobManager = application.get('JobManager')

    // Track every temp entry as it is created so a failure anywhere in setup
    // (a later input download, the mask create, or enqueue itself) cleans up the
    // entries already made — they aren't in any payload yet, so no handler would.
    const createdEntryIds: string[] = []
    const persistInputImage = async (value: string): Promise<string> => {
      const entry = await fileManager.createInternalEntry(imageInputEntryParams(value))
      createdEntryIds.push(entry.id)
      return entry.id
    }

    let handle: JobHandle
    try {
      // allSettled (not all) so every create resolves before we decide: a partial
      // failure still leaves `createdEntryIds` complete for the catch to clean up.
      const settled = await Promise.allSettled((request.inputImages ?? []).map(persistInputImage))
      const rejected = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (rejected) throw rejected.reason
      const inputFileIds = settled.length ? settled.map((r) => (r as PromiseFulfilledResult<string>).value) : undefined
      const maskFileId = request.mask ? await persistInputImage(request.mask) : undefined

      const payload: ImageGenerationJobPayload = {
        uniqueModelId,
        prompt: request.prompt,
        n: request.n ?? 1,
        size: request.size ?? '1024x1024',
        seed: request.seed,
        ...(inputFileIds && { inputFileIds }),
        ...(maskFileId && { maskFileId }),
        providerParams
      }
      handle = await jobManager.enqueue('image-generation.generate', payload)
    } catch (error) {
      // Setup failed before the job owns the payload — clean up what we created.
      await deleteImageInputEntries(createdEntryIds)
      throw error
    }

    // Reuse the existing IPC AbortController (Ai_AbortImage): when it fires,
    // cancel the job (which aborts the handler + remote task).
    const onAbort = () => void jobManager.cancel(handle.id, 'aborted by user').catch(() => {})
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })

    let snapshot: JobSnapshot
    try {
      snapshot = await handle.finished
    } finally {
      signal?.removeEventListener('abort', onAbort)
      // Backstop cleanup (the handler is the primary owner once it runs); also
      // covers the in-process case where the job is cancelled while still pending.
      await deleteImageInputEntries(createdEntryIds)
    }

    if (snapshot.status === 'completed') {
      const output = snapshot.output as ImageGenerationJobOutput | null
      return { files: output?.files ?? [] }
    }
    if (snapshot.status === 'cancelled') {
      throw new DOMException('Image generation aborted', 'AbortError')
    }
    throw new Error(snapshot.error?.message ?? 'Image generation failed')
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

  // ── Reranking ──

  async rerank(request: AsInProcess<AiRerankRequest>): Promise<AiRerankResult> {
    logger.info('rerank started', { assistantId: request.assistantId, count: request.documents.length })
    const signal = request.requestOptions?.signal

    const { sdkConfig, options = {} } = await this.buildAgentParamsFor(request, signal)
    const headers = options.headers
      ? (Object.fromEntries(Object.entries(options.headers).filter(([, value]) => value !== undefined)) as Record<
          string,
          string
        >)
      : undefined

    const rerankParams = {
      model: sdkConfig.modelId,
      query: request.query,
      documents: request.documents,
      ...(request.topN !== undefined ? { topN: request.topN } : {}),
      ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
      ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
      ...(signal ? { abortSignal: signal } : {})
    }

    const result = await aiCoreRerank<AppProviderSettingsMap>(
      sdkConfig.providerId,
      sdkConfig.providerSettings,
      rerankParams
    )

    return {
      ranking: result.ranking.map((item) => ({
        originalIndex: item.originalIndex,
        score: item.score
      }))
    }
  }

  // ── Model listing ──
  async listModels(request: ListModelsRequest): Promise<Partial<Model>[]> {
    let providerId = request.providerId
    if (!providerId && request.assistantId) {
      const assistant = await assistantDataService.getById(request.assistantId).catch(() => undefined)
      if (assistant?.modelId) {
        providerId = parseUniqueModelId(assistant.modelId).providerId
      }
    }
    if (!providerId) {
      throw new Error('Cannot resolve providerId: not in request and assistant has no model')
    }
    const provider = await providerService.getByProviderId(providerId)
    return listModelsFromProvider(provider, undefined, { throwOnError: request.throwOnError })
  }

  // ── API validation ──

  /** Dispatches to `rerank` / `embedMany` for those model types, `generateText` otherwise. */
  async checkModel(request: AiBaseRequest & { timeout?: number }): Promise<{ latency: number }> {
    const { model } = await this.getProviderAndModel(request)
    const start = performance.now()
    const timeout = request.timeout ?? 15000

    // AbortController on timeout so the HTTP work cancels too (otherwise tokens keep burning).
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
    let probe: Promise<unknown>
    if (isRerankModel(model)) {
      probe = this.rerank({ ...probeRequest, query: 'test', documents: ['test'], topN: 1 }).then((result) => {
        if (result.ranking.length === 0) {
          throw new Error('Rerank health check returned empty ranking')
        }
        return result
      })
    } else if (isEmbeddingModel(model)) {
      probe = this.embedMany({ ...probeRequest, values: ['test'] })
    } else {
      probe = this.generateText({ ...probeRequest, system: 'test', prompt: 'hi' })
    }

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

  /** Priority: explicit `uniqueModelId` > `assistant.modelId`. */
  private async getProviderAndModel(request: AiBaseRequest & { chatId?: string }) {
    let assistant: Assistant | undefined
    if (request.assistantId) {
      assistant = await assistantDataService.getById(request.assistantId).catch(() => undefined)
    }

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
