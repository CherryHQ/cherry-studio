import { fileURLToPath } from 'node:url'

import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ImageBlockParam } from '@anthropic-ai/sdk/resources/messages'

import { application } from '@application'
import { runtimeId, type Observation, type Subagent, type Thread } from '@cherrystudio/agent-runtime'
import type {
  ClaudeCodeRuntime,
  ClaudeControl,
  ClaudeObservation,
  ClaudeThreadHandle
} from '@cherrystudio/agent-runtime-claude-code'
import { agentService } from '@data/services/AgentService'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { modelService } from '@data/services/ModelService'
import { loggerService } from '@logger'
import { ChildThreadProjection } from '@main/ai/agentSession/ChildThreadProjection'
import {
  prepareNativeSubmission,
  lookupNativeInput,
  applyNativeSubmissionResult,
  bindNativeInput
} from '@main/ai/agentSession/nativeSubmission'
import { ThreadMessageProjection } from '@main/ai/agentSession/ThreadMessageProjection'
import { logAiFailure } from '@main/ai/errorReporting'
import { collectAssistantFileAttachments } from '@main/ai/messages/assistantFileAttachments'
import { collectFileAttachments, prepareChatMessages } from '@main/ai/messages/attachmentRouting'
import { materializeNativeFilePart } from '@main/ai/messages/fileProcessor'
import {
  appendAgentAttachmentPaths,
  withAgentContext,
  wrapAgentSessionDeliveryContent
} from '@main/ai/runtime/agentUserContent'
import { prepareClaudeBranch } from '@main/ai/runtime/claudeCode/claudeContext'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import type { ClaudeAgentToolPolicySnapshot } from '@main/ai/tools/adapters/claudeCode/agentTools'
import { probeReadable } from '@main/utils/file'
import {
  AgentImageLimitError,
  AGENT_IMAGE_EXTS,
  canBeClaudeNativeImagePart,
  countAgentImageFileParts,
  normalizeAgentImageLimitFailure,
  parseUpstreamImageLimit,
  resolveMaxAgentImages
} from '@shared/ai/agentImageLimits'
import type { AgentSessionSlashCommand } from '@shared/ai/agentSessionSlashCommands'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { CherryUIMessage, FileUIPart } from '@shared/data/types/message'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import { AsyncEventQueue } from '@shared/utils/async'
import { parseDataUrl } from '@shared/utils/dataUrl'
import { isVisionModel } from '@shared/utils/model'

import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeReconcileResult,
  AgentRuntimeTraceContext,
  AgentRuntimeCommand,
  AgentSessionRuntimeDriver,
  AgentSessionUsageCapture
} from '../types'
import {
  buildClaudeCodeQueryRequestForAgentSession,
  type ConnectionConfig,
  deriveConnectionConfig,
  toolPolicyFactsEqual
} from './agentSessionWarmup'
import { createClaudeCodeProcessDiagnostics, createSpawnClaudeCodeProcess } from './ClaudeCodeProcessManager'
import type { ConsumedWarmQuery } from './ClaudeCodeWarmQueryManager'
import { forkClaudeSession } from './claudeFork'
import { ClaudeMessageMetadata } from './ClaudeMessageMetadata'
import { ClaudePromptSuggestion } from './ClaudePromptSuggestion'
import { claudeControlEvents, ClaudeCodeResultError } from './ClaudeRuntimeState'
import { classifyClaudeFailure } from './failureFacts'
import { ClaudeForkCheckpointSchema } from './forkCheckpoint'
import { canSalvageClaudeOutput } from './processExitDiagnostics'
import {
  createClaudeCodeProcessExitError,
  isClaudeCodeProcessFailure,
  type ClaudeCodeProcessDiagnostics
} from './processExitDiagnostics'
import { resolveClaudeConfigDirectory } from './queryOptions'
import {
  AgentSessionWorkspaceError,
  disposeToolPolicySnapshot,
  prepareClaudeCodeWorkspaceDirectory,
  registerMcpSessionCatalogSync
} from './settingsBuilder'
import type { McpToolDisplayMetadata, ToolApprovalEmitterHolder } from './types'
import { claudeWorkspaceRelocation } from './workspaceRelocation'

const logger = loggerService.withContext('ClaudeCodeRuntimeDriver')
const HOST_MANAGED_SLASH_COMMANDS = new Set(['effort', 'fast'])

function isHostManagedSlashCommand(command: AgentSessionSlashCommand): boolean {
  return HOST_MANAGED_SLASH_COMMANDS.has(command.name)
}

