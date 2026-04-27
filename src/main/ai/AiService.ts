import type { AiPlugin } from '@cherrystudio/ai-core'
import { createAgent, embedMany as aiCoreEmbedMany, generateImage as aiCoreGenerateImage } from '@cherrystudio/ai-core'
import { assistantDataService } from '@data/services/AssistantService'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import { downloadImageAsBase64 } from '@main/services/agents/services/channels/ChannelAdapter'
import { toolApprovalRegistry } from '@main/services/agents/services/claudecode/ToolApprovalRegistry'
import { MAX_TOOL_CALLS, MIN_TOOL_CALLS } from '@shared/config/constants'
import { type Assistant, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { ENDPOINT_TYPE, type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { IpcChannel } from '@shared/IpcChannel'
import {
  type ChatTransport,
  type EmbeddingModelUsage,
  type LanguageModelUsage,
  type ModelMessage,
  stepCountIs,
  type ToolSet,
  type UIMessage,
  type UIMessageChunk
} from 'ai'

import { type AgentLoopHooks, type AgentOptions, runAgentLoop } from './agentLoop'
import { resolveCapabilities } from './capabilities'
import { resolveUIMessageFileUrls } from './messages/messageConverter'
import type { PendingMessageQueue } from './PendingMessageQueue'
import { buildPlugins } from './plugins/PluginBuilder'
import type { ClaudeCodeProviderSettings } from './provider/claude-code/types'
import { extractAgentSessionId, isAgentSessionTopic } from './provider/claudeCodeSettingsBuilder'
import { providerToAiSdkConfig } from './provider/config'
import { getAiSdkProviderId } from './provider/factory'
import { listModels as listModelsFromProvider } from './services/listModels'
import { dispatchStreamRequest } from './stream-manager/context'
import { WebContentsListener } from './stream-manager/listeners/WebContentsListener'
import { registerMcpTools } from './tools/mcpTools'
import { resolveAssistantMcpToolIds } from './tools/resolveAssistantMcpTools'
import { ToolRegistry } from './tools/ToolRegistry'
import type { AppProviderSettingsMap } from './types'
import {
  buildCapabilityProviderOptions,
  extractAiSdkStandardParams,
  mergeCustomProviderParameters
} from './utils/options'
import { getCustomParameters } from './utils/reasoning'

const logger = loggerService.withContext('AiService')

/**
 * Heuristic for detecting embedding / rerank models. Prefers explicit endpoint
 * type metadata from the provider registry, falls back to a regex on model id
 * to cover user-imported models that have not been classified yet.
 */
const EMBEDDING_MODEL_ID_REGEX =
  /(?:^text-|embed|bge-|e5-|LLM2Vec|retrieval|uae-|gte-|jina-clip|jina-embeddings|voyage-)/i

// TODO： move to shared
function isEmbeddingModel(model: Model): boolean {
  const endpointTypes = model.endpointTypes ?? []
  if (endpointTypes.includes(ENDPOINT_TYPE.OPENAI_EMBEDDINGS)) return true
  if (endpointTypes.includes(ENDPOINT_TYPE.JINA_RERANK)) return true
  return EMBEDDING_MODEL_ID_REGEX.test(model.id)
}

/**
 * Merge caller-supplied extra tools into the Cherry-resolved ToolSet.
 * Cherry's resolved entries (MCP + assistant config) win on name conflict
 * so callers can fill in gaps without shadowing managed tools. Returns
 * `undefined` when neither side has any tools, which is the shape the
 * AI SDK expects for "no tools" — passing an empty object can trip some
 * provider plugins that check `tools != null`.
 */
function mergeTools(base: ToolSet | undefined, extra: ToolSet | undefined): ToolSet | undefined {
  if (!extra) return base
  if (!base) return extra
  return { ...extra, ...base }
}

/**
 * Resolve the `stopWhen` condition for the inner tool-call loop.
 *
 * Always returns a `stepCountIs(N)` — never `undefined`. The AI SDK's own
 * default is `stepCountIs(1)`, which would cut native tool-use flows off
 * after the first tool execution (the follow-up model request for the
 * tool result would never fire — upstream #14478).
 *
 *   - `enableMaxToolCalls` = false → use the schema default cap
 *   - `enableMaxToolCalls` = true  → clamp the user value to [MIN, MAX],
 *     fall back to the schema default on invalid / missing input
 */
function resolveStopWhen(assistant: Assistant): ReturnType<typeof stepCountIs> {
  const enableMaxToolCalls = assistant.settings?.enableMaxToolCalls ?? DEFAULT_ASSISTANT_SETTINGS.enableMaxToolCalls
  if (!enableMaxToolCalls) {
    return stepCountIs(DEFAULT_ASSISTANT_SETTINGS.maxToolCalls)
  }

  const raw = assistant.settings?.maxToolCalls
  const valid = raw !== undefined && raw >= MIN_TOOL_CALLS && raw <= MAX_TOOL_CALLS
  const count = valid ? raw : DEFAULT_ASSISTANT_SETTINGS.maxToolCalls
  return stepCountIs(count)
}

type ChatTrigger = Parameters<ChatTransport<UIMessage>['sendMessages']>[0]['trigger']

// ── Request types ──────────────────────────────────────────────────

/**
 * IPC-safe per-request transport config.
 *
 * Every field here can survive Electron's structured-clone (strings,
 * numbers, plain records). Use this type on **preload bridge / IPC
 * handler** signatures so renderer-supplied payloads cannot smuggle in
 * non-serialisable fields like `AbortSignal`.
 */
export interface AiTransportOptions {
  /**
   * Extra request headers layered on top of provider-level defaults
   * (`defaultAppHeaders()` + `provider.settings.extraHeaders`).
   *
   * Standard spread semantics — caller values win on key conflict; no
   * User-Agent concatenation, no key lowercasing. If you need the latter,
   * do it at the call site before handing the object in.
   */
  headers?: Record<string, string | undefined>

  /**
   * Idle-chunk timeout in milliseconds for streaming requests. The timer
   * resets on every chunk received from the provider; the request aborts
   * when the stream is silent for `timeout` ms. Falls back to
   * `DEFAULT_TIMEOUT` (30 min).
   *
   * Only honoured by streaming flows that go through `AiStreamManager`.
   * Non-streaming flows rely on `signal` for cancellation.
   */
  timeout?: number

  /**
   * Override AI SDK transparent-retry count. Defaults to `0` because
   * transparent retries can duplicate stream state inside the
   * multi-iteration tool loop. Safe to raise for non-streaming flows
   * (`generateText`, `embedMany`) when the caller tolerates idempotent
   * retries.
   */
  maxRetries?: number
}

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

/** Base fields shared by all AI requests. */
export interface AiBaseRequest {
  assistantId?: string
  /** Model identifier in "providerId::modelId" format. */
  uniqueModelId?: UniqueModelId
  mcpToolIds?: string[]
  /**
   * Per-request transport options. IPC-safe shape by default — preload
   * bridges and IPC handler signatures that take renderer input should
   * keep this type as-is. In-process callers who need to pass an
   * `AbortSignal` widen via `AsInProcess<T>` (see below).
   */
  requestOptions?: AiTransportOptions
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

/** Streaming chat request — pure transport data. Serialisable across IPC. */
export interface AiStreamRequest extends AiBaseRequest {
  /** Used by AiService for chunk routing. In AiStreamManager path this is set to topicId. */
  chatId: string
  trigger: ChatTrigger
  messageId?: string
  messages?: UIMessage[]
  knowledgeBaseIds?: string[]
  /**
   * Session-isolated queue of follow-up messages injected mid-stream.
   * Set by `AiStreamManager` (one per execution); consumed by either
   * `agentLoop` (between iterations via `drain()`) or the Claude Code
   * provider (as `injectedMessageSource`).
   */
  pendingMessages?: PendingMessageQueue
}

/** Non-streaming text generation request — pure transport data. */
export interface AiGenerateRequest extends AiBaseRequest {
  system?: string
  prompt?: string
  messages?: ModelMessage[]
}

// ── SDK extensions ─────────────────────────────────────────────────
//
// Extensions carry non-serialisable behaviour (hooks, plugin references,
// live `ToolSet` entries) that callers want to attach to a particular
// streamText / generateText invocation. They are passed as an extra
// argument rather than baked into the request shape so:
//
//  - transport payloads (IPC, stream-manager dispatch) stay pure data;
//  - stream-manager treats extensions as an opaque passthrough — it does
//    not need to import `AgentLoopHooks` / `AgentOptions` to wire them;
//  - SDK evolution (AI SDK adding a new hook) never ripples through the
//    Request types that IPC / Renderer / Provider code sees.

/** Extensions for `streamText`. */
export interface AiStreamExtensions {
  /**
   * Agent-loop hooks supplied by the caller. See `AgentLoopHooks` for the
   * full list of extension points (onStart / beforeIteration / prepareStep
   * / onStepFinish / afterIteration / onFinish / onError).
   *
   * `onFinish` composes with the built-in token tracker — the internal
   * hook fires first, then the caller's `onFinish`; caller errors are
   * logged but never cancel the internal analytics. Other value-returning
   * hooks (`prepareStep`, `onError`, `beforeIteration`, `afterIteration`)
   * are handed to the caller as-is — AiService has no internal behaviour
   * on those paths today.
   */
  hooks?: AgentLoopHooks

  /**
   * AI SDK agent options override. Shallow-merged over the defaults built
   * from `assistant.settings`. Use to force `toolChoice`, attach
   * `providerOptions` / `telemetry`, tweak temperature per-call, etc.
   */
  optionsOverride?: Partial<AgentOptions>

  /**
   * Extra AiPlugins appended after the built-in plugin set. Plugin order
   * is significant — caller plugins run after Cherry's built-ins (reasoning,
   * simulate-streaming, etc).
   */
  extraPlugins?: AiPlugin[]

  /**
   * Extra tools merged into the resolved ToolSet. Cherry-resolved tools
   * (MCP + assistant config) win on name conflict — caller entries only
   * fill in names the registry does not already cover.
   */
  extraTools?: ToolSet
}

/** Extensions for `generateText`. Same shape as `AiStreamExtensions` minus `hooks` (no iteration model). */
export type AiGenerateExtensions = Omit<AiStreamExtensions, 'hooks'>

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

export interface AiImageGenerateRequest {
  requestId: string
  payload: AiImageRequest
}

export interface AiImageAbortRequest {
  requestId: string
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
  private readonly toolRegistry = new ToolRegistry()
  /** Tracks in-flight non-streaming image requests so they can be aborted by id. */
  private readonly activeRequests = new Map<string, AbortController>()

  protected async onInit(): Promise<void> {
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

    this.ipcHandle(IpcChannel.Ai_GenerateImage, async (_, request: AiImageGenerateRequest) => {
      const controller = new AbortController()
      this.registerRequest(request.requestId, controller)
      try {
        return await this.generateImage({
          ...request.payload,
          requestOptions: { ...request.payload.requestOptions, signal: controller.signal }
        })
      } finally {
        this.removeRequest(request.requestId)
      }
    })

    this.ipcHandle(IpcChannel.Ai_AbortImage, async (_, request: AiImageAbortRequest) => {
      this.abort(request.requestId)
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
        }
      ): Promise<{ ok: boolean }> => {
        // 1. Claude-Agent path — registry still has the pending approval,
        // dispatching unblocks `canUseTool` so the in-flight stream resumes.
        const dispatched = toolApprovalRegistry.dispatch(payload.approvalId, {
          approved: payload.approved,
          reason: payload.reason,
          updatedInput: payload.updatedInput
        })
        if (dispatched) return { ok: true }

        // 2. MCP path — original stream already ended at approval-request.
        // Synthesise a `continue-conversation` request and run the same
        // dispatch pipeline as `Ai_Stream_Open`. We never read renderer-side
        // `chat.state.messages` to figure out which call this is for; the
        // renderer hands us `anchorId` straight from the DB-truth view.
        if (!payload.topicId || !payload.anchorId) {
          logger.warn('Tool-approval response had no live registry entry and no anchor context', {
            approvalId: payload.approvalId
          })
          return { ok: false }
        }

        const aiStreamManager = application.get('AiStreamManager')
        const subscriber = new WebContentsListener(event.sender, payload.topicId)
        await dispatchStreamRequest(aiStreamManager, subscriber, {
          trigger: 'continue-conversation',
          topicId: payload.topicId,
          parentAnchorId: payload.anchorId,
          approvalDecisions: [
            {
              approvalId: payload.approvalId,
              approved: payload.approved,
              ...(payload.reason !== undefined ? { reason: payload.reason } : {})
            }
          ]
        })
        return { ok: true }
      }
    )
  }

  // ── Streaming chat (agent.stream) ──

  /**
   * Start a streaming chat request and return the raw AI SDK UIMessageChunk
   * stream directly from `runAgentLoop`. The caller (AiStreamManager) owns
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
    extensions: AiStreamExtensions = {}
  ): Promise<ReadableStream<UIMessageChunk>> {
    logger.info('streamText started', { chatId: request.chatId })
    const signal = request.requestOptions?.signal ?? new AbortController().signal

    const { sdkConfig, tools, plugins, system, options, model } = await this.buildAgentParams(request)

    // Wire injectedMessageSource for Claude Code: PendingMessageQueue implements AsyncIterable<Message>
    if (request.pendingMessages && sdkConfig.providerId === 'claude-code') {
      const ccSettings = sdkConfig.providerSettings as ClaudeCodeProviderSettings
      ccSettings.defaultSettings = {
        ...ccSettings.defaultSettings,
        injectedMessageSource: request.pendingMessages
      }
    }

    // Compose caller-supplied extensions over the built-ins.
    const mergedPlugins = extensions.extraPlugins?.length ? [...plugins, ...extensions.extraPlugins] : plugins
    const mergedTools = mergeTools(tools, extensions.extraTools)
    const mergedOptions: AgentOptions = extensions.optionsOverride
      ? { ...options, ...extensions.optionsOverride }
      : options
    const mergedHooks = this.composeHooks(model, extensions.hooks)

    // Inline any `file://` URLs in the UIMessages' file parts as base64
    // data URLs. AI SDK's `convertToModelMessages` doesn't fetch
    // `file://`, so the provider would otherwise see bogus links.
    const preparedMessages = await resolveUIMessageFileUrls(request.messages ?? [])

    return runAgentLoop(
      {
        providerId: sdkConfig.providerId,
        providerSettings: sdkConfig.providerSettings,
        modelId: sdkConfig.modelId,
        messageId: request.messageId,
        plugins: mergedPlugins,
        tools: mergedTools,
        system,
        options: mergedOptions,
        pendingMessages: request.pendingMessages,
        hooks: mergedHooks
      },
      preparedMessages,
      signal
    )
  }

  /**
   * Merge the caller's `AgentLoopHooks` with AiService's internal hooks.
   *
   * - `onFinish` is **always** composed: the internal token tracker fires
   *   first, then the caller's `onFinish`. Caller errors are logged but
   *   never prevent the internal analytics from completing.
   * - For the value-returning hooks (`prepareStep`, `onError`,
   *   `beforeIteration`, `afterIteration`) the caller hook takes over
   *   entirely — AiService has no internal behaviour to preserve there.
   * - For fire-and-forget hooks (`onStart`, `onStepFinish`) the caller
   *   hook is passed through; no internal hook exists today.
   */
  private composeHooks(model: Model, callerHooks?: AgentLoopHooks): AgentLoopHooks {
    const callerOnFinish = callerHooks?.onFinish
    return {
      ...callerHooks,
      onFinish: (result) => {
        this.trackUsage(model, result.totalUsage)
        if (!callerOnFinish) return
        try {
          callerOnFinish(result)
        } catch (err) {
          logger.warn('caller onFinish hook threw', { err })
        }
      }
    }
  }

  // ── Non-streaming text generation (agent.generate) ──

  async generateText(
    request: AsInProcess<AiGenerateRequest>,
    extensions: AiGenerateExtensions = {}
  ): Promise<AiGenerateResult> {
    logger.info('generateText started', { assistantId: request.assistantId })
    const signal = request.requestOptions?.signal

    const { sdkConfig, tools, plugins, system, options, model } = await this.buildAgentParams(request)

    // Same extension points as streamText minus `hooks` — `agent.generate`
    // has no iteration model, so per-iteration hooks would have no effect.
    const mergedPlugins = extensions.extraPlugins?.length ? [...plugins, ...extensions.extraPlugins] : plugins
    const mergedTools = mergeTools(tools, extensions.extraTools)
    const mergedOptions: AgentOptions = extensions.optionsOverride
      ? { ...options, ...extensions.optionsOverride }
      : options

    const agent = await createAgent<AppProviderSettingsMap, typeof sdkConfig.providerId, ToolSet>({
      providerId: sdkConfig.providerId,
      providerSettings: sdkConfig.providerSettings,
      modelId: sdkConfig.modelId,
      plugins: mergedPlugins,
      agentSettings: {
        tools: mergedTools,
        instructions: request.system ?? system,
        ...mergedOptions
      }
    })

    // prompt and messages are mutually exclusive in AI SDK.
    // When a signal is provided, forward it via `abortSignal` so the underlying
    // HTTP work can be cancelled (e.g. by `checkModel`'s timeout).
    const generateParams = request.prompt
      ? { prompt: request.prompt, ...(signal ? { abortSignal: signal } : {}) }
      : { messages: request.messages ?? [], ...(signal ? { abortSignal: signal } : {}) }

    const result = await agent.generate(generateParams)

    this.trackUsage(model, result.usage)
    return { text: result.text, usage: result.usage }
  }

  // ── Image generation ──

  async generateImage(request: AsInProcess<AiImageRequest>): Promise<AiImageResult> {
    logger.info('generateImage started', { assistantId: request.assistantId, uniqueModelId: request.uniqueModelId })
    const signal = request.requestOptions?.signal

    const { sdkConfig } = await this.buildAgentParams(request)

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

    const { sdkConfig, model } = await this.buildAgentParams(request)

    const result = await aiCoreEmbedMany<AppProviderSettingsMap>(sdkConfig.providerId, sdkConfig.providerSettings, {
      model: sdkConfig.modelId,
      values: request.values,
      ...(signal ? { abortSignal: signal } : {})
    })

    this.trackUsage(model, { inputTokens: result.usage?.tokens ?? 0, outputTokens: 0 })
    return { embeddings: result.embeddings, usage: result.usage }
  }

  async getEmbeddingDimensions(request: AiBaseRequest): Promise<number> {
    const { embeddings } = await this.embedMany({ ...request, values: ['test'] })
    return embeddings[0].length
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

  private async buildAgentParams(request: AsInProcess<AiBaseRequest> & { chatId?: string }) {
    const { provider, model, assistant } = await this.getProviderAndModel(request)

    const chatId = request.chatId
    const isSession = chatId && isAgentSessionTopic(chatId)
    const agentSessionId = isSession ? extractAgentSessionId(chatId) : undefined
    const sdkConfig = {
      ...(await providerToAiSdkConfig(provider, model, { agentSessionId })),
      modelId: model.apiModelId ?? model.id
    }

    // Resolve MCP tool IDs — if the caller did not pass an explicit list we
    // derive one from the assistant's MCP config so renderers don't need to
    // know anything about MCP tool discovery.
    let mcpToolIds = request.mcpToolIds
    if (!mcpToolIds && request.assistantId) {
      mcpToolIds = await resolveAssistantMcpToolIds(request.assistantId)
    }
    if (mcpToolIds?.length) {
      await registerMcpTools(this.toolRegistry, mcpToolIds)
    }
    const tools = this.toolRegistry.resolve(mcpToolIds)

    const capabilities = assistant ? resolveCapabilities(model, provider, assistant) : undefined
    const plugins =
      assistant && capabilities
        ? buildPlugins({ provider, model, assistant, capabilities, mcpToolIds, topicId: chatId })
        : []
    // System prompt is owned entirely by `systemPromptPlugin`
    // (`replacePromptVariables` + hub-mode append). Leave
    // `agentSettings.instructions` undefined so the plugin is the single
    // source of truth.
    const system = undefined

    // `temperature` / `topP` / `maxOutputTokens` are applied by
    // `modelParamsPlugin` via `transformParams` with full model-capability
    // awareness (reasoning disables temperature on Claude, mutually exclusive
    // with topP on some models, thinking-token budget subtraction, etc.).
    const stopWhen = assistant ? resolveStopWhen(assistant) : undefined
    const { headers, maxRetries } = request.requestOptions ?? {}

    // Capability-driven `providerOptions` — per-provider-family reasoning
    // params, service tier, verbosity, generate-image flags. Stable for the
    // (assistant, model, provider, capabilities) tuple, so they belong at
    // the agent level; flow to `agentSettings.providerOptions` in runAgentLoop.
    let providerOptions =
      assistant && capabilities ? buildCapabilityProviderOptions(assistant, model, provider, capabilities) : {}

    // User-supplied `assistant.settings.customParameters` — same lifetime
    // as the assistant, so also agent-level rather than per-call. Split into
    // AI-SDK standard params (top-level) and provider-scoped params (merged
    // into providerOptions on top of the capability defaults).
    let standardParams: Partial<Record<string, unknown>> = {}
    if (assistant) {
      const customParams = getCustomParameters(assistant)
      if (Object.keys(customParams).length > 0) {
        const split = extractAiSdkStandardParams(customParams)
        standardParams = split.standardParams
        providerOptions = mergeCustomProviderParameters(
          providerOptions,
          split.providerParams,
          getAiSdkProviderId(provider)
        )
      }
    }

    const options: AgentOptions = {
      // Disable AI SDK transparent retries by default — they can duplicate
      // stream state in the multi-iteration tool loop. Caller can override
      // via `requestOptions.maxRetries` for non-streaming / idempotent flows.
      maxRetries: maxRetries ?? 0,
      // Inner-loop tool-call limit. When the user disables it, leave unset so
      // the AI SDK default (`stepCountIs(20)`) applies.
      ...(stopWhen && { stopWhen }),
      // Per-call extra headers from `request.requestOptions.headers`. Layered
      // on top of provider-level defaults; later plugins (e.g.
      // `anthropicHeadersPlugin`) layer on top of these via `transformParams`.
      ...(headers && { headers }),
      ...(Object.keys(providerOptions).length > 0 && { providerOptions }),
      // AI-SDK standard params extracted from customParameters
      // (topK / frequencyPenalty / presencePenalty / stopSequences / seed).
      ...standardParams
    }

    return { sdkConfig, tools, plugins, system, options, provider, model }
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

    // Provider/model from v2 DataApi (SQLite)
    logger.info('getProviderAndModel', { providerId, modelId, assistantId: request.assistantId })
    const provider = await providerService.getByProviderId(providerId)
    const model = await modelService.getByKey(providerId, modelId)

    return { provider, model, assistant }
  }

  // ── Request tracking (image generation abort) ──
  // Kept public so the image-abort IPC handler (and tests) can drive the
  // lifecycle directly. Other long-running requests (streaming chat) own
  // their own AbortController via AiStreamManager and do not register here.

  registerRequest(requestId: string, controller: AbortController): void {
    this.activeRequests.set(requestId, controller)
  }

  removeRequest(requestId: string): void {
    this.activeRequests.delete(requestId)
  }

  abort(requestId: string): void {
    const controller = this.activeRequests.get(requestId)
    if (controller) {
      controller.abort()
      this.activeRequests.delete(requestId)
      logger.info('Request aborted', { requestId })
    }
  }
}
