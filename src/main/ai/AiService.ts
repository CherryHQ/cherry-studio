import { application } from '@application'
import {
  embedMany as aiCoreEmbedMany,
  generateImage as aiCoreGenerateImage,
  rerank as aiCoreRerank
} from '@cherrystudio/ai-core'
import type { ParamValues } from '@cherrystudio/provider-registry'
import { type InsertJobFileRefRow, jobFileRefTable } from '@data/db/schemas/fileRelations'
import { assistantDataService } from '@data/services/AssistantService'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { loggerService } from '@logger'
import type { JobHandle } from '@main/core/job/types'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { messageService } from '@main/data/services/MessageService'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import { installBuiltinSkills } from '@main/utils/builtinSkills'
import { downloadImageAsBase64 } from '@main/utils/downloadAsBase64'
import type { AiToolApprovalRespondRequest, AiToolApprovalRespondResponse } from '@shared/ai/transport'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'
import { type Assistant } from '@shared/data/types/assistant'
import type { CleanupPolicy, FileEntry } from '@shared/data/types/file'
import type { ImageGenerationMode } from '@shared/data/types/model'
import { type Model, parseUniqueModelId } from '@shared/data/types/model'
import type { Base64String, CreateInternalEntryIpcParams, UrlString } from '@shared/types/file'
import { isEmbeddingModel, isFunctionCallingModel, isRerankModel } from '@shared/utils/model'
import {
  type EmbeddingModelUsage,
  isToolUIPart,
  type LanguageModelUsage,
  type ModelMessage,
  type UIMessageChunk
} from 'ai'

import { isAgentSessionTopic } from './agentSession/topic'
import { prepareChatMessages } from './messages/attachmentRouting'
import { resolveMediaCapabilities } from './messages/messageCapabilities'
import { resolveImageTransport } from './provider/custom/imageTransportRegistry'
import { deleteImageInputEntries, imageGenerationJobHandler } from './provider/custom/tasks/imageGenerationJobHandler'
import type { ImageGenerationJobOutput, ImageGenerationJobPayload } from './provider/custom/tasks/jobTypes'
import { buildVendorProviderOptions } from './provider/custom/wire/buildImageRequest'
import { DEFAULT_DIFFUSION_REGISTRATION, WIRE_REGISTRY } from './provider/custom/wire/wireProfile'
import { listModels as listModelsFromProvider } from './provider/listModels'
import type { AgentLoopHooks, RequestFeature } from './runtime/aiSdk'
import { Agent, buildAgentParams, mergeUsage, ZERO_USAGE } from './runtime/aiSdk'
import { skillService } from './skills/SkillService'
import { WebContentsListener } from './streamManager'
import { registerBuiltinTools } from './tools/adapters/aiSdk/builtin/registerBuiltinTools'
import type {
  AiBaseRequest,
  AiStreamRequest,
  AiTransportOptions,
  AppProviderSettingsMap,
  ListModelsRequest
} from './types'
import { installProviderUserAgentInterceptor } from './utils/customFetch'
import { type SplitImageParams, splitParamValues } from './utils/imageOptions'

const logger = loggerService.withContext('AiService')

// ── Model listing ──────────────────────────────────────────────────

/**
 * Bare model id used to dedup a live API list against the registry catalog: the
 * upstream `/models` strips the publisher prefix (`deepseek-v3.1-maas`) while the
 * registry keeps it (`deepseek-ai/deepseek-v3.1-maas`), so both collapse to the
 * last path segment, lowercased.
 * ponytail: last-segment + lowercase covers the known convention gap (publisher
 * prefix); widen (e.g. `.`→`-`) only if a real collision surfaces.
 */
function bareModelKey(apiModelId: string | undefined): string {
  const id = apiModelId ?? ''
  const afterSlash = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id
  return afterSlash.toLowerCase()
}