function isFastSlashCommand(input: AgentRuntimeCommand): boolean {
  const text = (input.message.data.parts ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trimStart()

  return /^\/fast(?:\s|$)/i.test(text)
}

function getChangedRebuildFacts(baseline: ConnectionConfig, fresh: ConnectionConfig): string[] {
  const baselineFacts = baseline.rebuildFactFingerprints
  const freshFacts = fresh.rebuildFactFingerprints
  if (!baselineFacts || !freshFacts) return ['unknown']

  const changedFacts = [...new Set([...Object.keys(baselineFacts), ...Object.keys(freshFacts)])]
    .filter((name) => baselineFacts[name] !== freshFacts[name])
    .sort()
  return changedFacts.length > 0 ? changedFacts : ['unknown']
}

type ClaudeChildResource = {
  relation?: Subagent
  handle: ClaudeThreadHandle
  projection: ChildThreadProjection
}

class ClaudeCodeRuntimeConnection implements AgentRuntimeConnection {
  get contextId(): string | undefined {
    return this.context?.id
  }

  private readonly promptSuggestion = new ClaudePromptSuggestion()
  private readonly eventQueue = new AsyncEventQueue<AgentRuntimeEvent>()
  private readonly abortController = new AbortController()
  private runtime?: ClaudeCodeRuntime
  private handle?: ClaudeThreadHandle
  private readonly observations: Observation[] = []
  private readonly observationEnds: Promise<void>[] = []
  private nativeError?: unknown
  private processDiagnostics?: ClaudeCodeProcessDiagnostics
  private parkedQuery?: ConsumedWarmQuery
  private readonly rootProjections: ThreadMessageProjection[] = []
  private readonly rootContexts = new Map<string, ReturnType<typeof contexts.context>>()
  private context?: ReturnType<typeof prepareClaudeBranch>
  private readonly children = new Map<
    string,
    | { state: 'opening'; pending: Promise<ClaudeChildResource | undefined> }
    | { state: 'attached' | 'closing'; resource: ClaudeChildResource }
  >()
  private closing = false
  private readonly closingAccess = new AbortController()
  private closePromise?: Promise<void>
  /** Keep the effective child environment for native checkpoint capture. */
  private spawnOptions?: Options
  /** Session-scoped: dispatches every message for the connection's lifetime, resetting per turn. */
  private sdkModelId?: string
  private approvalEmitter?: ToolApprovalEmitterHolder
  private mcpToolMetadata?: Record<string, McpToolDisplayMetadata>
  private resumeToken?: string
  /** Submitted native image-block counts for provider result-boundary normalization. */
  private pendingImageCounts: Array<{ inputId: string; count: number }> = []
  /** Native placement signal (`input-boundary` steers + `placed` follow-ups): which submitted inputs the SDK has placed. */
  private placedImageInputIds = new Set<string>()
  /** Last submitted image count (legacy single-value view of the pending queue). */
  private lastImageCount?: number
  private readonly currentSources = new Set<string>()
  private toolPolicySnapshot?: ClaudeAgentToolPolicySnapshot
  private assistantFileToolsEnabled = false
  private sessionTornDown = false
  /** Staleness identity captured by the materialized request; live facts advance during reconcile. */
  private connectionConfig?: ConnectionConfig
  private _usageCapture?: AgentSessionUsageCapture
  /** Serializes reconciles per connection so push/pull can't interleave SDK and snapshot writes. */
  private reconcileChain: Promise<unknown> = Promise.resolve()

  readonly events = this.eventQueue
  get usageCapture(): AgentSessionUsageCapture | undefined {
    return this._usageCapture
  }

  constructor(private readonly input: AgentRuntimeConnectInput) {
    this.resumeToken = input.resumeToken
  }

  async start(): Promise<this> {
    // Route with the host-chosen model, not a fresh DB read: a live turn's connection must serve
    // the model captured when that turn was created, even if the agent was edited since.
    const request = await buildClaudeCodeQueryRequestForAgentSession(
      this.input.sessionId,
      this.resumeToken ?? messages.getLastRuntimeResumeToken(this.input.sessionId, this.input.branchHead),
      this.input.modelId,
      this.input.reasoningEffort ?? 'default',
      this.input.fastMode === true,
      this.input.knowledgeBaseIds,
      this.input.serviceTier,
      this.input.headless === true
    )
    if (!request) {
      throw new Error(`Unable to build Claude Code query options for agent session ${this.input.sessionId}`)
    }
    this.connectionConfig = request.connectionConfig
    this.approvalEmitter = request.settings.approvalEmitter
    this.assistantFileToolsEnabled = Boolean(request.settings.mcpServers?.['assistant-files'])
    this.context = prepareClaudeBranch(
      this.input.sessionId,
      resolveClaudeConfigDirectory(request.options.env),
      request.options.resume ?? this.input.nativeSessionId,
      this.input.branchHead
    )

    const traceEnv = await this.prepareTraceEnv()
    const coldProcessDiagnostics = createClaudeCodeProcessDiagnostics()
    const options: Options = {
      ...request.options,
      ...(request.options.resume || this.context.bindingState === 'bound'
        ? { resume: request.options.resume ?? this.context.nativeThreadId! }
        : { sessionId: this.context.nativeThreadId! }),
      ...(traceEnv
        ? {
            env: {
              ...request.options.env,
              ...traceEnv
            }
          }
        : {}),
      abortController: this.abortController,
      spawnClaudeCodeProcess: createSpawnClaudeCodeProcess(coldProcessDiagnostics)
    }
    // Env is part of the warm signature, so a traced turn asks with the OTEL vars merged in and can
    // never match a query parked without them: the mismatch cold-starts and disposes the stale park,
    // which is exactly what tracing needs (env is fixed at spawn). No trace branch required here.
    const consumedWarmQuery = await application.get('ClaudeCodeWarmQueryManager').consume({
      key: request.key,
      options,
      initializeTimeoutMs: request.initializeTimeoutMs,
      connectionRebuildSignature: request.connectionConfig?.rebuildSignature,
      credentialsFingerprint: request.credentialsFingerprint,
      usageCapture: request.usageCapture,
      knowledgeBaseIds: request.knowledgeBaseIds,
      notificationContext: request.notificationContext
    })
    this.parkedQuery = consumedWarmQuery

    // A matching warm process may have selected a different rotated key when
    // it was started. Its receipt, not the freshly materialized request's,
    // describes the credential that will actually serve this connection.
    this._usageCapture = consumedWarmQuery?.usageCapture ?? request.usageCapture
    this.processDiagnostics = consumedWarmQuery?.processDiagnostics ?? coldProcessDiagnostics
    this.spawnOptions = consumedWarmQuery
      ? { ...options, spawnClaudeCodeProcess: createSpawnClaudeCodeProcess(consumedWarmQuery.processDiagnostics) }
      : options
    const { createClaudeCodeRuntime } = await import('@cherrystudio/agent-runtime-claude-code')
    const { resume, cwd, ...nativeOptions } = options
    if (!cwd) throw new Error('Claude Code workspace is unavailable')
    const config = { ...nativeOptions, cwd }
    this.runtime = createClaudeCodeRuntime({
      backendId: runtimeId(this.context.backendId),
      configDir: resolveClaudeConfigDirectory(options.env),
      contextWindow: request.contextWindow,
      load: async () => config,
      onError: (error) => {
        this.nativeError = error
      }
    })
    const opened = resume
      ? await this.runtime.open({ backendId: runtimeId(this.context.backendId), id: runtimeId(resume) })
      : await this.runtime.create(config)
    if (opened.status !== 'confirmed') throw new Error(opened.error.message)
    this.handle = opened.value
    this.sdkModelId = request.sdkModelId
    this.mcpToolMetadata = request.settings.mcpToolMetadata
    // Session-scoped: it must exist before the query loop starts so `system/init` — which can land
    // before any turn opens — is dispatched independently of message projection.
    this.approvalEmitter = request.settings.approvalEmitter
    // Bind the approval emit once for the connection's lifetime — it only pushes into the connection
    // event queue, so it never varies per turn. (The prior per-turn rebind was the mirror of the
    // now-removed per-turn dispose; both gone, the emitter is plainly session-scoped.)
    this.bindApprovalEmitter()
    this.toolPolicySnapshot = request.settings.toolPolicySnapshot
    registerMcpSessionCatalogSync(
      this.input.sessionId,
      this.input.agentId,
      request.connectionConfig?.live.toolPolicy.mcps ?? [],
      this.mcpToolMetadata
    )
    await this.observeRoot(this.handle)
    if (consumedWarmQuery && !consumedWarmQuery.processDiagnostics.exited)
      throw new Error('Prewarmed process has no exit barrier')
    const started = this.handle.claude.start(
      consumedWarmQuery && {
        query: consumedWarmQuery.warmQuery,
        exited: consumedWarmQuery.processDiagnostics.exited!
      }
    )
    if (started.status !== 'confirmed') throw new Error(started.error.message)
    this.parkedQuery = undefined
    return this
  }

  private async prepareTraceEnv(): Promise<Record<string, string> | undefined> {
    if (!this.input.trace) return undefined
    return application.get('ClaudeCodeTraceBridgeService').prepareTrace(this.input.trace)
  }

  refreshTraceContext(context: AgentRuntimeTraceContext): void {
    application.get('ClaudeCodeTraceBridgeService').refreshTraceContext(context)
  }

  predictPrompt(signal: AbortSignal): Promise<string> {
    return this.promptSuggestion.read(signal)
  }

  async send(input: AgentRuntimeCommand): Promise<void> {
    this.promptSuggestion.clear()
    this.currentSources.clear()
    if (isFastSlashCommand(input)) {
      throw new Error('The /fast command is unavailable; use the host Fast control instead')
    }

    const merged = withAgentContext(input.message, input.context)
    // Prefer the host-admitted capability when present (even `undefined` for
    // uncapped): a cap published while the accepted turn opens must not reject
    // after persistence/ack. Absence (pre-existing callers) falls back to a
    // fresh lookup.
    const admittedMaxImages = 'admittedMaxImages' in input ? input.admittedMaxImages : undefined
    const hasAdmitted = 'admittedMaxImages' in input
    const sdkMessage = await toSdkUserMessage(merged, this.resumeToken, input.systemReminder, {
      supportsAttachmentReads: this.assistantFileToolsEnabled,
      supportsImages: resolveModelImageSupport(this.input.modelId),
      maxImages: hasAdmitted ? admittedMaxImages : resolveModelImageLimit(this.input.modelId)
    })
    // Remember for the provider result boundary: a later `result` failure
    // names only the limit, so the count must come from the submitted turn.
    // Record actual native image blocks (including replayed history) and keep
    // a queue so a text-only steer does not overwrite a pending image count.
    this.recordSubmittedImageCount(sdkMessage.message.content, merged, input.message.id)
    const contextId = this.context!.id
    const draft = prepareNativeSubmission(this.input.sessionId, input.message.id, contextId, 'follow-up', {
      text: JSON.stringify(sdkMessage.message.content),
      parts: input.message.data.parts
    })
    this.input.onInputPrepared?.(input.message.id, contextId)
    const result = await this.handle!.claude.submit(draft.inputId, sdkMessage.message.content, 'follow-up')
    this.eventQueue.push({ type: 'input-submission', contextId, result })
    applyNativeSubmissionResult(this.input.sessionId, contextId, result)
    if (result.status !== 'acknowledged')
      throw normalizeImageLimitRejection(result.error?.message ?? result.status, merged.data.parts)
  }

  lookupInput(contextId: string, inputId: string) {
    return lookupNativeInput(this.runtime!, this.input.sessionId, contextId, inputId)
  }

  redirect(input: AgentRuntimeCommand): boolean {
    this.promptSuggestion.clear()
    if (this.closing || !this.handle) return false
    void this.submitSteer(input).catch((error) => {
      logAiFailure(logger, 'Claude steer failed', error, 'agent.claude.steer', classifyClaudeFailure(error))
      this.eventQueue.push({ type: 'error', error })
    })
    return true
  }

  private async submitSteer(input: AgentRuntimeCommand): Promise<void> {
    const merged = withAgentContext(input.message, input.context)
    const hasAdmitted = 'admittedMaxImages' in input
    const admittedMaxImages = hasAdmitted ? input.admittedMaxImages : undefined
    const sdkMessage = await toSdkUserMessage(merged, this.resumeToken, input.systemReminder, {
      supportsAttachmentReads: this.assistantFileToolsEnabled,
      supportsImages: resolveModelImageSupport(this.input.modelId),
      maxImages: hasAdmitted ? admittedMaxImages : resolveModelImageLimit(this.input.modelId)
    })
    this.recordSubmittedImageCount(sdkMessage.message.content, merged, input.message.id)
    const contextId = this.context!.id
    const draft = prepareNativeSubmission(this.input.sessionId, input.message.id, contextId, 'steer', {
      text: JSON.stringify(sdkMessage.message.content),
      parts: input.message.data.parts
    })
    this.input.onInputPrepared?.(input.message.id, contextId)
    const result = await this.handle!.claude.submit(draft.inputId, sdkMessage.message.content, 'steer')
    this.eventQueue.push({ type: 'input-submission', contextId, result })
    applyNativeSubmissionResult(this.input.sessionId, contextId, result)
    if (result.status !== 'acknowledged')
      throw normalizeImageLimitRejection(result.error?.message ?? result.status, merged.data.parts)
  }

  /**
   * Record the actual submitted native image blocks (including replayed history)
   * so the provider `result` boundary can correlate a limit failure with native
   * request membership. Queued so a text-only steer does not overwrite a pending
   * image count before native placement. Entries carry their product input id so
   * native placement (steer `input-boundary` + follow-up `placed` facts) can
   * retire exactly the placed requests.
   */
  private recordSubmittedImageCount(
    content: SDKUserMessage['message']['content'],
    merged: AgentSessionMessageEntity,
    inputId?: string
  ): void {
    const blocks = Array.isArray(content) ? content.filter((part) => part.type === 'image').length : 0
    // Fall back to merged file-part count when no native blocks were produced
    // (e.g. vision disabled or all images took the path fallback) so a later
    // limit failure still carries the attached count.
    const count = blocks > 0 ? blocks : countAgentImageFileParts(merged.data.parts)
    const key = typeof inputId === 'string' && inputId ? inputId : `anon:${this.pendingImageCounts.length}`
    this.pendingImageCounts.push({ inputId: key, count })
    this.lastImageCount = count
  }

  /**
   * Consume the pending image count that best matches a provider `result`
   * failure using native placement membership (steer `input-boundary` plus
   * follow-up `placed` facts).
   * Only placed inputs can have failed: unplaced steers stay queued and the
   * provider's own limit text is kept when the placed count cannot explain the
   * failure (e.g. a text-only request that grew via tools after submission).
   * Settled inputs are retired even when the count is unknown so stale counts
   * are not reused. Returns undefined when no pending submission exists or
   * when attribution is unknown.
   */
  private consumeImageCountForResult(failure: unknown): number | undefined {
    if (this.pendingImageCounts.length === 0) return this.lastImageCount
    const count = consumePlacedImageCount(this.pendingImageCounts, this.placedImageInputIds, failure)
    if (count !== undefined) this.lastImageCount = count
    return count
  }

  async reconcile(input: {
    modelId: UniqueModelId
    reasoningEffort?: AgentRuntimeConnectInput['reasoningEffort']
    serviceTier?: AgentRuntimeConnectInput['serviceTier']
    knowledgeBaseIds?: readonly string[]
    fastMode?: boolean
    headless?: boolean
  }): Promise<AgentRuntimeReconcileResult> {
    // Serialize per connection: a push (agent-updated) and a pull (fresh-turn check) reconciling
    // concurrently could interleave the SDK setPermissionMode and snapshot writes, leaving the local
    // gate and the subprocess on different policies.
    const run = this.reconcileChain.then(
      () => this.reconcileOnce(input),
      () => this.reconcileOnce(input)
    )
    this.reconcileChain = run.catch(() => undefined)
    return run
  }

  private async reconcileOnce(input: {
    modelId: UniqueModelId
    reasoningEffort?: AgentRuntimeConnectInput['reasoningEffort']
    serviceTier?: AgentRuntimeConnectInput['serviceTier']
    knowledgeBaseIds?: readonly string[]
    fastMode?: boolean
    headless?: boolean
  }): Promise<AgentRuntimeReconcileResult> {
    if (!this.handle) return 'rebuild'
    const derived = await deriveConnectionConfig(
      this.input.sessionId,
      input.modelId,
      input.reasoningEffort ?? 'default',
      input.fastMode === true,
      input.knowledgeBaseIds,
      input.serviceTier,
      input.headless === true
    )
    if (!derived.ok) return 'invalid'
    const baseline = this.connectionConfig
    // A connection without its materialized baseline cannot prove what the subprocess serves.
    if (!baseline) return 'rebuild'

    const fresh = derived.config
    let patched = false
    // Apply the live tool-policy facts BEFORE the rebuild verdict, mid-turn included: the SDK applies
    // a permission-mode change from the next tool call without interrupting the running turn.
    if (!toolPolicyFactsEqual(baseline.live.toolPolicy, fresh.live.toolPolicy)) {
      try {
        const agent = agentService.getAgent(this.input.agentId)
        if (!agent) return 'invalid'
        const permissionMode = fresh.live.toolPolicy.permissionMode ?? 'default'
        if (baseline.live.toolPolicy.permissionMode !== fresh.live.toolPolicy.permissionMode) {
          const changed = await this.handle.claude.setPermissionMode(permissionMode)
          if (changed.status !== 'confirmed') throw new Error(changed.error.message)
          // Approval must use the confirmed mode while the tool catalog is refreshing.
          this.toolPolicySnapshot?.setPermissionMode(permissionMode)
        }
        await this.toolPolicySnapshot?.update(agent)
      } catch (error) {
        logger.warn('Live tool-policy apply failed during reconcile', { sessionId: this.input.sessionId, error })
        return 'failed'
      }
      this.connectionConfig = { ...baseline, live: fresh.live }
      patched = true
    }

    if (baseline.rebuildSignature !== fresh.rebuildSignature) {
      logger.info('Connection configuration requires rebuild', {
        sessionId: this.input.sessionId,
        changedFacts: getChangedRebuildFacts(baseline, fresh),
        baselineSignature: baseline.rebuildSignature.slice(0, 12),
        freshSignature: fresh.rebuildSignature.slice(0, 12)
      })
      return 'rebuild'
    }
    return patched ? 'patched' : 'current'
  }

  async getContextUsage() {
    return this.handle
      ? this.handle.contextUsage()
      : {
          status: 'unknown' as const,
          error: { operation: 'contextUsage', code: 'not-connected', message: 'Runtime not connected' }
        }
  }

  async getSupportedCommands(): Promise<AgentSessionSlashCommand[] | null> {
    if (!this.handle) return null
    try {
      const result = await this.handle.claude.supportedCommands()
      return result.status === 'confirmed'
        ? result.value.filter((command) => !isHostManagedSlashCommand(command))
        : null
    } catch (error) {
      logger.warn('getSupportedCommands failed', { sessionId: this.input.sessionId, error })
      return null
    }
  }

  async stopTask(taskId: string): Promise<boolean> {
    if (!this.handle) return false
    try {
      const result = await this.handle.claude.stopTask(taskId)
      return result.status === 'confirmed'
    } catch (error) {
      logger.warn('stopTask failed', { sessionId: this.input.sessionId, taskId, error })
      return false
    }
  }

  async drainChildWrites(): Promise<void> {
    await this.runtime?.settled()
    await Promise.all(this.observations.map((observation) => observation.drain()))
    if (this.closing) {
      await this.closePromise
      return
    }
    for (const child of await this.childResources()) await child.projection.drain()
  }

  async interrupt(): Promise<void> {
    this.promptSuggestion.clear()
    const interrupt = this.handle?.interrupt
    if (!interrupt) return
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        interrupt(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Claude interruption timed out')), 3_000)
        })
      ])
      if (result.status !== 'confirmed') throw new Error(result.error.message)
    } catch (error) {
      logger.warn('Claude interruption unconfirmed; closing the native owner', {
        sessionId: this.input.sessionId,
        error
      })
      await this.close()
    } finally {
      clearTimeout(timer)
    }
  }

  close(): Promise<void> {
    return (this.closePromise ??= this.closeQuery().catch((error) => {
      this.closePromise = undefined
      throw error
    }))
  }

  async closeForEdit(): Promise<void> {
    await this.close()
  }

  private async closeQuery(): Promise<void> {
    this.promptSuggestion.clear()
    this.closing = true
    this.closingAccess.abort()
    if (this.parkedQuery) {
      await this.parkedQuery.warmQuery[Symbol.asyncDispose]()
      await this.parkedQuery.processDiagnostics.exited
      this.parkedQuery = undefined
    }
    const closed = await this.runtime?.shutdown()
    if (closed && closed.status !== 'confirmed') {
      this.closePromise = undefined
      throw new Error(closed.error.message)
    }
    await this.childResources()
    await Promise.all(this.observationEnds)
    await Promise.all(this.observations.map((observation) => observation.drain()))
    for (const [key, child] of this.children) {
      const resource = child.state === 'opening' ? await child.pending : child.resource
      if (!resource) continue
      this.children.set(key, { state: 'closing', resource })
      await resource.projection.stop()
      await resource.handle.release()
      this.children.delete(key)
    }
    await Promise.all(this.observations.map((observation) => observation.stop()))
    await Promise.all(this.rootProjections.map((projection) => projection.close()))
    this.teardownSession()
    this.eventQueue.close()
  }

  private async observeRoot(handle: ClaudeThreadHandle): Promise<void> {
    const metadata = new ClaudeMessageMetadata(this.mcpToolMetadata)
    const projection = new ThreadMessageProjection(handle.thread, metadata.decorate)
    const contextId = this.context!.id
    this.rootContexts.set(handle.thread.id, this.context!)
    this.rootProjections.push(projection)
    let legacy: ClaudeObservation['legacy']
    let end!: () => void
    this.observationEnds.push(
      new Promise<void>((resolve) => {
        end = resolve
      })
    )
    const observation = await handle.claude.observe(async (batch) => {
      this.promptSuggestion.accept(batch)
      legacy = batch.legacy ?? legacy
      const currentLegacy = legacy
      this.publishInvocations(batch, 'current-turn')
      let publish = () => {}
      try {
        const refresh = metadata.accept(batch) ? projection.snapshot().messages.map((message) => message.id) : []
        const changed = await projection.accept(batch.events, refresh)
        for (const event of batch.events) {
          const inputs = event.type === 'snapshot' ? event.inputs : event.type === 'input.changed' ? [event.input] : []
          for (const input of inputs) {
            const messageId = bindNativeInput(this.input.sessionId, contextId, input)
            // Native placement for image attribution must include ordinary
            // follow-up sends, not just steers: the adapter emits
            // `input-boundary` only for steers, but every placed input carries
            // the `placed` fact (see owner `requesting` membership). Track it
            // here so a two-PNG follow-up failure attributes to its own count
            // instead of falling back to a generic error.
            // Outcomes precede the terminal result batch, so membership must
            // survive until result handling retires the settled input: deleting
            // on outcome would drop a text-only placed request that grew via
            // tools before its `result` failure arrives, letting the fallback
            // consume an unplaced steer's count and report it as sent.
            trackPlacedImageInput(this.placedImageInputIds, messageId ?? input.inputId, input)
          }
        }
        const snapshot = batch.events.some((event) => event.type === 'snapshot')
        const live = changed.filter((message) => batch.live?.includes(message.id)).map((message) => message.id)
        const replaces = {
          ...batch.replaces,
          ...Object.fromEntries(
            batch.events.flatMap((event) =>
              event.type === 'message.upsert' ? (event.replaces ?? []).map((ref) => [ref.id, event.message.id]) : []
            )
          )
        }
        const emit = (messages: readonly CherryUIMessage[], owned: readonly string[]) => {
          for (const id of owned) this.currentSources.add(id)
          for (const [previous, replacement] of Object.entries(replaces)) {
            if (this.currentSources.delete(previous)) this.currentSources.add(replacement)
          }
          this.eventQueue.push({
            type: 'message-projection',
            projection: {
              contextId,
              legacy: currentLegacy,
              messages,
              live: owned,
              refresh: [...new Set([...refresh, ...changed.map((message) => message.id)])],
              replaces,
              removed: [
                ...batch.retracted,
                ...batch.events.flatMap((event) => (event.type === 'message.remove' ? [event.ref.id] : []))
              ]
            }
          })
        }
        publish = () => {
          emit(snapshot ? projection.snapshot().messages : changed, live)
          publish = () => {}
        }
        const terminal = await this.acceptRoot(batch, projection, contextId)
        publish()
        for (const event of terminal) this.eventQueue.push(event)
        if (batch.events.some((event) => event.type === 'closed' && event.reason !== 'shutdown') && !this.closing)
          this.eventQueue.close()
      } catch (error) {
        publish()
        logAiFailure(logger, 'Claude projection failed', error, 'agent.claude.adapt', {
          source: 'application',
          kind: 'defect',
          reason: 'stream_adapter_failed',
          outcome: 'failed',
          runtime: 'claude-code'
        })
        this.eventQueue.push({ type: 'error', error })
      } finally {
        if (batch.events.some((event) => event.type === 'closed')) end()
      }
    })
    if (observation.status !== 'confirmed') {
      end()
      throw new Error(observation.error.message)
    }
    this.observations.push(observation.value)
    this.restoreChildren(this.context!)
  }

  private async acceptRoot(
    batch: ClaudeObservation,
    projection: ThreadMessageProjection,
    contextId: string
  ): Promise<AgentRuntimeEvent[]> {
    const terminal: AgentRuntimeEvent[] = []
    for (const event of batch.events) {
      if (event.type === 'input.changed') this.eventQueue.push({ type: 'input-state', contextId, input: event.input })
      if (event.type === 'context.changed') this.eventQueue.push({ type: 'context-usage', result: event.result })
      if (event.type === 'snapshot' && event.contextUsage)
        this.eventQueue.push({ type: 'context-usage', result: event.contextUsage })
      if (event.type === 'subagent.upsert') this.discoverChild(event.subagent)
      if (event.type === 'snapshot') for (const child of event.subagents ?? []) this.discoverChild(child)
      if (event.type === 'closed' && event.reason !== 'shutdown' && !this.closing) {
        const error = this.nativeError ?? new Error(`Claude observation ended: ${event.reason}`)
        const surfaced =
          isClaudeCodeProcessFailure(error, this.processDiagnostics) && this.processDiagnostics
            ? createClaudeCodeProcessExitError(error, this.processDiagnostics)
            : error
        const bufferedChars = projection
          .snapshot()
          .messages.filter((message) => message.role === 'assistant' && this.currentSources.has(message.id))
          .flatMap((message) => message.parts)
          .reduce((length, part) => length + (part.type === 'text' ? part.text.length : 0), 0)
        const salvaged = canSalvageClaudeOutput(surfaced, bufferedChars, batch.state?.aborted === true)
        logAiFailure(
          logger,
          'Claude Code query failed',
          surfaced,
          'agent.claude.prompt',
          classifyClaudeFailure(error, {
            recovered: salvaged,
            cancelled: batch.state?.aborted,
            process: this.processDiagnostics
          })
        )
        terminal.push(salvaged ? { type: 'turn-complete' } : { type: 'error', error: surfaced })
      }
    }
    for (const control of batch.controls ?? []) {
      for (const event of claudeControlEvents(control)) {
        if (event.type === 'background-results') {
          terminal.push(event)
          continue
        }
        this.eventQueue.push(
          event.type === 'supported-commands'
            ? { ...event, commands: event.commands.filter((command) => !isHostManagedSlashCommand(command)) }
            : event
        )
      }
      const result = await this.handleControl(control, contextId)
      if (result) terminal.push(result)
    }
    return terminal
  }

  private async handleControl(control: ClaudeControl, contextId: string): Promise<AgentRuntimeEvent | undefined> {
    if (control.type === 'input-boundary') {
      // Native placement signal (0.3.311 `requesting` membership): these inputs
      // share the next response. Retire result attribution by membership so an
      // unplaced steer's count is never reported as sent.
      for (const inputId of control.inputIds) this.placedImageInputIds.add(inputId)
      this.eventQueue.push({ type: 'steer-boundary', inputIds: control.inputIds })
      this.currentSources.clear()
    } else if (control.type === 'autonomous-turn-state' && control.state === 'started') {
      this.currentSources.clear()
    } else if (control.type === 'session') {
      if (contextId !== this.context?.id) return
      if (control.sessionId !== this.handle!.claude.sessionId) {
        const opened = await this.runtime!.open({
          backendId: this.handle!.thread.backendId,
          id: runtimeId(control.sessionId)
        })
        if (opened.status !== 'confirmed') throw new Error(opened.error.message)
        let context: NonNullable<typeof this.context>
        try {
          context = prepareClaudeBranch(
            this.input.sessionId,
            resolveClaudeConfigDirectory(this.spawnOptions?.env),
            control.sessionId
          )
        } catch (error) {
          await opened.value.release()
          throw error
        }
        this.context = context
        this.handle = opened.value
        await this.observeRoot(this.handle)
      }
      this.context = contexts.bindContext(this.context.id, control.sessionId)
      this.updateResumeToken(control.sessionId)
    } else if (control.type === 'archive-changed') {
      await this.handle!.claude.archive()
    } else if (control.type === 'diagnostic') {
      logger.warn(control.message, { detail: control.detail })
    } else if (control.type === 'result') {
      if (control.sessionId !== this.handle?.claude.sessionId) return
      if (control.failure) {
        // Provider result failures bypass the admission normalizer: the
        // workspace owner already acknowledged `submit` before yielding the
        // input to the SDK, so an image-limit rejection surfaces here as a
        // `ClaudeCodeResultError`. Normalize to the typed limit error with
        // sent-aware wording (the request was already sent). Use the pending
        // queue so a text-only steer cannot overwrite a pending image count,
        // and include replayed blocks via the recorded native submission.
        const count = this.consumeImageCountForResult(control.failure)
        const normalized = normalizeResultImageLimitFailure(control.failure, count)
        const error = normalized ?? new ClaudeCodeResultError(control.failure)
        logAiFailure(logger, 'Claude Code result failed', error, 'agent.claude.prompt', classifyClaudeFailure(error))
        return { type: 'error', error }
      }
      if (!control.terminal) return
      // Turn complete: retire the placed submissions that share this response,
      // preserving unplaced steers for the next result. Falls back to the
      // oldest submission when no placement was observed.
      if (this.pendingImageCounts.length > 0) {
        const placed = this.placedImageInputIds
        if (this.pendingImageCounts.some((entry) => placed.has(entry.inputId))) {
          this.pendingImageCounts = this.pendingImageCounts.filter((entry) => !placed.has(entry.inputId))
          for (const inputId of [...placed]) {
            if (!this.pendingImageCounts.some((entry) => entry.inputId === inputId)) placed.delete(inputId)
          }
        } else {
          this.pendingImageCounts.shift()
        }
        this.lastImageCount = this.pendingImageCounts[this.pendingImageCounts.length - 1]?.count
      }
      this.updateResumeToken(control.sessionId)
      const checkpoint = ClaudeForkCheckpointSchema.safeParse({
        runtime: 'claude-code',
        runtimeSessionId: control.sessionId,
        messageUuid: control.messageUuid,
        configDir: resolveClaudeConfigDirectory(this.spawnOptions?.env)
      })
      return { type: 'turn-complete', forkAnchor: checkpoint.success ? { checkpoint: checkpoint.data } : undefined }
    }
    return undefined
  }

  private discoverChild(relation: Subagent): void {
    if (relation.child) void this.observeChild(relation.child)
  }

  private restoreChildren(parent: ReturnType<typeof contexts.context>): void {
    for (const context of contexts.children(parent.id)) {
      if (context.bindingState !== 'bound' || !context.nativeThreadId || !context.spawnToolCallId) continue
      void this.observeChild(
        { backendId: runtimeId(context.backendId), id: runtimeId(context.nativeThreadId) },
        undefined,
        context
      )
    }
  }

  private async childResources(): Promise<ClaudeChildResource[]> {
    const resources: ClaudeChildResource[] = []
    for (const child of this.children.values()) {
      const resource = child.state === 'opening' ? await child.pending : child.resource
      if (resource) resources.push(resource)
    }
    return resources
  }

  private async observeChild(
    thread: Thread,
    granted?: ClaudeThreadHandle,
    saved?: ReturnType<typeof contexts.context>
  ): Promise<ClaudeChildResource | undefined> {
    const key = JSON.stringify([thread.backendId, thread.id])
    const existing = this.children.get(key)
    if (existing) {
      await granted?.release()
      if (existing.state === 'closing') {
        await existing.resource.projection.stop()
        await existing.resource.handle.release()
        this.children.delete(key)
        return this.observeChild(thread, undefined, saved)
      }
      return existing.state === 'opening' ? existing.pending : existing.resource
    }
    if (this.closing) {
      await granted?.release()
      return undefined
    }
    let handle: ClaudeThreadHandle | undefined
    let resource: ClaudeChildResource | undefined
    let end = () => {}
    const pending = Promise.resolve()
      .then(async () => {
        if (granted) handle = granted
        else {
          const opened = await this.runtime!.open(thread)
          if (opened.status !== 'confirmed') throw new Error(opened.error.message)
          handle = opened.value
        }
        const relation = handle.claude.relation()
        let context = saved
        if (!context) {
          if (!relation) throw new Error('Native child parent is unavailable')
          const parent =
            this.rootContexts.get(relation.parent.id) ?? (await this.observeChild(relation.parent))?.projection.context
          if (!parent) throw new Error('Native child owner context is unavailable')
          context = contexts.children(parent.id).find((child) => child.nativeThreadId === thread.id)
          if (!context) {
            if (!relation.origin) throw new Error('Native child creation origin is unavailable')
            context = contexts.child(
              parent.id,
              thread.id,
              relation.origin.toolCallId,
              relation.origin.description ?? thread.id
            )
          }
        }
        const childContext = context
        const access = handle
        // The SDK stores the child prompt without forwarding it in the live conversation feed.
        await access.claude.archive()
        const metadata = new ClaudeMessageMetadata(this.mcpToolMetadata)
        const responseOwners = new Set<string>()
        this.observationEnds.push(
          new Promise<void>((resolve) => {
            end = resolve
          })
        )
        const projection = new ChildThreadProjection(
          childContext,
          {
            ...access,
            observe: async (sink) => {
              const result = await access.claude.observe(async (batch) => {
                this.publishInvocations(batch, 'stateless')
                try {
                  const refresh = metadata.accept(batch)
                  for (const event of batch.events) {
                    await sink(event)
                    if (event.type === 'subagent.upsert') this.discoverChild(event.subagent)
                    if (event.type === 'snapshot') for (const child of event.subagents ?? []) this.discoverChild(child)
                  }
                  if (refresh) await projection.refreshDecoration()
                  for (const control of batch.controls ?? []) {
                    if (control.type !== 'response-start' || !control.messageUuid) continue
                    await projection.flush()
                    const productId = contexts.context(childContext.id).checkpointMapping?.child?.sources
                    const ownerId = productId?.[control.messageUuid]
                    if (ownerId && !responseOwners.has(control.responseId)) {
                      responseOwners.add(control.responseId)
                      this.eventQueue.push({
                        type: 'response-start',
                        responseId: control.responseId,
                        messageId: ownerId
                      })
                    }
                  }
                } catch (error) {
                  end()
                  throw error
                } finally {
                  if (batch.events.some((event) => event.type === 'closed')) end()
                }
              })
              if (result.status !== 'confirmed') end()
              return result
            }
          },
          async () => {
            const archive = await access.claude.archive({ refresh: false })
            if (archive.status !== 'confirmed') throw new Error(archive.error.message)
            return {
              messages: archive.value.content,
              legacy: archive.value.legacy,
              removed: archive.value.retracted,
              aliases: Object.fromEntries(archive.value.content.map((message) => [message.id, message.id]))
            }
          },
          metadata.decorate
        )
        resource = { relation, handle: access, projection }
        await projection.attach()
        this.children.set(key, { state: 'attached', resource })
        this.restoreChildren(childContext)
        return resource
      })
      .catch(async (error) => {
        end()
        logger.error('Claude child observation failed', { thread, error })
        if (resource) {
          try {
            await resource.projection.stop()
          } catch (flushError) {
            this.children.set(key, { state: 'closing', resource })
            logger.error('Failed to flush Claude child attachment', { thread, error: flushError })
            return undefined
          }
        }
        await handle?.release()
        this.children.delete(key)
        return undefined
      })
    this.children.set(key, { state: 'opening', pending })
    return pending
  }

  async childProjection(toolCallId: string) {
    if (this.closing) return undefined
    const known = (await this.childResources()).filter(
      (child) => (child.relation?.origin?.toolCallId ?? child.projection.context.spawnToolCallId) === toolCallId
    )
    if (known.length > 1) return undefined
    if (known[0]) {
      const projection = known[0].projection
      await projection.attach()
      return { snapshot: () => projection.snapshot(), subscribe: projection.subscribe.bind(projection) }
    }
    if (this.closing || !this.handle) return undefined
    const saved = contexts.findChild(this.input.sessionId, toolCallId)
    let child: ClaudeChildResource | undefined
    if (saved?.bindingState === 'bound' && saved.nativeThreadId && saved.backendId === this.context?.backendId) {
      child = await this.observeChild(
        { backendId: runtimeId(saved.backendId), id: runtimeId(saved.nativeThreadId) },
        undefined,
        saved
      )
    } else {
      const opened = await this.handle.claude.openChild(toolCallId, this.closingAccess.signal)
      if (opened.status !== 'confirmed') return undefined
      child = await this.observeChild(opened.value.relation.child, opened.value.handle)
    }
    if (!child) return undefined
    await child.projection.attach()
    return { snapshot: () => child.projection.snapshot(), subscribe: child.projection.subscribe.bind(child.projection) }
  }

  private bindApprovalEmitter(): void {
    if (!this.approvalEmitter) return
    this.approvalEmitter.emit = (request) => this.eventQueue.push({ type: 'tool-approval-request', request })
    this.approvalEmitter.emitInput = (request) =>
      this.eventQueue.push({
        type: 'chunk',
        chunk: {
          type: 'tool-input-available',
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          input: request.input,
          providerExecuted: true,
          dynamic: true
        }
      })
  }

  /**
   * Tear down all session-scoped resources. This is the ONLY place they are disposed — wired only to
   * close()/the query-loop error path, never to a turn boundary. Centralising disposal here is what
   * keeps the lifetime correct: there is no per-resource dispose for a turn handler to misplace.
   * Runs ONCE per connection: the second of the close/query-loop-error pair must no-op, because a
   * successor connection for the same session (e.g. after a model edit reconnect) may have registered
   * fresh session-keyed state by then — approval registry entries, tool-policy snapshot — and a
   * repeated by-id dispose would destroy the successor's state, not ours.
   */
  private teardownSession(): void {
    if (this.sessionTornDown) return
    this.sessionTornDown = true
    this.approvalEmitter?.dispose?.()
    disposeToolPolicySnapshot(this.input.sessionId)
  }

  private updateResumeToken(resumeToken: string): void {
    if (resumeToken === this.resumeToken) return
    this.resumeToken = resumeToken
    this.eventQueue.push({ type: 'resume-token', token: resumeToken })
  }

  private publishInvocations(batch: ClaudeObservation, messageAssociation: 'current-turn' | 'stateless'): void {
    if (this._usageCapture?.owner !== 'agent-sdk') return
    for (const { usage, ...invocation } of batch.invocations ?? []) {
      const noCacheTokens = usage?.input_tokens ?? 0
      const cacheReadTokens = usage?.cache_read_input_tokens ?? 0
      const cacheWriteTokens = usage?.cache_creation_input_tokens ?? 0
      const inputTokens = noCacheTokens + cacheReadTokens + cacheWriteTokens
      const outputTokens = usage?.output_tokens ?? 0
      this.eventQueue.push({
        type: 'usage',
        invocation: {
          ...invocation,
          requestId: `claude-agent:${invocation.responseId}`,
          model: invocation.model ?? this.sdkModelId ?? this.input.modelId,
          ...(usage
            ? {
                usage: {
                  inputTokens,
                  outputTokens,
                  totalTokens: inputTokens + outputTokens,
                  noCacheTokens,
                  cacheReadTokens,
                  cacheWriteTokens
                }
              }
            : {}),
          messageAssociation
        }
      })
    }
  }
}

