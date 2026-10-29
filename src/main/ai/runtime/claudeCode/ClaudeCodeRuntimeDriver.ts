import { fileURLToPath } from 'node:url'

import type {
  Options,
  SDKMessage,
  SDKAssistantMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import type { ImageBlockParam } from '@anthropic-ai/sdk/resources/messages'

import { canSalvageClaudeOutput } from './processExitDiagnostics'

type BetaUsage = SDKResultMessage['usage']
import { application } from '@application'
import { runtimeId, type Observation, type Subagent, type Thread } from '@cherrystudio/agent-runtime'
import type { ClaudeCodeRuntime, ClaudeObservation, ClaudeThreadHandle } from '@cherrystudio/agent-runtime-claude-code'
import { agentService } from '@data/services/AgentService'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { modelService } from '@data/services/ModelService'
import { loggerService } from '@logger'
import { ChildThreadProjection } from '@main/ai/agentSession/ChildThreadProjection'
import { ThreadMessageProjection } from '@main/ai/agentSession/ThreadMessageProjection'
import { collectAssistantFileAttachments } from '@main/ai/messages/assistantFileAttachments'
import { collectFileAttachments, prepareChatMessages } from '@main/ai/messages/attachmentRouting'
import { materializeNativeFilePart } from '@main/ai/messages/fileProcessor'
import { appendAgentAttachmentPaths, wrapAgentSessionDeliveryContent } from '@main/ai/runtime/agentUserContent'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import type { ClaudeAgentToolPolicySnapshot } from '@main/ai/tools/adapters/claudeCode/agentTools'
import {
  buildClaudeToolPolicy,
  descriptorToTool,
  listClaudeAgentToolDescriptors
} from '@main/ai/tools/adapters/claudeCode/agentTools'
import { probeReadable } from '@main/utils/file'
import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'
import type { AgentSessionSlashCommand } from '@shared/ai/agentSessionSlashCommands'
import type { Tool } from '@shared/ai/tool'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { CherryUIMessage, FileUIPart } from '@shared/data/types/message'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import { AsyncEventQueue } from '@shared/utils/async'
import { parseDataUrl } from '@shared/utils/dataUrl'
import { imageExts } from '@shared/utils/file'
import { isVisionModel } from '@shared/utils/model'

import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeReconcileResult,
  AgentRuntimeTraceContext,
  AgentRuntimeUserInput,
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
import { ClaudeRuntimeState } from './ClaudeRuntimeState'
import { effectiveContextWindowTokens } from './contextWindowSuffix'
import { ClaudeForkCheckpointSchema } from './forkCheckpoint'
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
import { convertClaudeCodeUsage, v3UsageToStats } from './usage'
import { claudeWorkspaceRelocation } from './workspaceRelocation'

const logger = loggerService.withContext('ClaudeCodeRuntimeDriver')
const HOST_MANAGED_SLASH_COMMANDS = new Set(['effort', 'fast'])

function isHostManagedSlashCommand(command: AgentSessionSlashCommand): boolean {
  return HOST_MANAGED_SLASH_COMMANDS.has(command.name)
}

function isFastSlashCommand(input: AgentRuntimeUserInput): boolean {
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

type InvocationUsageBuckets = {
  outputTokens?: number
  noCacheTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

type InvocationMetricSnapshot = {
  timeFirstTokenMs?: number
  timeCompletionMs?: number
  timeThinkingMs?: number
}

type InvocationTiming = {
  streamStartedAt: number
  ttftMs?: number
  thinkingStartedAt?: number
  thinkingDurationMs?: number
}

type PendingInvocationUsage = {
  requestId: string
  model: string
  messageAssociation: 'current-turn' | 'stateless'
  startUsage?: InvocationUsageBuckets
  assistantUsage?: InvocationUsageBuckets
  terminalUsage?: InvocationUsageBuckets
  timing?: InvocationTiming
  metrics?: InvocationMetricSnapshot
  completionObserved: boolean
  isStreamStopped: boolean
}

type InvocationUsageInput = {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

function invocationUsageBuckets(usage: InvocationUsageInput): InvocationUsageBuckets | undefined {
  const reportedValues = [
    usage.input_tokens,
    usage.output_tokens,
    usage.cache_read_input_tokens,
    usage.cache_creation_input_tokens
  ].filter((value): value is number => value != null)
  if (reportedValues.length === 0 || reportedValues.some((value) => !Number.isFinite(value) || value < 0))
    return undefined

  return {
    ...(usage.input_tokens != null ? { noCacheTokens: usage.input_tokens } : {}),
    ...(usage.output_tokens != null ? { outputTokens: usage.output_tokens } : {}),
    ...(usage.cache_read_input_tokens != null ? { cacheReadTokens: usage.cache_read_input_tokens } : {}),
    ...(usage.cache_creation_input_tokens != null ? { cacheWriteTokens: usage.cache_creation_input_tokens } : {})
  }
}

function mergeInvocationUsageBuckets(
  current: InvocationUsageBuckets | undefined,
  next: InvocationUsageBuckets | undefined
): InvocationUsageBuckets | undefined {
  if (!current) return next
  if (!next) return current
  return {
    outputTokens: next.outputTokens ?? current.outputTokens,
    noCacheTokens: next.noCacheTokens ?? current.noCacheTokens,
    cacheReadTokens: next.cacheReadTokens ?? current.cacheReadTokens,
    cacheWriteTokens: next.cacheWriteTokens ?? current.cacheWriteTokens
  }
}

function materializeInvocationUsage(buckets: InvocationUsageBuckets | undefined) {
  if (!buckets) return undefined
  const noCacheTokens = buckets.noCacheTokens ?? 0
  const cacheReadTokens = buckets.cacheReadTokens ?? 0
  const cacheWriteTokens = buckets.cacheWriteTokens ?? 0
  const inputTokens = noCacheTokens + cacheReadTokens + cacheWriteTokens
  const outputTokens = buckets.outputTokens ?? 0
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    noCacheTokens,
    cacheReadTokens,
    cacheWriteTokens
  }
}

function pendingInvocationFromAssistant(
  message: SDKAssistantMessage,
  messageAssociation: PendingInvocationUsage['messageAssociation'],
  fallbackModel: string
): PendingInvocationUsage {
  const isComplete = message.message.stop_reason != null && message.aborted !== true && message.error === undefined
  const assistantUsage = isComplete ? invocationUsageBuckets(message.message.usage) : undefined
  return {
    requestId: message.message.id,
    model: resolveSdkInvocationModel(message.message.model, fallbackModel),
    messageAssociation,
    ...(assistantUsage ? { assistantUsage } : {}),
    completionObserved: isComplete,
    isStreamStopped: false
  }
}

function resolveSdkInvocationModel(model: unknown, fallbackModel: string): string {
  return typeof model === 'string' && model.trim() ? model : fallbackModel
}

function selectAssistantUsage(
  current: InvocationUsageBuckets | undefined,
  next: InvocationUsageBuckets | undefined
): InvocationUsageBuckets | undefined {
  if (!next) return current
  if (!current || (next.outputTokens ?? 0) >= (current.outputTokens ?? 0)) return next
  return current
}

function finiteNonnegativeDuration(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined
}

function startsThinking(event: SDKPartialAssistantMessage['event']): boolean {
  return (
    (event.type === 'content_block_start' && event.content_block.type === 'thinking') ||
    (event.type === 'content_block_delta' && event.delta.type === 'thinking_delta')
  )
}

function hasNonReasoningOutput(event: SDKPartialAssistantMessage['event']): boolean {
  if (event.type === 'content_block_delta') {
    return (
      (event.delta.type === 'text_delta' && event.delta.text.length > 0) ||
      (event.delta.type === 'input_json_delta' && event.delta.partial_json.length > 0)
    )
  }
  if (event.type !== 'content_block_start') return false
  return (
    event.content_block.type === 'tool_use' ||
    event.content_block.type === 'server_tool_use' ||
    event.content_block.type === 'mcp_tool_use'
  )
}

function mergePendingInvocation(current: PendingInvocationUsage, next: PendingInvocationUsage): PendingInvocationUsage {
  const startUsage = mergeInvocationUsageBuckets(current.startUsage, next.startUsage)
  const assistantUsage = selectAssistantUsage(current.assistantUsage, next.assistantUsage)
  const terminalUsage = mergeInvocationUsageBuckets(current.terminalUsage, next.terminalUsage)
  const timing = next.timing ?? current.timing
  const metrics = next.metrics ?? current.metrics
  return {
    requestId: current.requestId,
    model: next.model || current.model,
    messageAssociation: current.messageAssociation,
    ...(startUsage ? { startUsage } : {}),
    ...(assistantUsage ? { assistantUsage } : {}),
    ...(terminalUsage ? { terminalUsage } : {}),
    ...(timing ? { timing } : {}),
    ...(metrics ? { metrics } : {}),
    completionObserved: current.completionObserved || next.completionObserved,
    isStreamStopped: current.isStreamStopped || next.isStreamStopped
  }
}

class ClaudeCodeRuntimeConnection implements AgentRuntimeConnection {
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
  private context?: ReturnType<typeof contexts.prepareClaudeBranch>
  private readonly pendingSteers = new Map<string, AgentRuntimeUserInput>()
  private readonly startedSteers = new Set<string>()
  private readonly childRelations = new Map<string, Subagent>()
  private readonly childOrigins = new Map<string, { toolCallId: string; name: string }>()
  private readonly childHandles = new Map<string, Promise<ClaudeThreadHandle | undefined>>()
  private readonly childProjections = new Map<string, ChildThreadProjection>()
  private closing = false
  private closePromise?: Promise<void>
  /** Keep the effective child environment for native checkpoint capture. */
  private spawnOptions?: Options
  /** Session-scoped: dispatches every message for the connection's lifetime, resetting per turn. */
  private nativeState?: ClaudeRuntimeState
  private sdkModelId?: string
  private approvalEmitter?: ToolApprovalEmitterHolder
  private mcpToolMetadata?: Record<string, McpToolDisplayMetadata>
  private resumeToken?: string
  private lastMainAssistantUuid?: string
  private toolPolicySnapshot?: ClaudeAgentToolPolicySnapshot
  private assistantFileToolsEnabled = false
  private sessionTornDown = false
  /** Staleness identity captured by the materialized request; live facts advance during reconcile. */
  private connectionConfig?: ConnectionConfig
  private _usageCapture?: AgentSessionUsageCapture
  private readonly pendingInvocations = new Map<string, PendingInvocationUsage>()
  private readonly streamInvocationIdsByLane = new Map<string, string>()
  private readonly committedInvocationIds = new Set<string>()
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
      this.input.knowledgeBaseIds
    )
    if (!request) {
      throw new Error(`Unable to build Claude Code query options for agent session ${this.input.sessionId}`)
    }
    this.connectionConfig = request.connectionConfig
    this.approvalEmitter = request.settings.approvalEmitter
    this.assistantFileToolsEnabled = Boolean(request.settings.mcpServers?.['assistant-files'])
    this.context = contexts.prepareClaudeBranch(
      this.input.sessionId,
      resolveClaudeConfigDirectory(request.options.env),
      request.options.resume ?? this.input.nativeSessionId,
      this.input.branchHead
    )

    const traceEnv = await this.prepareTraceEnv()
    const coldProcessDiagnostics = createClaudeCodeProcessDiagnostics()
    const options: Options = {
      ...request.options,
      ...(request.options.resume || this.context.nativeThreadId
        ? { resume: request.options.resume ?? this.context.nativeThreadId! }
        : { sessionId: this.context.intendedThreadId! }),
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
    this.nativeState = this.createNativeState()
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

  async send(input: AgentRuntimeUserInput): Promise<void> {
    this.lastMainAssistantUuid = undefined
    if (isFastSlashCommand(input)) {
      throw new Error('The /fast command is unavailable; use the host Fast control instead')
    }

    this.nativeState?.beginTurn()

    const sdkMessage = await toSdkUserMessage(input.message, this.resumeToken, input.systemReminder, {
      supportsAttachmentReads: this.assistantFileToolsEnabled,
      supportsImages: resolveModelImageSupport(this.input.modelId)
    })
    const draft = messages.prepareSubmission(
      this.input.sessionId,
      input.message.id,
      this.context!.id,
      'follow-up',
      JSON.stringify(sdkMessage.message.content)
    )
    const result = await this.handle!.claude.submit(draft.inputId, sdkMessage.message.content, 'follow-up')
    if (result.status !== 'acknowledged') throw new Error(result.error?.message ?? result.status)
  }

  redirect(input: AgentRuntimeUserInput): boolean {
    if (this.closing || !this.handle) return false
    this.pendingSteers.set(input.message.id, input)
    void this.submitSteer(input).catch((error) => this.eventQueue.push({ type: 'error', error }))
    return true
  }

  private async submitSteer(input: AgentRuntimeUserInput): Promise<void> {
    const sdkMessage = await toSdkUserMessage(input.message, this.resumeToken, input.systemReminder, {
      supportsAttachmentReads: this.assistantFileToolsEnabled,
      supportsImages: resolveModelImageSupport(this.input.modelId)
    })
    const draft = messages.prepareSubmission(
      this.input.sessionId,
      input.message.id,
      this.context!.id,
      'steer',
      JSON.stringify(sdkMessage.message.content)
    )
    const result = await this.handle!.claude.submit(draft.inputId, sdkMessage.message.content, 'steer')
    if (result.status !== 'acknowledged') throw new Error(result.error?.message ?? result.status)
  }

  async reconcile(input: {
    modelId: UniqueModelId
    reasoningEffort?: AgentRuntimeConnectInput['reasoningEffort']
    knowledgeBaseIds?: readonly string[]
    fastMode?: boolean
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
    knowledgeBaseIds?: readonly string[]
    fastMode?: boolean
  }): Promise<AgentRuntimeReconcileResult> {
    if (!this.handle) return 'rebuild'
    const derived = await deriveConnectionConfig(
      this.input.sessionId,
      input.modelId,
      input.reasoningEffort ?? 'default',
      input.fastMode === true,
      input.knowledgeBaseIds
    )
    if (!derived.ok) return 'invalid'
    const baseline = this.connectionConfig
    // A connection without its materialized baseline cannot prove what the subprocess serves.
    if (!baseline) return 'rebuild'

    const fresh = derived.config
    const permissionModeChanged = baseline.live.toolPolicy.permissionMode !== fresh.live.toolPolicy.permissionMode
    // Claude's set_permission_mode control request can terminate work already in flight. Keep the
    // mode (and the local approval gate that mirrors it) frozen for the active turn; the host pulls
    // reconcile again before admitting the next turn, when the SDK update is safe to apply.
    const deferPermissionMode = permissionModeChanged && this.nativeState?.isTurnActive === true
    const applicableToolPolicy = deferPermissionMode
      ? { ...fresh.live.toolPolicy, permissionMode: baseline.live.toolPolicy.permissionMode }
      : fresh.live.toolPolicy
    let patched = false
    // Apply the tool-policy facts that are safe for this turn BEFORE the rebuild verdict. Newly
    // disabled tools still tighten immediately; permission-mode changes wait for the next boundary.
    if (!toolPolicyFactsEqual(baseline.live.toolPolicy, applicableToolPolicy)) {
      try {
        const agent = agentService.getAgent(this.input.agentId)
        if (!agent) return 'invalid'
        if (permissionModeChanged && !deferPermissionMode) {
          const changed = await this.handle.claude.setPermissionMode(
            (fresh.live.toolPolicy.permissionMode ?? 'default') as AgentPermissionMode
          )
          if (changed.status !== 'confirmed') throw new Error(changed.error.message)
        }
        // Refresh only after the SDK confirms an applicable permission change. If the current turn
        // keeps its old mode, preserve that mode in the snapshot while still applying other policy
        // changes (for example, disabling a tool).
        await this.toolPolicySnapshot?.update(
          deferPermissionMode
            ? {
                ...agent,
                configuration: {
                  ...agent.configuration,
                  permission_mode: (baseline.live.toolPolicy.permissionMode ?? undefined) as
                    | AgentPermissionMode
                    | undefined
                }
              }
            : agent
        )
      } catch (error) {
        logger.warn('Live tool-policy apply failed during reconcile', { sessionId: this.input.sessionId, error })
        return 'failed'
      }
      this.connectionConfig = {
        ...baseline,
        live: { ...fresh.live, toolPolicy: applicableToolPolicy }
      }
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

  async getContextUsage(): Promise<AgentSessionContextUsage | null> {
    if (!this.handle) return null
    try {
      const result = await this.handle.claude.contextUsage()
      return result.status === 'confirmed' ? result.value : null
    } catch (error) {
      logger.warn('getContextUsage failed', { sessionId: this.input.sessionId, error })
      return null
    }
  }

  /**
   * Project a top-level `message_start`/`message_delta`'s input usage into a live reading: the
   * request the CLI just sent carries exactly the tokens now occupying the window. `categories` stays
   * empty (only the CLI's probe produces the breakdown); the host's post-turn pull remains authoritative.
   */
  private emitLiveContextUsage(usage: InvocationUsageInput | undefined): void {
    const totalTokens =
      (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0)
    if (totalTokens <= 0) return
    const model = this.sdkModelId ?? this.input.modelId
    const maxTokens = effectiveContextWindowTokens(model)
    this.eventQueue.push({
      type: 'context-usage',
      usage: {
        categories: [],
        totalTokens,
        maxTokens,
        percentage: Math.min(100, (totalTokens / maxTokens) * 100),
        model
      }
    })
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

  close(): Promise<void> {
    this.closePromise ??= this.closeQuery()
    return this.closePromise
  }

  async closeForEdit(): Promise<void> {
    await this.close()
  }

  private async closeQuery(): Promise<void> {
    this.closing = true
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
    await Promise.all(this.childHandles.values())
    await Promise.all(this.observationEnds)
    await Promise.all([...this.childProjections.values()].map((projection) => projection.stop()))
    await Promise.all(this.observations.map((observation) => observation.stop()))
    await Promise.all(this.rootProjections.map((projection) => projection.close()))
    this.settlePendingInvocations()
    this.teardownSession()
    this.eventQueue.close()
  }

  private async observeRoot(handle: ClaudeThreadHandle): Promise<void> {
    const metadata = new ClaudeMessageMetadata(this.mcpToolMetadata)
    const projection = new ThreadMessageProjection(handle.thread, metadata.decorate)
    const contextId = this.context!.id
    this.rootContexts.set(handle.thread.id, this.context!)
    this.rootProjections.push(projection)
    let end!: () => void
    this.observationEnds.push(
      new Promise<void>((resolve) => {
        end = resolve
      })
    )
    const observation = await handle.claude.observe(async (batch) => {
      let publish = () => {}
      try {
        const refresh = metadata.accept(batch)
        const changed = await projection.accept(batch.events, refresh)
        const live =
          !batch.events.some((event) => event.type === 'snapshot') &&
          batch.native.some((native) => native.source === 'live')
            ? changed.map((message) => message.id)
            : []
        publish = () => {
          this.eventQueue.push({
            type: 'message-projection',
            projection: {
              contextId,
              legacy: metadata.legacy,
              messages: batch.events.some((event) => event.type === 'snapshot')
                ? projection.snapshot().messages
                : changed,
              live,
              refresh,
              replaces: Object.fromEntries(
                batch.events.flatMap((event) =>
                  event.type === 'message.upsert' ? (event.replaces ?? []).map((ref) => [ref.id, event.message.id]) : []
                )
              ),
              removed: [...metadata.removed]
            }
          })
          publish = () => {}
        }
        const terminal = await this.acceptRoot(batch, projection)
        publish()
        for (const event of terminal) this.eventQueue.push(event)
        if (
          batch.events.some((event) => event.type === 'gap') &&
          !batch.native.some((native) => native.message.type === 'conversation_reset')
        )
          await handle.claude.archive()
        if (batch.events.some((event) => event.type === 'closed' && event.reason !== 'shutdown') && !this.closing)
          this.eventQueue.close()
      } catch (error) {
        publish()
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
    this.restoreChildren(this.context!, handle.thread)
  }

  private async acceptRoot(
    batch: ClaudeObservation,
    projection: ThreadMessageProjection
  ): Promise<AgentRuntimeEvent[]> {
    const terminal: AgentRuntimeEvent[] = []
    for (const event of batch.events) {
      if (event.type === 'subagent.upsert') this.discoverChild(event.subagent)
      if (event.type === 'snapshot') for (const child of event.subagents ?? []) this.discoverChild(child)
      if (
        event.type === 'input.changed' &&
        event.input.inputId &&
        messages.hasSubmission(this.input.sessionId, event.input.inputId)
      ) {
        application
          .get('DbService')
          .withWriteTx((tx) => messages.mergeSubmissionTx(tx, this.input.sessionId, event.input.inputId!, event.input))
        if (event.input.response) this.eventQueue.push({ type: 'input-response', input: event.input })
        if (event.input.outcome) {
          this.pendingSteers.delete(event.input.inputId)
          this.startedSteers.delete(event.input.inputId)
        }
      }
      if (event.type === 'closed' && event.reason !== 'shutdown' && !this.closing) {
        this.settlePendingInvocations()
        const error = this.nativeError ?? new Error(`Claude observation ended: ${event.reason}`)
        const surfaced =
          isClaudeCodeProcessFailure(error, this.processDiagnostics) && this.processDiagnostics
            ? createClaudeCodeProcessExitError(error, this.processDiagnostics)
            : error
        const bufferedChars = projection
          .snapshot()
          .messages.filter(
            (message) => message.id.startsWith('live:') || message.id.startsWith(`${this.lastMainAssistantUuid}:`)
          )
          .flatMap((message) => message.parts)
          .reduce((length, part) => length + (part.type === 'text' ? part.text.length : 0), 0)
        terminal.push(
          canSalvageClaudeOutput(surfaced, bufferedChars, this.nativeState?.sawAbortedMessage === true)
            ? { type: 'turn-complete' }
            : { type: 'error', error: surfaced }
        )
      }
    }
    if (!batch.events.some((event) => event.type === 'snapshot'))
      for (const native of batch.native) {
        if (native.source !== 'live') continue
        if (native.message.type === 'command_lifecycle') {
          if (native.message.state === 'started' && this.pendingSteers.has(native.message.command_uuid))
            this.startedSteers.add(native.message.command_uuid)
        } else {
          const result = await this.handleNativeMessage(native.message)
          if (result) terminal.push(result)
        }
      }
    return terminal
  }

  private async handleNativeMessage(message: SDKMessage): Promise<AgentRuntimeEvent | undefined> {
    if (message.type === 'assistant' || message.type === 'stream_event') {
      const ids = [
        ...new Set([
          ...this.startedSteers,
          ...(message.user_message_uuids ?? (message.user_message_uuid ? [message.user_message_uuid] : []))
        ])
      ]
      const steers = ids.flatMap((id) => (this.pendingSteers.has(id) ? [this.pendingSteers.get(id)!] : []))
      if (steers.length) {
        this.commitPendingInvocations()
        for (const input of steers) {
          this.pendingSteers.delete(input.message.id)
          this.startedSteers.delete(input.message.id)
        }
        this.eventQueue.push({ type: 'steer-boundary', inputs: steers })
        this.nativeState?.beginTurn()
      }
      const responseId =
        message.type === 'assistant'
          ? message.message.id
          : message.event.type === 'message_start'
            ? message.event.message.id
            : undefined
      if (responseId) this.eventQueue.push({ type: 'response-start', responseId })
    }
    if (
      message.type === 'system' &&
      message.subtype === 'task_started' &&
      message.task_type === 'local_agent' &&
      message.tool_use_id
    ) {
      if (!this.childOrigins.has(message.task_id))
        this.childOrigins.set(message.task_id, { toolCallId: message.tool_use_id, name: message.description })
      this.observeChild(message.task_id)
    }
    if (message.type === 'conversation_reset') return
    if ((message.type === 'system' && message.subtype === 'init') || message.type === 'result') {
      if (message.session_id !== this.handle!.claude.sessionId) {
        const opened = await this.runtime!.open({
          backendId: this.handle!.thread.backendId,
          id: runtimeId(message.session_id)
        })
        if (opened.status !== 'confirmed') throw new Error(opened.error.message)
        this.handle = opened.value
        this.context = contexts.prepareClaudeBranch(
          this.input.sessionId,
          resolveClaudeConfigDirectory(this.spawnOptions?.env),
          message.session_id,
          messages.captureHead(this.input.sessionId)
        )
        await this.observeRoot(this.handle)
      }
      this.context = contexts.bindContext(this.context!.id, message.session_id)
    }
    if (message.type === 'stream_event') {
      if (message.event.type === 'message_start') this.emitLiveContextUsage(message.event.message.usage)
      if (message.event.type === 'message_delta' && message.event.usage?.input_tokens != null)
        this.emitLiveContextUsage(message.event.usage)
      this.captureStreamInvocation(message, 'current-turn')
    }
    if (message.type === 'assistant') {
      this.captureAssistantInvocation(message, 'current-turn')
      this.lastMainAssistantUuid = message.uuid
    }
    const result = this.nativeState!.accept(message)
    if (!result) return
    this.commitPendingInvocations()
    this.updateResumeToken(result.session_id)
    this.emitUsageMetadata(result.usage)
    const checkpoint = ClaudeForkCheckpointSchema.safeParse({
      runtime: 'claude-code',
      runtimeSessionId: result.session_id,
      messageUuid: this.lastMainAssistantUuid,
      configDir: resolveClaudeConfigDirectory(this.spawnOptions?.env)
    })
    this.lastMainAssistantUuid = undefined
    return {
      type: 'turn-complete',
      forkAnchor: checkpoint.success ? { checkpoint: checkpoint.data } : undefined
    }
  }

  private discoverChild(relation: Subagent): void {
    this.childRelations.set(relation.id, relation)
    this.observeChild(relation.id)
  }

  private restoreChildren(parent: ReturnType<typeof contexts.context>, thread: Thread): void {
    for (const context of contexts.children(parent.id)) {
      if (!context.subagentId || !context.nativeThreadId) continue
      this.discoverChild({
        id: runtimeId(context.subagentId),
        parent: thread,
        child: { backendId: runtimeId(context.backendId), id: runtimeId(context.nativeThreadId) }
      })
    }
  }

  private observeChild(id: string): void {
    const relation = this.childRelations.get(id)
    if (this.closing || !relation?.child || this.childHandles.has(id)) return
    const parent =
      this.rootContexts.get(relation.parent.id) ??
      [...this.childProjections.values()].find((projection) => projection.thread.id === relation.parent.id)?.context
    if (!parent) return
    const saved = contexts.children(parent.id).find((child) => child.subagentId === id)
    const origin =
      this.childOrigins.get(id) ??
      (saved?.spawnToolCallId ? { toolCallId: saved.spawnToolCallId, name: 'Agent' } : undefined)
    if (!origin) return
    this.childOrigins.set(id, origin)
    this.childHandles.set(
      id,
      (async () => {
        const opened = await this.runtime!.open(relation.child!)
        if (opened.status !== 'confirmed') throw new Error(opened.error.message)
        const handle = opened.value
        const context = saved ?? contexts.child(parent.id, id, handle.thread.id, origin.toolCallId, origin.name)
        // The SDK stores the child prompt without forwarding it in the live conversation feed.
        await handle.claude.archive()
        const metadata = new ClaudeMessageMetadata(this.mcpToolMetadata)
        const responseOwners = new Set<string>()
        let end!: () => void
        this.observationEnds.push(
          new Promise<void>((resolve) => {
            end = resolve
          })
        )
        const projection = new ChildThreadProjection(
          context,
          {
            ...handle,
            observe: async (sink) => {
              const result = await handle.claude.observe(async (batch) => {
                try {
                  const refresh = metadata.accept(batch)
                  for (const event of batch.events) {
                    await sink(event)
                    if (event.type === 'subagent.upsert') this.discoverChild(event.subagent)
                    if (event.type === 'snapshot') for (const child of event.subagents ?? []) this.discoverChild(child)
                  }
                  if (refresh.length) await projection.refreshDecoration(refresh)
                  for (const native of batch.native) {
                    if (native.source !== 'live' || native.message.type !== 'assistant') continue
                    await projection.flush()
                    const productId = contexts.context(context.id).checkpointMapping?.projection as
                      | Record<string, string>
                      | undefined
                    const ownerId = productId?.[native.message.uuid]
                    if (ownerId && !responseOwners.has(native.message.message.id)) {
                      responseOwners.add(native.message.message.id)
                      this.eventQueue.push({
                        type: 'response-start',
                        responseId: native.message.message.id,
                        messageId: ownerId
                      })
                    }
                    this.captureAssistantInvocation(native.message, 'stateless')
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
          () => metadata.archive(),
          metadata.decorate
        )
        this.childProjections.set(id, projection)
        await projection.attach()
        this.restoreChildren(context, handle.thread)
        for (const child of this.childRelations.keys()) this.observeChild(child)
        return handle
      })().catch((error) => {
        logger.error('Claude child observation failed', { id, error })
        return undefined
      })
    )
  }

  async childProjection(toolCallId: string) {
    const id = [...this.childOrigins].find(([, origin]) => origin.toolCallId === toolCallId)?.[0]
    if (!id) return undefined
    this.observeChild(id)
    await this.childHandles.get(id)
    const projection = this.childProjections.get(id)
    return projection && { snapshot: () => projection.snapshot(), subscribe: projection.subscribe.bind(projection) }
  }

  private createNativeState(): ClaudeRuntimeState {
    return new ClaudeRuntimeState((event) => {
      if (event.type === 'supported-commands') {
        this.eventQueue.push({
          ...event,
          commands: event.commands.filter((command) => !isHostManagedSlashCommand(command))
        })
      } else this.eventQueue.push(event)
    })
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

  private emitUsageMetadata(usage: BetaUsage | undefined): void {
    if (!usage) return
    this.eventQueue.push({
      type: 'chunk',
      chunk: {
        type: 'message-metadata',
        messageMetadata: { stats: v3UsageToStats(convertClaudeCodeUsage(usage)) }
      }
    })
  }

  private captureAssistantInvocation(
    message: SDKAssistantMessage,
    messageAssociation: PendingInvocationUsage['messageAssociation']
  ): void {
    const capture = this._usageCapture
    if (capture?.owner !== 'agent-sdk') return

    if (this.committedInvocationIds.has(message.message.id)) return

    const next = pendingInvocationFromAssistant(message, messageAssociation, this.sdkModelId ?? this.input.modelId)
    this.captureInvocationForLane(this.invocationLane(message.parent_tool_use_id), next)
    if (this.pendingInvocations.get(next.requestId)?.isStreamStopped) {
      this.commitInvocationUsage(next.requestId)
    }
  }

  private captureStreamInvocation(
    message: SDKPartialAssistantMessage,
    messageAssociation: PendingInvocationUsage['messageAssociation']
  ): void {
    if (this._usageCapture?.owner !== 'agent-sdk') return

    const lane = this.invocationLane(message.parent_tool_use_id)
    if (message.event.type === 'message_start') {
      const sdkMessage = message.event.message
      const startUsage = invocationUsageBuckets(sdkMessage.usage)
      const ttftMs = finiteNonnegativeDuration(message.ttft_ms)
      this.captureInvocationForLane(lane, {
        requestId: sdkMessage.id,
        model: resolveSdkInvocationModel(sdkMessage.model, this.sdkModelId ?? this.input.modelId),
        messageAssociation,
        ...(startUsage ? { startUsage } : {}),
        timing: {
          streamStartedAt: performance.now(),
          ...(ttftMs !== undefined ? { ttftMs } : {})
        },
        completionObserved: false,
        isStreamStopped: false
      })
      return
    }

    const requestId = this.streamInvocationIdsByLane.get(lane)
    if (!requestId) return

    if (message.event.type === 'content_block_start' || message.event.type === 'content_block_delta') {
      const current = this.pendingInvocations.get(requestId)
      if (!current) return
      this.pendingInvocations.set(requestId, this.observeInvocationOutput(current, message))
      return
    }

    if (message.event.type === 'message_delta') {
      const current = this.pendingInvocations.get(requestId)
      if (!current) return
      const terminalUsage = invocationUsageBuckets(message.event.usage)
      const isStreamStopped = message.event.delta.stop_reason !== null
      const finalized = isStreamStopped ? this.finalizeInvocationTiming(current) : current
      this.pendingInvocations.set(requestId, {
        ...finalized,
        ...(terminalUsage ? { terminalUsage } : {}),
        completionObserved: finalized.completionObserved || isStreamStopped,
        isStreamStopped: finalized.isStreamStopped || isStreamStopped
      })
      if (isStreamStopped && (terminalUsage || current.terminalUsage)) this.commitInvocationUsage(requestId)
      return
    }

    if (message.event.type === 'message_stop') {
      const current = this.pendingInvocations.get(requestId)
      if (!current) return
      this.pendingInvocations.set(requestId, {
        ...this.finalizeInvocationTiming(current),
        completionObserved: true,
        isStreamStopped: true
      })
      if (current.terminalUsage || current.assistantUsage) this.commitInvocationUsage(requestId)
    }
  }

  private observeInvocationOutput(
    pending: PendingInvocationUsage,
    message: SDKPartialAssistantMessage
  ): PendingInvocationUsage {
    const timing = pending.timing
    if (!timing) return pending

    let thinkingStartedAt = timing.thinkingStartedAt
    let thinkingDurationMs = timing.thinkingDurationMs
    if (startsThinking(message.event) && thinkingStartedAt === undefined) {
      thinkingStartedAt = performance.now()
    }
    if (thinkingStartedAt !== undefined && thinkingDurationMs === undefined && hasNonReasoningOutput(message.event)) {
      thinkingDurationMs = Math.max(0, Math.round(performance.now() - thinkingStartedAt))
    }

    return {
      ...pending,
      timing: {
        ...timing,
        ...(thinkingStartedAt !== undefined ? { thinkingStartedAt } : {}),
        ...(thinkingDurationMs !== undefined ? { thinkingDurationMs } : {})
      }
    }
  }

  private finalizeInvocationTiming(pending: PendingInvocationUsage): PendingInvocationUsage {
    const timing = pending.timing
    if (!timing) return pending

    const completedAt = performance.now()
    const timeFirstTokenMs = timing.ttftMs
    const timeCompletionMs =
      timeFirstTokenMs !== undefined
        ? Math.max(timeFirstTokenMs, Math.round(timeFirstTokenMs + completedAt - timing.streamStartedAt))
        : undefined
    const timeThinkingMs =
      timing.thinkingDurationMs ??
      (timing.thinkingStartedAt !== undefined
        ? Math.max(0, Math.round(completedAt - timing.thinkingStartedAt))
        : undefined)
    const metrics = {
      ...(timeFirstTokenMs !== undefined ? { timeFirstTokenMs } : {}),
      ...(timeCompletionMs !== undefined ? { timeCompletionMs } : {}),
      ...(timeThinkingMs !== undefined ? { timeThinkingMs } : {})
    }

    return {
      ...pending,
      ...(Object.keys(metrics).length > 0 ? { metrics } : {})
    }
  }

  private captureInvocationForLane(lane: string, next: PendingInvocationUsage): void {
    if (this.committedInvocationIds.has(next.requestId)) {
      logger.warn('Claude SDK emitted an invocation after it was already committed', {
        sessionId: this.input.sessionId,
        requestId: next.requestId,
        model: next.model
      })
      return
    }

    const previousRequestId = this.streamInvocationIdsByLane.get(lane)
    if (previousRequestId && previousRequestId !== next.requestId) {
      this.commitInvocationUsage(previousRequestId)
    }
    this.streamInvocationIdsByLane.set(lane, next.requestId)

    const current = this.pendingInvocations.get(next.requestId)
    this.pendingInvocations.set(next.requestId, current ? mergePendingInvocation(current, next) : next)
  }

  private commitPendingInvocations(): void {
    for (const requestId of [...this.pendingInvocations.keys()]) {
      this.commitInvocationUsage(requestId)
    }
  }

  private settlePendingInvocations(): void {
    for (const [requestId, pending] of [...this.pendingInvocations.entries()]) {
      if (pending.completionObserved) {
        this.commitInvocationUsage(requestId)
      } else {
        this.discardInvocationUsage(requestId)
      }
    }
  }

  private discardInvocationUsage(requestId: string): void {
    if (!this.pendingInvocations.delete(requestId)) return
    for (const [lane, laneRequestId] of this.streamInvocationIdsByLane) {
      if (laneRequestId === requestId) this.streamInvocationIdsByLane.delete(lane)
    }
  }

  private commitInvocationUsage(requestId: string): void {
    const pending = this.pendingInvocations.get(requestId)
    if (!pending) return
    this.pendingInvocations.delete(requestId)
    for (const [lane, laneRequestId] of this.streamInvocationIdsByLane) {
      if (laneRequestId === requestId) this.streamInvocationIdsByLane.delete(lane)
    }
    this.committedInvocationIds.add(pending.requestId)
    const usage = materializeInvocationUsage(
      mergeInvocationUsageBuckets(
        mergeInvocationUsageBuckets(pending.startUsage, pending.assistantUsage),
        pending.terminalUsage
      )
    )
    this.eventQueue.push({
      type: 'usage',
      invocation: {
        requestId: `claude-agent:${pending.requestId}`,
        responseId: pending.requestId,
        model: pending.model,
        messageAssociation: pending.messageAssociation,
        ...(usage ? { usage } : {}),
        ...(pending.metrics ? { metrics: pending.metrics } : {})
      }
    })
  }

  private invocationLane(parentToolUseId: string | null | undefined): string {
    return parentToolUseId == null ? 'top-level' : `tool:${parentToolUseId}`
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

async function toSdkUserMessage(
  message: AgentSessionMessageEntity,
  resumeToken?: string,
  systemReminder = false,
  {
    supportsAttachmentReads = false,
    supportsImages = true
  }: { supportsAttachmentReads?: boolean; supportsImages?: boolean } = {}
): Promise<SDKUserMessage> {
  let content = await materializeUserContent(message, supportsImages, supportsAttachmentReads)
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
  supportsAttachmentReads: boolean
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
    let parsed = preparedDataUrl?.isBase64 ? preparedDataUrl : null
    if (!parsed) {
      const materialized = await materializeNativeFilePart(part)
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
  const filename = part.filename?.toLowerCase()
  const url = part.url && !part.url.startsWith('data:') ? part.url.toLowerCase().split(/[?#]/, 1)[0] : undefined
  return imageExts.some((extension) => filename?.endsWith(extension) || url?.endsWith(extension))
}

/**
 * Whether the part can become one of Claude's image blocks at all. A declared image type the
 * blocks cannot carry (TIFF, AVIF, HEIC …) answers here, before its bytes are converted: the
 * conversion can only fail, and the local-path fallback delivers the file either way.
 */
function canBeClaudeImage(part: FileUIPart): boolean {
  const inlineType = part.url?.startsWith('data:') ? parseDataUrl(part.url)?.mediaType : undefined
  const mediaType = (inlineType ?? part.mediaType)?.toLowerCase()
  if (!mediaType || mediaType === 'application/octet-stream') return true
  if (mediaType.startsWith('image/')) return toClaudeImageMediaType(mediaType) !== null

  const filename = part.filename?.toLowerCase()
  const url = part.url && !part.url.startsWith('data:') ? part.url.toLowerCase().split(/[?#]/, 1)[0] : undefined
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].some(
    (extension) => filename?.endsWith(extension) || url?.endsWith(extension)
  )
}

function toClaudeImageMediaType(value: string | undefined) {
  switch (value?.toLowerCase()) {
    case 'image/jpg':
    case 'image/jpeg':
      return 'image/jpeg'
    case 'image/png':
      return 'image/png'
    case 'image/gif':
      return 'image/gif'
    case 'image/webp':
      return 'image/webp'
    default:
      return null
  }
}

export class ClaudeCodeRuntimeDriver implements AgentSessionRuntimeDriver {
  readonly workspaceRelocation = claudeWorkspaceRelocation
  readonly fork = forkClaudeSession
  readonly type = 'claude-code'
  readonly messageSource = 'projection' as const
  readonly capabilities = ['agent-session'] as const

  async validateSession(session: AgentSessionEntity): Promise<void> {
    await application.get('ClaudeCodeBinaryService').ensureExecutable()
    const cwd = session.workspace?.path
    if (!cwd) {
      throw new AgentSessionWorkspaceError(`Agent session ${session.id} has no workspace configured`)
    }
    await prepareClaudeCodeWorkspaceDirectory(session)
  }

  async listAvailableTools(mcpIds: string[]): Promise<Tool[]> {
    const catalog = await listClaudeAgentToolDescriptors({ mcps: mcpIds })
    const policy = buildClaudeToolPolicy({})
    return catalog.descriptors.map((descriptor) => descriptorToTool(descriptor, policy))
  }

  async connect(input: AgentRuntimeConnectInput): Promise<AgentRuntimeConnection> {
    const connection = new ClaudeCodeRuntimeConnection(input)
    try {
      return await connection.start()
    } catch (error) {
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