/**
 * Union a provider's live API models with its registry catalog. Live models win;
 * registry models the API never returns are appended — vendor-exclusive entries
 * the upstream `/models` doesn't list (ppio's Z-Image/Jimeng image models,
 * Claude-on-Vertex). Enrichment-type overrides collapse onto their live twin via
 * `bareModelKey`, so only genuinely-missing models are added.
 */
export function mergeProviderModelsWithRegistry(remote: Partial<Model>[], registry: Model[]): Partial<Model>[] {
  const seen = new Set(remote.map((m) => bareModelKey(m.apiModelId)))
  const missing = registry.filter((m) => !seen.has(bareModelKey(m.apiModelId)))
  return missing.length > 0 ? [...remote, ...missing] : remote
}

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
  /** Image-generation mode (which tab). main derives per-model transport routing
   *  (`vendorTransport` → descriptor) from the registry using this. */
  mode?: ImageGenerationMode
  /**
   * Canonical param bag — already a strict, coerced `ParamValues` (the
   * `ai.generate_image` IPC validated it via the catalog `imageParamsSchema`).
   * main derives the structured request fields + the vendor bag from it via
   * `splitParamValues`.
   */
  paramValues: ParamValues
  /**
   * Cleanup policy stamped on every FileEntry this request persists (input
   * images, mask, generated outputs). AiService is infrastructure — the
   * calling business feature decides the policy (file-entry-cleanup.md §4.1).
   */
  cleanupPolicy: CleanupPolicy
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
export function imageInputEntryParams(value: string, cleanupPolicy: CleanupPolicy): CreateInternalEntryIpcParams {
  return value.startsWith('data:')
    ? { source: 'base64', data: value as Base64String, cleanupPolicy }
    : { source: 'url', url: value as UrlString, cleanupPolicy }
}

/**
 * Resolve the wire `size`. `'auto'` is the painting UI sentinel for "let the
 * server pick the size", so it's omitted. An absent size is also omitted — the
 * provider/server applies its own default. (A blanket client-forced
 * `1024x1024` was wrong for vendors like Doubao that only accept `1K`/`2K`/`4K`
 * and reject a pixel size; models that want a concrete default declare it on
 * their registry `size` param instead.)
 */