/**
 * Whether the turn's model accepts native image input. Unresolvable models keep the
 * legacy always-native behavior instead of silently degrading images to OCR text.
 */
function resolveModelImageSupport(uniqueModelId: UniqueModelId): boolean {
  try {
    const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
    return isVisionModel(modelService.getByKey(providerId, modelId))
  } catch (error) {
    logger.warn('Failed to resolve model for image support; assuming vision-capable', {
      uniqueModelId,
      error
    })
    return true
  }
}

/**
 * Capability-driven multi-image limit for the turn's model (#20030).
 * Unresolvable models keep the legacy unlimited behavior; only a declared
 * limit enforces a pre-send rejection.
 */
function resolveModelImageLimit(uniqueModelId: UniqueModelId): number | undefined {
  try {
    const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
    return resolveMaxAgentImages(modelService.getByKey(providerId, modelId))
  } catch (error) {
    logger.warn('Failed to resolve model for image limit; assuming unlimited', {
      uniqueModelId,
      error
    })
    return undefined
  }
}

/**
 * Convert an SDK admission rejection into the image-limit error shape when its
 * text names an upstream image cap the turn exceeds. Anything else passes
 * through untouched.
 */
function normalizeImageLimitRejection(message: string | undefined, parts: readonly unknown[] | undefined): Error {
  const failure = new Error(message ?? 'unknown')
  return (
    normalizeAgentImageLimitFailure(failure, countAgentImageFileParts(parts), { runtime: 'claude-code' }) ?? failure
  )
}

