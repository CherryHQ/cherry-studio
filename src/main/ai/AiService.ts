import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import type { CreateMessageRequestParamsBase, CreateMessageResult } from '@modelcontextprotocol/client'
import {
  type EmbeddingModelUsage,
  type FinishReason,
  isToolUIPart,
  type LanguageModelUsage,
  type ModelMessage,
  type UIMessageChunk
} from 'ai'

import { application } from '@application'
import { type AiPlugin, embedMany as aiCoreEmbedMany, rerank as aiCoreRerank } from '@cherrystudio/ai-core'
import type { TokenUsageSource } from '@cherrystudio/analytics-client'
import type { ImageOperation } from '@cherrystudio/provider-registry'
import { endpointImpliedCapability, type ParamValues } from '@cherrystudio/provider-registry'
import type { SourceSnapshot } from '@data/services/AiUsageRecordService'
import { assistantDataService } from '@data/services/AssistantService'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { messageService } from '@main/data/services/MessageService'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import { installBuiltinSkills } from '@main/utils/builtinSkills'
import type { CompactionSink } from '@shared/ai/compaction'
import type { AiToolApprovalRespondRequest, AiToolApprovalRespondResponse } from '@shared/ai/transport'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import { type Assistant } from '@shared/data/types/assistant'
import type { CleanupPolicy, FileEntry } from '@shared/data/types/file'
import type { ListedModels } from '@shared/data/types/model'
import { type Model, type UniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import {
  isEmbeddingModel,
  isFunctionCallingModel,
  isGenerateImageModel,
  isNonChatModel,
  isRerankModel
} from '@shared/utils/model'
import { isExternalCliProvider, isOllamaProvider } from '@shared/utils/provider'

import { isAgentSessionTopic } from './agentSession/topic'
import { createAnalyticsHook } from './hooks/analyticsHook'
import { createAiUsagePlugin } from './hooks/billingHook'
import { resolveAttachmentBudget } from './messages/attachmentBudget'
import { prepareChatMessages } from './messages/attachmentRouting'
import { resolveMediaCapabilities, resolveToolResultMediaCapabilities } from './messages/messageCapabilities'
import { applyHttpTrace } from './observability'
import { imageGenerationJobHandler } from './provider/custom/tasks/imageGenerationJobHandler'
import { resolveEffectiveEndpoint, resolveWireModelId } from './provider/endpoint'
import { listModels as listModelsFromProvider, probeOllamaModel } from './provider/listModels'
import { resolveSdkConfig } from './provider/sdkConfig'
import type { AgentLoopHooks, NativeFileSupport, RequestFeature } from './runtime/aiSdk'
import {
  Agent,
  buildAgentParams,
  buildApiKeyFallbackModels,
  buildFallbackModels,
  createRetryableWrap,
  readRetryPolicy
} from './runtime/aiSdk'
import { skillService } from './skills/SkillService'
import { type MessageRuntimeTimingSink, WebContentsListener } from './streamManager'
import { resolveModelTokenDialect } from './tokens/dialect'
import { registerBuiltinTools } from './tools/adapters/aiSdk/builtin/registerBuiltinTools'
import type {
  AiChatRequest,
  AiRequest,
  AiStreamRequest,
  AiTransportOptions,
  AppProviderSettingsMap,
  InProcessUsageContext,
  ListModelsRequest
} from './types'
import { installProviderUserAgentInterceptor } from './utils/customFetch'
import { executeImageRequest, probeImageRequest } from './utils/executeImageRequest'
import { prepareImageExecution, prepareImageProbe } from './utils/prepareImageRequest'
import { routeToEndpoint } from './utils/provider'
import {
  createAiUsageCaptureContext,
  createModelUsageCaptureContext,
  createProviderCallHandler
} from './utils/usageCapture'

const logger = loggerService.withContext('AiService')

/**
 * Max concurrent `doEmbed` batches for `embedMany`. AI SDK defaults to
 * `Infinity`, which fires every batch of a long document at once and is the
 * primary embedding rate-limit trigger. Bounded fan-out trades a little
 * throughput for far fewer 429s.
 */
const EMBEDDING_MAX_PARALLEL_CALLS = 5

const NO_NATIVE_FILE_REQUIREMENTS: NativeFileSupport = { image: false, pdf: false, audio: false, video: false }

type MutableNativeFileSupport = { -readonly [K in keyof NativeFileSupport]: NativeFileSupport[K] }

/** Native attachment shapes preserved for the primary and therefore replayed unchanged to a fallback. */
export function resolveRequiredNativeFileSupport(
  messages: ReadonlyArray<unknown> | undefined,
  primarySupport: NativeFileSupport
): NativeFileSupport {
  if (!messages) return NO_NATIVE_FILE_REQUIREMENTS
  const required: MutableNativeFileSupport = { ...NO_NATIVE_FILE_REQUIREMENTS }
  for (const message of messages) {
    const m = message as { parts?: unknown[]; content?: unknown }
    const parts = Array.isArray(m.parts) ? m.parts : Array.isArray(m.content) ? m.content : []
    for (const part of parts) {
      const p = part as { type?: string; mediaType?: string }
      if (p.type === 'image' && primarySupport.image) required.image = true
      if (p.type !== 'file' || typeof p.mediaType !== 'string') continue
      if (p.mediaType.startsWith('image/') && primarySupport.image) required.image = true
      else if (p.mediaType.startsWith('video/') && primarySupport.video) required.video = true
      else if (p.mediaType.startsWith('audio/') && primarySupport.audio) required.audio = true
      else if (p.mediaType === 'application/pdf' && primarySupport.pdf) required.pdf = true
    }
  }
  return required
}

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

function sourceSnapshotForAssistant(assistant: Assistant | undefined): SourceSnapshot | undefined {
  return assistant
    ? {
        type: 'assistant',
        id: assistant.id,
        name: assistant.name,
        icon: assistant.emoji
      }
    : undefined
}

function resolveTextRetryPolicy(
  configured: ReturnType<typeof readRetryPolicy>,
  requestMaxRetries: number | undefined,
  hasApiKeyFallbacks: boolean
): ReturnType<typeof readRetryPolicy> {
  if (configured.enabled || !hasApiKeyFallbacks || requestMaxRetries === undefined || requestMaxRetries <= 0) {
    return configured
  }
  return { ...configured, enabled: true, maxAttempts: Math.max(1, Math.trunc(requestMaxRetries)), fallbackModelIds: [] }
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
export type AsInProcess<T extends AiRequest> = Omit<T, 'requestOptions'> & {
  requestOptions?: AiRequestOptions
  /** Trusted in-process classification for remote token analytics. */
  tokenUsageSource?: TokenUsageSource
  resolvedModel?: { readonly provider: Provider; readonly model: Model }
}

/** Chat requests additionally carry the turn's correlation and the stream manager's sinks. */
export type AsInProcessChat<T extends AiChatRequest> = AsInProcess<T> & {
  usageContext?: InProcessUsageContext
  runtimeTimingSink?: MessageRuntimeTimingSink
  /**
   * Emits compaction lifecycle events as `data-compaction-anchor` chunks.
   * In-process only (a closure), same as `runtimeTimingSink` — the stream
   * manager supplies it because only it can reach the turn's chunk sink.
   */
  compactionSink?: CompactionSink
}

/** Non-streaming text generation request — pure transport data. */
export interface AiGenerateRequest extends AiChatRequest {
  system?: string
  prompt?: string
  messages?: ModelMessage[]
}

// ── SDK extensions ─────────────────────────────────────────────────

/** Result of non-streaming text generation. */
export interface AiGenerateResult {
  text: string
  usage?: LanguageModelUsage
  finishReason: FinishReason
  rawFinishReason?: string
}

function toMcpSamplingStopReason(result: Pick<AiGenerateResult, 'finishReason' | 'rawFinishReason'>): string {
  if (result.finishReason === 'length') return 'maxTokens'
  if (result.finishReason !== 'stop') return result.rawFinishReason ?? result.finishReason

  const rawReason = result.rawFinishReason?.replace(/[^a-z]/gi, '').toLowerCase()
  return rawReason === 'stopsequence' ? 'stopSequence' : 'endTurn'
}

/** Image generation request. */
export interface AiImageRequest extends AiRequest {
  prompt: string
  /** Input images, independent of the business operation. */
  inputImages?: string[]
  /** Mask for inpainting (only with inputImages). */
  mask?: string
  /** Omitted means ordinary generation, with or without reference images. */
  operation?: ImageOperation
  /**
   * Canonical param bag — already a strict, coerced `ParamValues` (the
   * `ai.image.generate` IPC validated it via the catalog `imageParamsSchema`).
   * main derives the structured request fields + the vendor bag from it via
   * `splitParamValues`.
   */
  paramValues: ParamValues
  /**
   * Cleanup policy stamped on the generated **output** FileEntries. AiService is
   * infrastructure — the calling business feature decides the policy
   * (file-entry-cleanup.md §4.1). It deliberately does NOT reach the job path's
   * input / mask copies: those are transport scratch owned by the job, not a
   * caller-visible artifact.
   */
  cleanupPolicy: CleanupPolicy
}

/** Image generation result — persisted file entries (main writes the bytes). */
export interface AiImageResult {
  files: FileEntry[]
}

/** Embedding request. */
export interface AiEmbedRequest extends AiRequest {
  values: string[]
}

/** Embedding result. */
export interface AiEmbedResult {
  embeddings: number[][]
  usage?: EmbeddingModelUsage
}

export interface AiRerankRequest extends AiRequest {
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
  // Per-request AbortControllers for the cancellable one-shot routes (`ai.image.generate`,
  // `ai.text.generate`), paired with their `*.abort` routes. Key is the renderer-generated
  // requestId. Entries are self-cleaning via `runWithAbort`'s `finally` block; abort on an
  // unknown id is a no-op.
  // TODO(abort-registry): collapse with MCP/stream/LAN registries once
  // the shared `ipcHandleWithAbort` helper lands.
  private readonly requests = new Map<string, AbortController>()

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
   * Apply a tool-approval decision (`ai.tool.respond_approval`). Input validation happens in the
   * IpcApi router; `senderWc` is the caller window's WebContents (the MCP continuation streams to
   * it), resolved by the handler from `ctx.senderId` — `undefined` when no managed window, in which
   * case the continuation can't be surfaced and we resolve `{ ok: false }`.
   */
  async respondToolApproval(
    payload: AiToolApprovalRespondRequest,
    senderWc: Electron.WebContents | undefined
  ): Promise<AiToolApprovalRespondResponse> {
    // Claude-Agent path: the runtime settles any persisted interaction card, then unblocks
    // the exact `canUseTool` invocation that issued this approval id.
    const dispatched = application.get('AgentSessionRuntimeService').respondToolApproval(
      payload.approvalId,
      {
        approved: payload.approved,
        reason: payload.reason,
        updatedInput: payload.updatedInput
      },
      payload.anchorId
    )
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
    request: AsInProcessChat<AiStreamRequest>,
    extraFeatures: readonly RequestFeature[] = []
  ): Promise<ReadableStream<UIMessageChunk>> {
    logger.info('streamText started', { chatId: request.conversation.topicId })
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

    if (isAgentSessionTopic(request.conversation.topicId)) {
      throw new Error(`Agent session stream ${request.conversation.topicId} requires an agent-session runtime request`)
    }

    const repairUsagePlugins: { current?: AiPlugin[] } = {}
    const {
      sdkConfig,
      credentialReceipt,
      tools,
      plugins,
      system,
      options,
      provider,
      model,
      assistant,
      hookParts,
      nativeFileSupport,
      fileAttachments
    } = await this.buildAgentParamsFor(request, signal, extraFeatures, () => repairUsagePlugins.current ?? [])
    const usageContext = createModelUsageCaptureContext({
      provider,
      model,
      sdkModelId: sdkConfig.modelId,
      credentialReceipt,
      // Agent turns win FIRST, `null` included — `usageContext` means "already decided", so a
      // `??` here would attribute a deliberately-anonymous agent turn to some assistant.
      source: request.usageContext
        ? request.usageContext.source
        : (request.source ?? sourceSnapshotForAssistant(assistant)),
      messageRef: request.usageContext
        ? { kind: 'agent-session', id: request.usageContext.assistantMessageId }
        : request.messageId
          ? { kind: 'chat', id: request.messageId }
          : null
    })
    const usagePlugin = createAiUsagePlugin(usageContext)
    repairUsagePlugins.current = [usagePlugin]

    const mediaCapabilities = resolveMediaCapabilities(model)

    // Route attachments: native files stay inline, non-native become capped text
    // (always visible — never gated on the model calling read_file). The cap is
    // one shared pool, priced against what the rest of the request already spends.
    const preparedMessages = await prepareChatMessages(request.messages ?? [], {
      attachments: fileAttachments,
      nativeSupport: nativeFileSupport,
      isToolCapable: isFunctionCallingModel(model),
      // A caller that owns its context (the gateway) manages its own window;
      // reshaping its attachments against ours would be guesswork.
      budget:
        fileAttachments.length && request.contextOwner !== 'caller'
          ? ((await resolveAttachmentBudget({
              provider,
              model,
              system,
              tools,
              maxOutputTokens: options.maxOutputTokens,
              messages: request.messages ?? [],
              mediaCapabilities
            })) ?? undefined)
          : undefined,
      signal
    })

    // An explicit per-request `maxRetries: 0` means "no retries for this request"
    // — honor it (like embedding/rerank), overriding the global retry preference.
    const retryDisabledForRequest = request.requestOptions?.maxRetries === 0
    const agentRef: { current?: Agent } = {}
    let activeRepairToolCall = options.repairToolCall
    const repairToolCall = options.repairToolCall
      ? (repairOptions: Parameters<NonNullable<typeof options.repairToolCall>>[0]) =>
          activeRepairToolCall!(repairOptions)
      : undefined
    let wrapModel: ReturnType<typeof createRetryableWrap>
    if (!retryDisabledForRequest) {
      const apiKeyFallbacks = buildApiKeyFallbackModels({
        request,
        provider,
        model,
        assistant,
        signal,
        extraFeatures,
        primaryCredentialReceipt: credentialReceipt,
        createUsagePlugin: (fallbackReceipt) =>
          createAiUsagePlugin(createAiUsageCaptureContext({ ...usageContext, credentialReceipt: fallbackReceipt }))
      })
      const retryPolicy = resolveTextRetryPolicy(
        readRetryPolicy(),
        request.requestOptions?.maxRetries,
        apiKeyFallbacks.length > 0
      )
      wrapModel = createRetryableWrap({
        apiKeyFallbacks,
        retryPolicy,
        diagnosticContext: {
          chatId: request.conversation.topicId,
          messageId: request.messageId,
          assistantId: request.assistantId
        },
        fallbacks: buildFallbackModels({
          request,
          assistant,
          signal,
          primaryUniqueModelId: model.id,
          primaryHasTools: !!tools && Object.keys(tools).length > 0,
          requiredNativeFileSupport: resolveRequiredNativeFileSupport(request.messages, nativeFileSupport),
          extraFeatures,
          retryPolicy,
          createUsagePlugin: ({ provider, model, sdkModelId, credentialReceipt }) =>
            createAiUsagePlugin(
              createModelUsageCaptureContext({
                provider,
                model,
                sdkModelId,
                credentialReceipt,
                source: usageContext.source,
                messageRef: usageContext.messageRef
              })
            )
        }),
        onFallbackActivated: (fallback) => {
          activeRepairToolCall = fallback.repairToolCall ?? options.repairToolCall
        },
        onPrimaryActivated: () => {
          activeRepairToolCall = options.repairToolCall
        },
        // Stable `id` so repeated retries reconcile into one live status part (latest wins).
        // Not transient: it rides message.parts so the renderer can show it; the
        // PersistenceListener strips it before the message is saved.
        onRetryEvent: (event) => agentRef.current?.write({ type: 'data-retry', id: 'retry', data: event })
      })
    }

    const agent = new Agent({
      providerId: sdkConfig.providerId,
      providerSettings: sdkConfig.providerSettings,
      modelId: sdkConfig.modelId,
      errorContext: { providerId: provider.id, modelId: model.apiModelId ?? model.id },
      messageId: request.messageId,
      plugins: [...plugins, usagePlugin],
      wrapModel,
      tools,
      system,
      options: wrapModel ? { ...options, maxRetries: 0, repairToolCall } : options,
      hookParts: [
        this.analyticsHookPart(model, request.tokenUsageSource ?? 'chat'),
        ...(request.runtimeTimingSink
          ? [
              {
                onToolExecutionStart: (event) => request.runtimeTimingSink?.onToolExecutionStart(event),
                onToolExecutionEnd: (event) => request.runtimeTimingSink?.onToolExecutionEnd(event)
              } satisfies Partial<AgentLoopHooks>
            ]
          : []),
        ...hookParts
      ],
      mediaCapabilities,
      toolResultMediaCapabilities: resolveToolResultMediaCapabilities(
        mediaCapabilities,
        resolveModelTokenDialect(provider, model)
      )
    })
    agentRef.current = agent

    return agent.stream(preparedMessages, signal)
  }

  private analyticsHookPart(model: Model, source: TokenUsageSource = 'chat'): Partial<AgentLoopHooks> {
    return createAnalyticsHook(model, (trackedModel, usage) => this.trackUsage(trackedModel, usage, source))
  }

  // ── Request-scoped cancellation ──

  /** Run `operation` under a registry entry keyed by the renderer-supplied `requestId`. */
  private async runWithAbort<T>(requestId: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    this.requests.set(requestId, controller)
    try {
      return await operation(controller.signal)
    } finally {
      this.requests.delete(requestId)
    }
  }

  /** Abort the in-flight request for `requestId`; a no-op on an unknown id. */
  abortRequest(requestId: string): void {
    this.requests.get(requestId)?.abort()
  }

  // ── Non-streaming text generation (agent.generate) ──

  /** Cancellable variant of {@link generateText}, paired with the `ai.text.abort` route. */
  async runTextRequest(requestId: string, request: AsInProcess<AiGenerateRequest>): Promise<AiGenerateResult> {
    return this.runWithAbort(requestId, (signal) =>
      this.generateText({ ...request, requestOptions: { ...request.requestOptions, signal } })
    )
  }

  async generateText(
    request: AsInProcessChat<AiGenerateRequest>,
    extraFeatures: readonly RequestFeature[] = []
  ): Promise<AiGenerateResult> {
    logger.info('generateText started', { assistantId: request.assistantId })
    const signal = request.requestOptions?.signal
    // Model messages go directly to generation, not the UI-message context scanner.
    const { messages, ...parameterRequest } = request

    const repairUsagePlugins: { current?: AiPlugin[] } = {}
    const {
      sdkConfig,
      credentialReceipt,
      tools,
      plugins,
      system,
      options,
      provider,
      model,
      assistant,
      hookParts,
      nativeFileSupport
    } = await this.buildAgentParamsFor(parameterRequest, signal, extraFeatures, () => repairUsagePlugins.current ?? [])
    const usageContext = createModelUsageCaptureContext({
      provider,
      model,
      sdkModelId: sdkConfig.modelId,
      credentialReceipt,
      source: sourceSnapshotForAssistant(assistant),
      messageRef: null
    })
    const usagePlugin = createAiUsagePlugin(usageContext)
    repairUsagePlugins.current = [usagePlugin]
    let activeRepairToolCall = options.repairToolCall
    const repairToolCall = options.repairToolCall
      ? (repairOptions: Parameters<NonNullable<typeof options.repairToolCall>>[0]) =>
          activeRepairToolCall!(repairOptions)
      : undefined

    // An explicit per-request `maxRetries: 0` disables retry for this request.
    let wrapModel: ReturnType<typeof createRetryableWrap>
    if (request.requestOptions?.maxRetries !== 0) {
      const apiKeyFallbacks = buildApiKeyFallbackModels({
        request,
        provider,
        model,
        assistant,
        signal,
        extraFeatures,
        primaryCredentialReceipt: credentialReceipt,
        createUsagePlugin: (fallbackReceipt) =>
          createAiUsagePlugin(createAiUsageCaptureContext({ ...usageContext, credentialReceipt: fallbackReceipt }))
      })
      const retryPolicy = resolveTextRetryPolicy(
        readRetryPolicy(),
        request.requestOptions?.maxRetries,
        apiKeyFallbacks.length > 0
      )
      wrapModel = createRetryableWrap({
        apiKeyFallbacks,
        retryPolicy,
        diagnosticContext: { assistantId: request.assistantId },
        fallbacks: buildFallbackModels({
          request,
          assistant,
          signal,
          primaryUniqueModelId: model.id,
          primaryHasTools: !!tools && Object.keys(tools).length > 0,
          requiredNativeFileSupport: resolveRequiredNativeFileSupport(request.messages, nativeFileSupport),
          extraFeatures,
          retryPolicy,
          createUsagePlugin: ({ provider, model, sdkModelId, credentialReceipt }) =>
            createAiUsagePlugin(
              createModelUsageCaptureContext({
                provider,
                model,
                sdkModelId,
                credentialReceipt,
                source: usageContext.source,
                messageRef: usageContext.messageRef
              })
            )
        }),
        onFallbackActivated: (fallback) => {
          activeRepairToolCall = fallback.repairToolCall ?? options.repairToolCall
        },
        onPrimaryActivated: () => {
          activeRepairToolCall = options.repairToolCall
        }
      })
    }

    // Same media gating as the streaming path — `agent.generate` hands `ModelMessage[]` to the
    // SDK as-is, so without these the structured tool-result media the converter produces would
    // be JSON/base64-encoded or rejected on OpenAI/Ollama, diverging from `stream`.
    const mediaCapabilities = resolveMediaCapabilities(model)
    const agent = new Agent({
      providerId: sdkConfig.providerId,
      providerSettings: sdkConfig.providerSettings,
      modelId: sdkConfig.modelId,
      plugins: [...plugins, usagePlugin],
      wrapModel,
      tools,
      system,
      options: wrapModel ? { ...options, maxRetries: 0, repairToolCall } : options,
      hookParts: [this.analyticsHookPart(model, request.tokenUsageSource ?? 'chat'), ...hookParts],
      mediaCapabilities,
      toolResultMediaCapabilities: resolveToolResultMediaCapabilities(
        mediaCapabilities,
        resolveModelTokenDialect(provider, model)
      )
    })

    // prompt and messages are mutually exclusive in AI SDK; preserve that.
    return agent.generate(request.prompt ? { prompt: request.prompt } : { messages: messages ?? [] }, signal)
  }

  /**
   * Restricted host callback for an MCP embedded sampling request. The request
   * is non-streaming and `disableTools` is enforced in buildAgentParams so an
   * MCP server cannot recursively reach Cherry or MCP tools.
   */
  async generateMcpSampling(
    model: `${string}::${string}`,
    request: CreateMessageRequestParamsBase,
    signal: AbortSignal
  ): Promise<CreateMessageResult> {
    const messages = request.messages.map((message): ModelMessage => {
      const parts = Array.isArray(message.content) ? message.content : [message.content]
      const content = parts.map((part) => {
        switch (part.type) {
          case 'text':
            return { type: 'text' as const, text: part.text }
          case 'image':
            return { type: 'image' as const, image: part.data, mediaType: part.mimeType }
          case 'audio':
            return { type: 'file' as const, data: part.data, mediaType: part.mimeType }
          default:
            throw new Error(`Unsupported MCP sampling content type: ${part.type}`)
        }
      })
      if (message.role === 'assistant') {
        // AI SDK represents assistant media as files; image parts are user-only.
        return {
          role: 'assistant',
          content: content.map((part) =>
            part.type === 'image' ? { type: 'file', data: part.image, mediaType: part.mediaType } : part
          )
        }
      }
      return { role: message.role, content }
    })
    const result = await this.generateText({
      uniqueModelId: model,
      conversation: { id: `mcp-sampling:${randomUUID()}` },
      system: request.systemPrompt,
      messages,
      disableTools: true,
      callOverrides: {
        maxOutputTokens: request.maxTokens,
        ...(typeof request.temperature === 'number' ? { temperature: request.temperature } : {}),
        ...(Array.isArray(request.stopSequences) ? { stopSequences: request.stopSequences } : {})
      },
      requestOptions: { signal }
    })
    return {
      model,
      role: 'assistant',
      content: { type: 'text', text: result.text },
      stopReason: toMcpSamplingStopReason(result)
    }
  }

  // ── Image generation ──

  /**
   * Run an image request under an abort registry entry keyed by the renderer-supplied
   * `requestId`, so `ai.image.abort` can cancel it. The `ai.image.generate` handler
   * delegates here (the registry is service state).
   */
  async runImageRequest(requestId: string, payload: AiImageRequest): Promise<AiImageResult> {
    return this.runWithAbort(requestId, (signal) =>
      this.generateImage({ ...payload, requestOptions: { ...payload.requestOptions, signal } })
    )
  }

  async generateImage(request: AsInProcess<AiImageRequest>): Promise<AiImageResult> {
    logger.info('generateImage started', { assistantId: request.assistantId, uniqueModelId: request.uniqueModelId })
    const { provider, model, assistant } = this.getProviderAndModel(request)
    return executeImageRequest(prepareImageExecution(request, provider, model), sourceSnapshotForAssistant(assistant))
  }

  // ── Embedding ──

  async embedMany(request: AsInProcess<AiEmbedRequest>): Promise<AiEmbedResult> {
    logger.info('embedMany started', { assistantId: request.assistantId, count: request.values.length })
    const signal = request.requestOptions?.signal

    const { sdkConfig, credentialReceipt, provider, model, assistant } = await this.resolveTransportFor(request)
    const usageContext = createModelUsageCaptureContext({
      provider,
      model,
      sdkModelId: sdkConfig.modelId,
      credentialReceipt,
      source: sourceSnapshotForAssistant(assistant),
      messageRef: null
    })

    const retryPolicy = readRetryPolicy()
    const result = await aiCoreEmbedMany<AppProviderSettingsMap>(sdkConfig.providerId, sdkConfig.providerSettings, {
      model: sdkConfig.modelId,
      values: request.values,
      // A long document splits into many batches and embedMany defaults to
      // unbounded parallelism — firing them all at once is the main rate-limit
      // trigger. Keep the pre-feature default when retry is disabled.
      ...(retryPolicy.enabled && { maxParallelCalls: EMBEDDING_MAX_PARALLEL_CALLS }),
      // Disabled-default 2 = AI SDK's default, so default-config embedding keeps
      // its prior transient-error resilience (this PR only adds, never removes).
      maxRetries: request.requestOptions?.maxRetries ?? (retryPolicy.enabled ? retryPolicy.maxAttempts : 2),
      onProviderCall: createProviderCallHandler(usageContext),
      ...(signal ? { abortSignal: signal } : {})
    })

    return { embeddings: result.embeddings, usage: result.usage }
  }

  // ── Reranking ──

  async rerank(request: AsInProcess<AiRerankRequest>): Promise<AiRerankResult> {
    logger.info('rerank started', { assistantId: request.assistantId, count: request.documents.length })
    const signal = request.requestOptions?.signal

    const { sdkConfig, credentialReceipt, provider, model, assistant } = await this.resolveTransportFor(request)
    const usageContext = createModelUsageCaptureContext({
      provider,
      model,
      sdkModelId: sdkConfig.modelId,
      credentialReceipt,
      source: sourceSnapshotForAssistant(assistant),
      messageRef: null
    })
    const retryPolicy = readRetryPolicy()
    const callerHeaders = request.requestOptions?.headers
    const headers = callerHeaders
      ? (Object.fromEntries(Object.entries(callerHeaders).filter(([, value]) => value !== undefined)) as Record<
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
      // ai-retry doesn't support RerankingModelV3 — use the AI SDK's built-in
      // exponential-backoff retry, defaulted from the retry preference. Rerank
      // already defaulted to 0 retries pre-feature, so keep that when disabled.
      maxRetries: request.requestOptions?.maxRetries ?? (retryPolicy.enabled ? retryPolicy.maxAttempts : 0),
      onProviderCall: createProviderCallHandler(usageContext),
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
  async listModels(request: ListModelsRequest): Promise<ListedModels> {
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
      return {
        models: providerRegistryService.listProviderRegistryModels({
          providerId,
          presetProviderId: provider.presetProviderId ?? null
        })
      }
    }
    const remote = await listModelsFromProvider(provider, undefined, { throwOnError: request.throwOnError })
    if (!provider.supplementModelsFromRegistry) {
      return remote
    }
    const registryModels = providerRegistryService.listProviderRegistryModels({
      providerId,
      presetProviderId: provider.presetProviderId ?? null
    })
    // Catalog supplementation must not hide the provider's skipped-model notice.
    return {
      models: mergeProviderModelsWithRegistry(remote.models, registryModels),
      ...(remote.skippedModels ? { skippedModels: remote.skippedModels } : {})
    }
  }

  /** Captures one model configuration for related probes without re-reading changing settings. */
  prepareModelCheck(uniqueModelId: UniqueModelId) {
    const resolvedModel = structuredClone(this.getProviderAndModel({ uniqueModelId }))
    const { provider, model } = resolvedModel
    const endpoint = resolveEffectiveEndpoint(provider, model)
    const primaryEndpoint = model.endpointTypes?.[0]
    const chatPrimary = primaryEndpoint != null && endpointImpliedCapability(primaryEndpoint) === undefined
    return {
      uniqueModelId: model.id,
      modelName: model.name,
      isCurrent: () => {
        try {
          return isDeepStrictEqual(this.getProviderAndModel({ uniqueModelId }), resolvedModel)
        } catch (error) {
          if (isDataApiNotFoundError(error)) return false
          throw error
        }
      },
      modelId: resolveWireModelId(model, endpoint.endpointType),
      baseUrl: routeToEndpoint(endpoint.baseUrl).baseURL,
      supportsModelListing: provider.modelListSource !== 'registry',
      isExternalCli: isExternalCliProvider(provider),
      supportsChat: chatPrimary || !isNonChatModel(model),
      listModels: async (signal: AbortSignal) => {
        const { models } = await listModelsFromProvider(
          { ...provider, defaultChatEndpoint: endpoint.endpointType },
          signal,
          { throwOnError: true }
        )
        return models.flatMap((candidate) =>
          candidate.apiModelId === undefined
            ? []
            : [resolveWireModelId({ ...model, apiModelId: candidate.apiModelId }, endpoint.endpointType)]
        )
      },
      checkConversation: (signal: AbortSignal) =>
        this.checkModel({ uniqueModelId, resolvedModel, requestOptions: { signal, maxRetries: 0 } }, { chatOnly: true })
    }
  }

  // ── API validation ──

  /** Dispatches rerank first, then prefers text for chat-primary models over embedding. */
  async checkModel(
    request: AsInProcess<AiRequest> & { timeout?: number },
    options?: { chatOnly: boolean }
  ): Promise<{ latency: number }> {
    request.requestOptions?.signal?.throwIfAborted()
    const { provider, model } = this.getProviderAndModel(request)
    const start = performance.now()
    const timeout = request.timeout ?? 15000

    const primaryEndpoint = model.endpointTypes?.[0]
    const hasChatPrimaryEndpoint = primaryEndpoint != null && endpointImpliedCapability(primaryEndpoint) === undefined

    // AbortController on timeout so the HTTP work cancels too (otherwise tokens keep burning).
    const controller = new AbortController()
    const signal = request.requestOptions?.signal
      ? AbortSignal.any([controller.signal, request.requestOptions.signal])
      : controller.signal
    const timeoutHandle = setTimeout(() => controller.abort(new Error('Check model timeout')), timeout)
    let onAbort: () => void = () => {}
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason)
      signal.addEventListener('abort', onAbort, { once: true })
    })
    const probeRequest = { ...request, requestOptions: { ...request.requestOptions, signal } }
    try {
      let probe: Promise<unknown>
      if (isOllamaProvider(provider) && !options?.chatOnly) {
        probe = probeOllamaModel(provider, model.apiModelId, signal, request.apiKeyOverride)
      } else if (!options?.chatOnly && isRerankModel(model)) {
        probe = this.rerank({ ...probeRequest, query: 'test', documents: ['test'], topN: 1 }).then((result) => {
          if (result.ranking.length === 0) {
            throw new Error('Rerank health check returned empty ranking')
          }
          return result
        })
      } else if (!options?.chatOnly && isEmbeddingModel(model) && !hasChatPrimaryEndpoint) {
        probe = this.embedMany({ ...probeRequest, values: ['test'] })
      } else if (!options?.chatOnly && isGenerateImageModel(model) && !hasChatPrimaryEndpoint) {
        probe = Promise.resolve().then(() => probeImageRequest(prepareImageProbe(probeRequest, provider, model)))
      } else {
        // Latency is the probe's measured output — thinking tokens would pollute it
        // for reasoning-capable models whose provider default enables reasoning.
        probe = this.generateText({
          ...probeRequest,
          // A health check has no topic; each probe is its own conversation.
          conversation: { id: `check:${randomUUID()}` },
          system: 'test',
          prompt: 'hi',
          reasoningEffort: 'none'
        })
      }

      await Promise.race([probe, aborted])
      signal.throwIfAborted()
      return { latency: performance.now() - start }
    } finally {
      clearTimeout(timeoutHandle)
      signal.removeEventListener('abort', onAbort)
    }
  }

  // ── Shared agent parameter resolution ──

  /** Transport resolution shared by every modality: provider, model, credential, wire model id. */
  private async resolveTransportFor(request: AsInProcess<AiRequest>) {
    const { provider, model, assistant } = this.getProviderAndModel(request)
    const { sdkConfig, credentialReceipt } = await resolveSdkConfig(
      provider,
      model,
      resolveEffectiveEndpoint(provider, model),
      request.apiKeyOverride
    )
    applyHttpTrace(sdkConfig.providerSettings, { modelName: model.name ?? model.id })
    return { provider, model, assistant, sdkConfig, credentialReceipt }
  }

  private async buildAgentParamsFor(
    request: AsInProcessChat<AiChatRequest> &
      Pick<AiStreamRequest, 'messageId' | 'messages' | 'retainedContext'> &
      Pick<AiGenerateRequest, 'system'>,
    signal: AbortSignal | undefined,
    extraFeatures: readonly RequestFeature[] = [],
    getRepairUsagePlugins?: () => AiPlugin[]
  ) {
    const { provider, model, assistant } = this.getProviderAndModel(request)
    const built = await buildAgentParams({
      request,
      signal,
      provider,
      model,
      assistant,
      extraFeatures,
      getRepairUsagePlugins,
      compactionSink: request.compactionSink
    })
    return { ...built, provider, model, assistant }
  }

  // ── Token usage tracking ──

  private trackUsage(
    model: Model,
    usage?: { inputTokens?: number; outputTokens?: number },
    source: TokenUsageSource = 'chat'
  ): void {
    if (!usage || !model.providerId || !model.apiModelId) return
    const inputTokens = usage.inputTokens ?? 0
    const outputTokens = usage.outputTokens ?? 0

    try {
      const analyticsService = application.get('AnalyticsService')
      analyticsService.trackTokenUsage({
        provider: model.providerId,
        model: model.apiModelId ?? model.id,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        source
      })
    } catch {
      // AnalyticsService may not be activated (data collection disabled)
    }
  }

  /** Priority: explicit `uniqueModelId` > `assistant.modelId`. */
  private getProviderAndModel(request: AsInProcess<AiRequest>) {
    if (request.resolvedModel) return { ...request.resolvedModel, assistant: undefined }
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