function resolveImageRequestSize(size: string | undefined): string | undefined {
  return size === 'auto' ? undefined : size
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
  // Per-request AbortControllers for the `ai.generate_image` route, paired with the
  // `ai.abort_image` route. Key is the renderer-generated requestId. Entries are
  // self-cleaning via `runImageRequest`'s `finally` block; abort on an unknown id is
  // a no-op.
  // TODO(abort-registry): collapse with MCP/stream/LAN registries once
  // the shared `ipcHandleWithAbort` helper lands.
  private readonly imageRequests = new Map<string, AbortController>()

  protected async onInit(): Promise<void> {
    registerBuiltinTools()
    // Restore provider custom `User-Agent` headers that Chromium's net.fetch stack
    // would otherwise overwrite (see installProviderUserAgentInterceptor).
    this.registerDisposable(installProviderUserAgentInterceptor())
    application.get('JobManager').registerHandler('image-generation.generate', imageGenerationJobHandler)
    // Install built-in skills, then heal the CLAUDE_CONFIG_DIR/skills mirror once at
    // startup — chained (not two independent fire-and-forgets) so the mirror reconcile
    // always runs after builtin skills have synced to agent_global_skill this boot,
    // regardless of whether the install succeeded. Fire-and-forget as a pair so
    // neither blocks init.
    void installBuiltinSkills()
      .catch((error) => {
        logger.error('Failed to install built-in skills', error as Error)
      })
      .then(() =>
        skillService.reconcileSkills().catch((error) => {
          logger.error('Failed to reconcile skills', error)
        })
      )
    logger.info('AiService initialized')
  }

  /**
   * Apply a tool-approval decision (`ai.respond_tool_approval`). Input validation happens in the
   * IpcApi router; `senderWc` is the caller window's WebContents (the MCP continuation streams to
   * it), resolved by the handler from `ctx.senderId` — `undefined` when no managed window, in which
   * case the continuation can't be surfaced and we resolve `{ ok: false }`.
   */
  async respondToolApproval(
    payload: AiToolApprovalRespondRequest,
    senderWc: Electron.WebContents | undefined
  ): Promise<AiToolApprovalRespondResponse> {
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
    const approvalResult = messageService.applyToolApprovalDecisions(payload.anchorId, [decision])
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

    // The continuation needs a renderer to stream to; without the caller window there's nothing to
    // surface it on, so resolve through the result shape instead of dispatching into the void.
    if (!senderWc) {
      logger.warn('Tool-approval continuation skipped: no caller window', { approvalId: payload.approvalId })
      return { ok: false }
    }

    const aiStreamManager = application.get('AiStreamManager')
    const subscriber = new WebContentsListener(senderWc, payload.topicId)
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

    const { sdkConfig, tools, plugins, system, options, model, hookParts, nativeFileSupport, fileAttachments } =
      await this.buildAgentParamsFor(request, signal, extraFeatures)

    // Route attachments: native files stay inline, non-native become capped text
    // (always visible — never gated on the model calling read_file).
    const preparedMessages = await prepareChatMessages(request.messages ?? [], {
      attachments: fileAttachments,
      nativeSupport: nativeFileSupport,
      isToolCapable: isFunctionCallingModel(model),
      signal
    })

    const agent = new Agent({
      providerId: sdkConfig.providerId,
      providerSettings: sdkConfig.providerSettings,
      modelId: sdkConfig.modelId,
      messageId: request.messageId,
      plugins,
      tools,
      system,
      options,
      hookParts: [this.analyticsHookPart(model), ...hookParts],
      mediaCapabilities: resolveMediaCapabilities(model)
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

  /**
   * Run an image request under an abort registry entry keyed by the renderer-supplied
   * `requestId`, so `ai.abort_image` can cancel it. Self-cleaning via `finally`; the
   * `ai.generate_image` handler delegates here (the registry is service state).
   */
  async runImageRequest(requestId: string, payload: AiImageRequest): Promise<AiImageResult> {
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
  }

  /** Abort the in-flight image request for `requestId`; a no-op on an unknown id. */
  abortImage(requestId: string): void {
    this.imageRequests.get(requestId)?.abort()
  }

  async generateImage(request: AsInProcess<AiImageRequest>): Promise<AiImageResult> {
    logger.info('generateImage started', { assistantId: request.assistantId, uniqueModelId: request.uniqueModelId })
    const signal = request.requestOptions?.signal

    const { sdkConfig } = await this.buildAgentParamsFor(request, signal)

    const promptParam = request.inputImages
      ? { text: request.prompt, images: request.inputImages, ...(request.mask && { mask: request.mask }) }
      : request.prompt

    // `request.paramValues` is already a strict, coerced `ParamValues` — the
    // `ai.generate_image` IPC validated it via the catalog `imageParamsSchema` at
    // the boundary (no main-side re-parse / cast). Split it into the structured
    // fields the AI SDK call consumes (n/size/seed/aspectRatio → imageParams
    // below) vs the leftover vendor bag (cfg, the diffusion/openai knobs, …) the
    // WireProfile engine forwards.
    const params = request.paramValues
    const { structured, vendorBag } = splitParamValues(params)

    // Vendor body (`providerOptions[providerId]`): the WireProfile engine maps the
    // canonical bag to each provider's wire — a registered profile for the
    // OpenAI / google / dashscope / aihubmix / dmxapi families, else the diffusion
    // catch-all (DEFAULT_DIFFUSION_REGISTRATION).
    const registration = WIRE_REGISTRY[sdkConfig.providerId] ?? DEFAULT_DIFFUSION_REGISTRATION
    const imageProviderOptions = buildVendorProviderOptions(sdkConfig.providerId, params, registration, vendorBag)
    // Async custom-provider transports (ppio / dashscope / modelscope /
    // dmxapi-bespoke) run the submit/poll loop on the job system so it survives
    // a restart. Unlike the in-SDK path (whose `providerOptions[id]` IS the wire
    // body), a transport builds its own request envelope per model, so it receives
    // the canonical camelCase `vendorBag` directly (native n/size/seed travel via
    // the job payload → `input.*`). No wire-naming, no casing probes.
    if (
      request.uniqueModelId &&
      resolveImageTransport(sdkConfig.providerId, sdkConfig.modelId, sdkConfig.providerSettings)
    ) {
      return await this.generateImageViaJob(request, structured, vendorBag, signal)
    }

    // `structured.aspectRatio` is already normalized to `X:Y` by the aspectRatio
    // native binding's `map` (in `splitParamValues`).
    const requestSize = resolveImageRequestSize(structured.size)

    // Only the genuine AI SDK `ImageModelV3CallOptions` image params (n/size/seed/
    // aspectRatio). The vendor knobs (negativePrompt/quality/numInferenceSteps/…)
    // are NOT typed SDK options — they reach the wire via `providerOptions[id]`
    // (the WireProfile engine), which the image models read; passing them here is
    // dropped by `generateImage`, so they're omitted.
    const imageParams = {
      model: sdkConfig.modelId,
      prompt: promptParam,
      n: structured.n ?? 1,
      ...(requestSize !== undefined && { size: requestSize as `${number}x${number}` }),
      ...(structured.seed !== undefined ? { seed: structured.seed } : {}),
      ...(structured.aspectRatio ? { aspectRatio: structured.aspectRatio as `${number}:${number}` } : {}),
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
    const files = await Promise.all(
      dataUrls.map((data) =>
        fileManager.createInternalEntry({ source: 'base64', data, cleanupPolicy: request.cleanupPolicy })
      )
    )

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
    structured: SplitImageParams['structured'],
    providerParams: Record<string, unknown>,
    signal: AbortSignal | undefined
  ): Promise<AiImageResult> {
    const uniqueModelId = request.uniqueModelId
    if (!uniqueModelId) throw new Error('generateImageViaJob requires a uniqueModelId')

    const fileManager = application.get('FileManager')
    const jobManager = application.get('JobManager')

    const createdEntryIds: string[] = []
    const persistInputImage = async (value: string): Promise<string> => {
      const entry = await fileManager.createInternalEntry(imageInputEntryParams(value, request.cleanupPolicy))
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
      const requestSize = resolveImageRequestSize(structured.size)

      // Per-model transport routing, derived from the registry (main hosts it) —
      // NOT laundered through paramValues. Persisted in the payload so a restart-
      // resume reaches the right endpoint / response family.
      const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
      const mode = request.mode ?? 'generate'
      const support = providerRegistryService.getImageGenerationSupport(providerId, modelId)
      const vendorTransport = support?.modes?.[mode]?.vendorTransport
      const modelDescriptor = vendorTransport?.endpoint
        ? { id: modelId, endpoint: vendorTransport.endpoint, isSync: vendorTransport.isSync, mode }
        : undefined

      const payload: ImageGenerationJobPayload = {
        uniqueModelId,
        prompt: request.prompt,
        n: structured.n ?? 1,
        ...(requestSize !== undefined && { size: requestSize }),
        seed: structured.seed,
        ...(inputFileIds && { inputFileIds }),
        ...(maskFileId && { maskFileId }),
        ...(modelDescriptor && { modelDescriptor }),
        providerParams,
        cleanupPolicy: request.cleanupPolicy
      }
      handle = jobManager.enqueue('image-generation.generate', payload)

      // Persist a job→file ref for every input the job reads. The ids also live
      // in `job.input` JSON, but the cleanup anti-join cannot see JSON — without a
      // real ref row, a non-terminal job whose `delete_when_unreferenced` inputs
      // aged past the grace window could have them reclaimed before startup
      // recovery resumes it (file-entry-cleanup.md §5.1). The job row exists now
      // (enqueue committed it), so the FK is satisfied; deleting the job row later
      // cascades these refs, releasing the inputs for reclaim.
      const jobFileRefRows: InsertJobFileRefRow[] = [
        ...(inputFileIds ?? []).map((fileEntryId) => ({ fileEntryId, sourceId: handle.id, role: 'input' as const })),
        ...(maskFileId ? [{ fileEntryId: maskFileId, sourceId: handle.id, role: 'mask' as const }] : [])
      ]
      if (jobFileRefRows.length > 0) {
        application.get('DbService').getDb().insert(jobFileRefTable).values(jobFileRefRows).run()
      }
    } catch (error) {
      // Setup failed before the job owns the payload — clean up what we created.
      await deleteImageInputEntries(createdEntryIds)
      throw error
    }

    // Reuse the existing IPC AbortController (ai.abort_image): when it fires,
    // cancel the job (which aborts the handler + remote task).
    const onAbort = () => void jobManager.cancel(handle.id, 'aborted by user').catch(() => {})
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })

    let snapshot: JobSnapshot
    try {
      snapshot = await handle.finished
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }

    if (snapshot.status === 'completed') {
      const output = snapshot.output as ImageGenerationJobOutput | null
      return { files: output?.files ?? [] }
    }
    if (snapshot.status === 'cancelled') {
      throw new DOMException('Image generation aborted', 'AbortError')
    }
    // `||` not `??`: a job can fail with an empty-string error message (a vendor that
    // returns a non-OK response with no body), which would otherwise surface as a
    // message-less `Error` the renderer can't show.
    throw new Error(snapshot.error?.message || 'Image generation failed')
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
      let assistant: Assistant | undefined
      try {
        assistant = assistantDataService.getById(request.assistantId)
      } catch {
        assistant = undefined
      }
      if (assistant?.modelId) {
        providerId = parseUniqueModelId(assistant.modelId).providerId
      }
    }
    if (!providerId) {
      throw new Error('Cannot resolve providerId: not in request and assistant has no model')
    }
    const provider = providerService.getByProviderId(providerId)
    // Registry-sourced providers (login-based, no API model list) return their
    // shipped catalog instead of calling the upstream API. The rest of the pull
    // flow (enrich → reconcile → enable) is unchanged.
    if (provider.modelListSource === 'registry') {
      return providerRegistryService.listProviderRegistryModels({ providerId })
    }
    // Union the live API list with the registry catalog so vendor-exclusive models
    // the upstream `/models` never returns (ppio image models, Claude-on-Vertex)
    // still surface for the user to enable.
    const remoteModels = await listModelsFromProvider(provider, undefined, { throwOnError: request.throwOnError })
    const registryModels = providerRegistryService.listProviderRegistryModels({ providerId })
    return mergeProviderModelsWithRegistry(remoteModels, registryModels)
  }

  // ── API validation ──

  /** Dispatches to `rerank` / `embedMany` for those model types, `generateText` otherwise. */
  async checkModel(request: AiBaseRequest & { timeout?: number }): Promise<{ latency: number }> {
    const { model } = this.getProviderAndModel(request)
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
    const { provider, model, assistant } = this.getProviderAndModel(request)
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
  private getProviderAndModel(request: AiBaseRequest & { chatId?: string }) {
    let assistant: Assistant | undefined
    if (request.assistantId) {
      try {
        assistant = assistantDataService.getById(request.assistantId)
      } catch {
        assistant = undefined
      }
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

    const provider = providerService.getByProviderId(providerId)
    const model = modelService.getByKey(providerId, modelId)

    return { provider, model, assistant }
  }
}