/**
 * Consume the pending image count that best matches a provider `result`
 * failure. Exported for regression coverage: the queue holds submitted native
 * block counts in order, and a later `result` failure names only the limit.
 * The oldest over-limit submission wins (not the maximum), so a two-image
 * failure while a five-image steer is still queued unplaced reports two and
 * preserves the steer's entry. Unrelated failures (no parsed limit) settle
 * the oldest submission (FIFO, matching turn-complete `shift`), so an
 * unrelated failure settling a five-image request while a text steer waits
 * drops five and preserves the steer's zero for the next limit failure.
 * Mutates `pending` in place (splice/shift).
 *
 * When the oldest submission cannot explain the failure (it carries images
 * but stays within the parsed limit), the request may have grown after
 * submission — a tool can attach another image mid-turn — so the actual sent
 * count is unknown. Claiming a later unplaced steer's count would misattribute
 * the failure and consume its entry, so this preserves the queue and returns
 * `undefined` so the caller keeps the provider's own limit text. A leading
 * text-only entry (`0`) can never fail with an image cap, so the search skips
 * it to find the placed image request it precedes.
 *
 * TODO(#20030): correlate with native request UUIDs (`input-boundary` /
 * `requesting` membership from the 0.3.311 adapter) instead of order when
 * placement tracking is available.
 */
export function consumePendingImageCount(pending: number[], failure: unknown): number | undefined {
  if (pending.length === 0) return undefined
  const message =
    typeof failure === 'string'
      ? failure
      : failure instanceof Error
        ? failure.message
        : typeof (failure as { message?: unknown }).message === 'string'
          ? String((failure as { message?: unknown }).message)
          : undefined
  const limit = parseUpstreamImageLimit(message)
  if (limit !== undefined) {
    // Oldest-first: the provider reports the placed request, and queued
    // steers have not been placed yet (see placement contract in
    // packages/agent-runtime-claude-code/README).
    if (pending[0] > limit) {
      const [count] = pending.splice(0, 1)
      return count
    }
    // A leading text-only entry can never trip an image cap, so a later
    // over-limit must be the placed image request it precedes.
    if (pending[0] === 0) {
      for (let i = 1; i < pending.length; i++) {
        if (pending[i] > limit) {
          const [count] = pending.splice(i, 1)
          return count
        }
      }
    }
    // Otherwise the oldest carries images but stays within the parsed limit:
    // it may have grown via tools after submission, so the actual sent count
    // is unknown. Preserve the queue (notably an unplaced steer's count) and
    // let the caller keep the provider's limit text instead of claiming an
    // unplaced count was sent.
    return undefined
  }
  return pending.shift()
}

/**
 * Track native placement for image attribution (#20030).
 * Adds the input when its facts include `placed` and never removes on
 * outcome: input outcomes precede the terminal result batch, so membership
 * must survive until `consumePlacedImageCount` (failure) or turn-complete
 * (success) retires the settled input. Removing on outcome would drop a
 * text-only placed request that grew via tools past the provider cap before
 * its `result` failure arrives, letting the no-placement fallback consume an
 * unplaced steer's count and misreport it as sent.
 * Exported for regression coverage of the outcome-before-result sequence.
 */
export function trackPlacedImageInput(
  placed: Set<string>,
  placedId: string | undefined,
  input: { facts: readonly string[]; outcome?: unknown }
): void {
  if (placedId && input.facts.includes('placed')) placed.add(placedId)
}

/**
 * Membership-aware result attribution for the Claude driver (#20030).
 * `pending` holds submitted inputs in order with their product input ids;
 * `placed` is native request membership: `input-boundary` steers plus
 * ordinary follow-up sends observed via their `placed` fact (0.3.311
 * `requesting` signal). Only placed inputs share the native response that
 * failed.
 *
 * - Limit failures: the oldest placed over-limit entry wins when a single
 *   placed input carries images; unplaced steers are never reported as sent.
 *   When no placement has been observed yet (e.g. the result arrives before
 *   the membership batch), fall back to oldest-first over-limit attribution
 *   so an ordinary two-image follow-up still yields typed detail. When the
 *   oldest placed entry cannot explain the failure (text-only `0` or
 *   within-limit images that may have grown via tools after submission),
 *   the actual sent count is unknown — retire all settled inputs and return
 *   `undefined` so the caller keeps the provider's own limit text while
 *   preserving unplaced steers. When several placed inputs each carry images
 *   (e.g. a one-image prompt plus a two-image steer sharing one rejected
 *   continuation), the native request may combine them, so no single entry's
 *   count is a reliable sent total: retire all settled inputs and return
 *   `undefined` to preserve the provider text.
 * - Unrelated failures (no parsed limit): settle placed entries response-scoped
 *   (FIFO among placed, matching turn-complete), preserving unplaced steers
 *   for the next limit failure. With no placement observed, falls back to the
 *   oldest submission. A terminal result settles every placed input sharing
 *   that response, so retire all placed entries and preserve unplaced inputs.
 *
 * Mutates `pending` and `placed` in place.
 */
export function consumePlacedImageCount(
  pending: Array<{ inputId: string; count: number }>,
  placed: Set<string>,
  failure: unknown
): number | undefined {
  if (pending.length === 0) return undefined
  const message =
    typeof failure === 'string'
      ? failure
      : failure instanceof Error
        ? failure.message
        : typeof (failure as { message?: unknown }).message === 'string'
          ? String((failure as { message?: unknown }).message)
          : undefined
  const limit = parseUpstreamImageLimit(message)
  if (limit !== undefined) {
    const placedInOrder = pending.filter((entry) => placed.has(entry.inputId))
    if (placedInOrder.length === 0) {
      // No native membership observed yet (ordinary follow-up before the
      // `requesting` batch propagates): attribute oldest-first so a two-image
      // follow-up with a one-image cap still yields typed after-send detail.
      // A leading text-only `0` can never trip the cap, so skip it to reach
      // the placed image request it precedes.
      if (pending[0].count > limit) {
        const [removed] = pending.splice(0, 1)
        placed.delete(removed.inputId)
        return removed.count
      }
      if (pending[0].count === 0) {
        for (let i = 1; i < pending.length; i++) {
          if (pending[i].count > limit) {
            const [removed] = pending.splice(i, 1)
            placed.delete(removed.inputId)
            return removed.count
          }
        }
      }
      return undefined
    }
    const overLimit = placedInOrder.find((entry) => entry.count > limit)
    // Several image-carrying inputs sharing one failed native response may
    // combine in the rejecting continuation (e.g. 1 + 2 = 3 images), so no
    // single entry's count is a reliable sent total. Retire all settled
    // inputs below but preserve the provider's limit text.
    const imageCarrying = placedInOrder.filter((entry) => entry.count > 0)
    const result = imageCarrying.length > 1 ? undefined : overLimit?.count
    const settledIds = new Set(placedInOrder.map((entry) => entry.inputId))
    for (let i = pending.length - 1; i >= 0; i--) {
      if (settledIds.has(pending[i].inputId)) pending.splice(i, 1)
    }
    for (const id of settledIds) placed.delete(id)
    return result
  }
  const placedEntries = pending.filter((entry) => placed.has(entry.inputId))
  if (placedEntries.length === 0) {
    const [entry] = pending.splice(0, 1)
    if (entry) placed.delete(entry.inputId)
    return entry?.count
  }
  const oldest = placedEntries[0].count
  const settledIds = new Set(placedEntries.map((entry) => entry.inputId))
  for (let i = pending.length - 1; i >= 0; i--) {
    if (settledIds.has(pending[i].inputId)) pending.splice(i, 1)
  }
  for (const id of settledIds) placed.delete(id)
  return oldest
}

/**
 * Convert a provider `result` failure into the typed image-limit error when
 * its text names an upstream cap. The result payload carries only the limit,
 * so the attached count comes from the last submitted turn. Returns
 * `undefined` for unrelated failures. Uses sent-aware wording because the
 * request was already sent.
 *
 * Exported for regression coverage: a provider result event carrying an image
 * cap must arrive as a typed `AgentImageLimitError`, not a generic
 * `ClaudeCodeResultError`.
 */
export function normalizeResultImageLimitFailure(
  failure: { message?: unknown } | string | unknown,
  lastImageCount: number | undefined
): AgentImageLimitError | undefined {
  if (lastImageCount === undefined) return undefined
  const message =
    typeof failure === 'string'
      ? failure
      : failure instanceof Error
        ? failure.message
        : typeof (failure as { message?: unknown }).message === 'string'
          ? ((failure as { message?: string }).message as string)
          : undefined
  if (!message) return undefined
  return normalizeAgentImageLimitFailure(new Error(message), lastImageCount, {
    runtime: 'claude-code',
    sent: true
  })
}

async function toSdkUserMessage(
  message: AgentSessionMessageEntity,
  resumeToken?: string,
  systemReminder = false,
  {
    supportsAttachmentReads = false,
    supportsImages = true,
    maxImages
  }: { supportsAttachmentReads?: boolean; supportsImages?: boolean; maxImages?: number } = {}
): Promise<SDKUserMessage> {
  let content = await materializeUserContent(message, supportsImages, supportsAttachmentReads, maxImages)
  if (systemReminder) {
    content = applySteerReminder(content)
  }

  return {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
    session_id: resumeToken ?? ''
  }
}

/**
 * Wrap a steer reminder into user content so the model re-reads the system
 * prompt before its next action. Handles both string and array (text+image)
 * content shapes.
 */
function applySteerReminder(content: SDKUserMessage['message']['content']): SDKUserMessage['message']['content'] {
  if (Array.isArray(content)) {
    let wrappedText = false
    const wrapped = content.map((part) => {
      if (part.type !== 'text' || !part.text.trim()) return part
      wrappedText = true
      return { ...part, text: wrapSteerReminder(part.text) }
    })
    return wrappedText ? wrapped : [{ type: 'text', text: wrapSteerReminder('') }, ...wrapped]
  }
  return content.trim() ? wrapSteerReminder(content) : content
}

/**
 * Build SDK user content from a message entity. Non-image attachments are sent as
 * current local paths so the Agent decides how to inspect them with its tools. Images
 * keep the capability-aware path: supported formats become native Anthropic image
 * blocks, while first-party images use shared OCR/native-fallback routing when vision
 * is unavailable, and unlisted-extension images survive routing as file parts for the
 * path fallback. Assistant attachment handles remain an additional compatibility
 * interface; external files and images that cannot be materialized fall back to paths.
 *
 * **Side effect**: performs file I/O via {@link materializeNativeFilePart}.
 */
async function materializeUserContent(
  message: AgentSessionMessageEntity,
  supportsImages: boolean,
  supportsAttachmentReads: boolean,
  maxImages?: number
): Promise<SDKUserMessage['message']['content']> {
  const parts = message.data?.parts ?? []
  const firstPartyFileParts = parts.filter(
    (part): part is FileUIPart => part.type === 'file' && Boolean(readCherryMeta(part)?.fileEntryId)
  )
  const firstPartyImageParts = firstPartyFileParts.filter(isImageFilePart)
  const firstPartyPathParts = firstPartyFileParts.filter((part) => !isImageFilePart(part))
  const routedParts = parts.filter(
    (part) =>
      part.type === 'text' ||
      (part.type === 'file' && Boolean(readCherryMeta(part)?.fileEntryId) && isImageFilePart(part))
  )
  const externalFileParts = parts.filter(
    (part): part is FileUIPart => part.type === 'file' && !readCherryMeta(part)?.fileEntryId
  )
  const originalFirstPartyFiles = new Map(
    firstPartyFileParts
      .map((part) => [readCherryMeta(part)?.fileEntryId, part] as const)
      .filter((entry): entry is [string, FileUIPart] => Boolean(entry[0]))
  )

  let preparedParts = routedParts
  let turnAttachments: ReturnType<typeof collectAssistantFileAttachments> = []
  if (supportsAttachmentReads && firstPartyFileParts.length > 0) {
    turnAttachments = collectAssistantFileAttachments([{ id: message.id, role: 'user', parts: firstPartyFileParts }])
  }
  if (firstPartyImageParts.length > 0) {
    const userMessage = { id: message.id, role: 'user', parts: routedParts } as CherryUIMessage
    const attachments = supportsAttachmentReads ? turnAttachments : collectFileAttachments([userMessage])
    const [prepared] = await prepareChatMessages([userMessage], {
      attachments,
      nativeSupport: { image: supportsImages, pdf: false, audio: false, video: false },
      isToolCapable: supportsAttachmentReads,
      // An unlisted-extension image (AVIF/HEIC — accepted wildcard on the agent surface) must
      // stay a file part so the local-path fallback below still holds its file reference.
      keepUnroutableFileParts: true
    })
    preparedParts = prepared.parts
  }

  const text = preparedParts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
  // Capability-driven multi-image guard (#20030): static pre-check on the
  // parts that would become native image blocks — before file I/O and before
  // the paid SDK call. Supported models keep every image in the user's order;
  // over-limit turns throw with the actual limit and the draft stays intact.
  if (maxImages !== undefined && supportsImages) {
    const nativeCandidates = [
      ...preparedParts.filter((part): part is FileUIPart => part.type === 'file'),
      ...firstPartyPathParts,
      ...externalFileParts
    ].filter((part) => {
      const fileEntryId = readCherryMeta(part)?.fileEntryId
      const originalPart = (fileEntryId && originalFirstPartyFiles.get(fileEntryId)) || part
      return isImageFilePart(originalPart) && canBeClaudeImage(part)
    })
    if (nativeCandidates.length > maxImages) {
      throw new AgentImageLimitError({ limit: maxImages, count: nativeCandidates.length, runtime: 'claude-code' })
    }
  }
  const images: ImageBlockParam[] = []
  const fallbackParts: FileUIPart[] = []
  const unavailableParts: FileUIPart[] = []
  // A part that cannot become an image block still reaches the agent through its own path;
  // only one with nowhere to point is unavailable.
  const routeWithoutImage = (originalPart: FileUIPart): void => {
    const target =
      readCherryMeta(originalPart)?.fileEntryId || originalPart.url?.startsWith('file://')
        ? fallbackParts
        : unavailableParts
    target.push(originalPart)
  }

  for (const part of [
    ...preparedParts.filter((part): part is FileUIPart => part.type === 'file'),
    ...firstPartyPathParts,
    ...externalFileParts
  ]) {
    const fileEntryId = readCherryMeta(part)?.fileEntryId
    const originalPart = (fileEntryId && originalFirstPartyFiles.get(fileEntryId)) || part
    if (!isImageFilePart(originalPart) || !supportsImages || !canBeClaudeImage(part)) {
      routeWithoutImage(originalPart)
      continue
    }

    const preparedDataUrl = part.url ? parseDataUrl(part.url) : null
    if (preparedDataUrl?.isBase64 && preparedDataUrl.data.length === 0) {
      routeWithoutImage(originalPart)
      continue
    }
    let parsed = fileEntryId && preparedDataUrl?.isBase64 ? preparedDataUrl : null
    if (!parsed) {
      const inlineType = toClaudeImageMediaType(preparedDataUrl?.mediaType)
      const materialized = await materializeNativeFilePart(inlineType ? { ...part, mediaType: inlineType } : part)
      if (!materialized) {
        // Conversion found nothing sendable — the file itself may still be readable at its path.
        routeWithoutImage(originalPart)
        continue
      }
      parsed = materialized.url ? parseDataUrl(materialized.url) : null
    }

    if (!parsed?.isBase64 || parsed.data.length === 0) {
      routeWithoutImage(originalPart)
      continue
    }

    const claudeType = toClaudeImageMediaType(parsed.mediaType)
    if (claudeType) {
      images.push({
        type: 'image',
        source: { type: 'base64', media_type: claudeType, data: parsed.data }
      })
      continue
    }

    // Converted, but into a type the image blocks cannot carry (BMP, TIFF …).
    routeWithoutImage(originalPart)
  }

  const resolvedPaths = await extractAttachmentPaths(fallbackParts)
  unavailableParts.push(...resolvedPaths.unavailable)
  let textContent = appendAgentAttachmentPaths(text, resolvedPaths.files)
  if (supportsAttachmentReads) textContent = appendAttachmentManifest(textContent, turnAttachments)
  if (unavailableParts.length > 0) {
    const names = unavailableParts.map((part) => part.filename || 'attachment')
    logger.warn('Claude Code attachments could not be sent', { attachments: names })
    const renderedNames = message.delivery ? names.map((name) => JSON.stringify(name)) : names
    const note = `Unavailable attachments: ${renderedNames.join(', ')}`
    textContent = textContent.trim() ? `${textContent}\n\n${note}` : note
  }
  textContent = wrapAgentSessionDeliveryContent(message, textContent)
  if (images.length === 0) return textContent
  return textContent.trim() ? [{ type: 'text', text: textContent }, ...images] : images
}

function appendAttachmentManifest(
  text: string,
  attachments: ReadonlyArray<{ displayName: string; handle: string }>
): string {
  if (attachments.length === 0) return text

  const list = attachments
    .map(({ displayName, handle }) => `- ${JSON.stringify(displayName)} (handle: ${handle})`)
    .join('\n')
  const section = `Attachment manifest:\n${list}`
  return text.trim() ? `${text}\n\n${section}` : section
}

interface ResolvedAttachmentPath {
  filename?: string
  path: string
}

/** Resolve current managed paths so userData relocation never leaves a stale path in the prompt. */
async function extractAttachmentPaths(
  parts: FileUIPart[]
): Promise<{ files: ResolvedAttachmentPath[]; unavailable: FileUIPart[] }> {
  const files: ResolvedAttachmentPath[] = []
  const unavailable: FileUIPart[] = []
  for (const part of parts) {
    const fileEntryId = readCherryMeta(part)?.fileEntryId
    try {
      let resolved: AbsoluteFilePath
      if (readCherryMeta(part)?.remoteAttachment && part.url?.startsWith('file://')) {
        resolved = AbsoluteFilePathSchema.parse(fileURLToPath(part.url))
      } else if (fileEntryId) {
        resolved = application.get('FileManager').getPhysicalPath(fileEntryId)
      } else if (part.url?.startsWith('file://')) {
        resolved = AbsoluteFilePathSchema.parse(fileURLToPath(part.url))
      } else {
        unavailable.push(part)
        continue
      }

      // `getPhysicalPath` is a DB lookup: it resolves an entry whose bytes may already be
      // gone. Announcing a dead path would send the agent hunting; `unverifiable` (EACCES,
      // a stalled network volume) still gets announced rather than dropped on a transient.
      if ((await probeReadable(resolved)) === 'missing') {
        logger.warn('Attachment path no longer exists', { fileEntryId })
        unavailable.push(part)
        continue
      }
      files.push({ filename: part.filename, path: resolved })
    } catch (error) {
      logger.warn('Failed to resolve an attachment path', error as Error, { fileEntryId })
      unavailable.push(part)
    }
  }
  return { files, unavailable }
}

function isImageFilePart(part: FileUIPart): boolean {
  if (part.mediaType?.toLowerCase().startsWith('image/')) return true
  if (part.url?.startsWith('data:') && toClaudeImageMediaType(parseDataUrl(part.url)?.mediaType)) return true
  const filename = part.filename?.toLowerCase()
  const url = part.url && !part.url.startsWith('data:') ? part.url.toLowerCase().split(/[?#]/, 1)[0] : undefined
  // Agent counting superset (shared imageExts plus AVIF/HEIC/TIFF): routing
  // itself still uses the shared `imageExts` table, so AVIF/HEIC stay OTHER
  // for non-vision OCR fallback and keep their local-path fallback here via
  // `canBeClaudeImage` below.
  return AGENT_IMAGE_EXTS.some((extension) => filename?.endsWith(extension) || url?.endsWith(extension))
}

/**
 * Whether the part can become one of Claude's image blocks at all. A declared image type the
 * blocks cannot carry (TIFF, AVIF, HEIC …) answers here, before its bytes are converted: the
 * conversion can only fail, and the local-path fallback delivers the file either way.
 *
 * Delegates to the shared `canBeClaudeNativeImagePart` so the pre-send
 * `admitTurn` gate and this driver count the same candidates.
 */
function canBeClaudeImage(part: FileUIPart): boolean {
  return canBeClaudeNativeImagePart(part)
}

function toClaudeImageMediaType(value: string | undefined) {
  switch (value?.toLowerCase()) {
    case 'image/jpg':
    case 'image/jpeg':
    case 'image/pjpeg':
    case 'image/x-jpeg':
      return 'image/jpeg'
    case 'image/png':
    case 'image/x-png':
      return 'image/png'
    case 'image/gif':
    case 'image/x-gif':
      return 'image/gif'
    case 'image/webp':
    case 'image/x-webp':
      return 'image/webp'
    default:
      return null
  }
}

export class ClaudeCodeRuntimeDriver implements AgentSessionRuntimeDriver {
  readonly workspaceRelocation = claudeWorkspaceRelocation
  readonly fork = forkClaudeSession
  isForkCheckpoint(value: unknown): boolean {
    return ClaudeForkCheckpointSchema.safeParse(value).success
  }
  readonly type = 'claude-code'

  async validateSession(session: AgentSessionEntity): Promise<void> {
    await application.get('ClaudeCodeBinaryService').ensureExecutable()
    const cwd = session.workspace?.path
    if (!cwd) {
      throw new AgentSessionWorkspaceError(`Agent session ${session.id} has no workspace configured`)
    }
    await prepareClaudeCodeWorkspaceDirectory(session)
  }

  async connect(input: AgentRuntimeConnectInput): Promise<AgentRuntimeConnection> {
    const connection = new ClaudeCodeRuntimeConnection(input)
    try {
      return await connection.start()
    } catch (error) {
      logAiFailure(logger, 'Claude Code startup failed', error, 'agent.claude.start', classifyClaudeFailure(error))
      await connection.close()
      throw error
    }
  }

  onSessionIdle(sessionId: string): void {
    // `prewarmAgentSession` bakes the session's trace env when trace mode is on, so the park it
    // leaves behind matches what the next turn asks for either way — no driver-side guard needed.
    void application.get('ClaudeCodeWarmQueryManager').prewarmAgentSession(sessionId)
  }
}
