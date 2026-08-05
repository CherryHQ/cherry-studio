import { fileURLToPath } from 'node:url'

import {
  type Options,
  type Query,
  query as createClaudeQuery,
  type SDKAssistantMessage,
  type SDKPartialAssistantMessage,
  type SDKResultMessage,
  type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import type { ImageBlockParam } from '@anthropic-ai/sdk/resources/messages'

type BetaUsage = SDKResultMessage['usage']
import { agentService } from '@data/services/AgentService'
import { modelService } from '@data/services/ModelService'

import { application } from '@application'
import { loggerService } from '@logger'
import { collectAssistantFileAttachments } from '@main/ai/messages/assistantFileAttachments'
import { collectFileAttachments, prepareChatMessages } from '@main/ai/messages/attachmentRouting'
import { materializeNativeFilePart } from '@main/ai/messages/fileProcessor'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import type { ClaudeAgentToolPolicySnapshot } from '@main/ai/tools/adapters/claudeCode/agentTools'
import {
  buildClaudeToolPolicy,
  descriptorToTool,
  listClaudeAgentToolDescriptors
} from '@main/ai/tools/adapters/claudeCode/agentTools'
import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'
import type { AgentSessionSlashCommand } from '@shared/ai/agentSessionSlashCommands'
import type { Tool } from '@shared/ai/tool'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { CherryUIMessage, FileUIPart } from '@shared/data/types/message'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { parseDataUrl } from '@shared/utils/dataUrl'
import { archiveExts } from '@shared/utils/file'
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
import {
  AgentSessionWorkspaceError,
  disposeToolPolicySnapshot,
  prepareClaudeCodeWorkspaceDirectory,
  registerMcpSessionCatalogSync
} from './settingsBuilder'
import { ClaudeCodeResultError, ClaudeCodeStreamAdapter, convertClaudeCodeUsage, v3UsageToStats } from './streamAdapter'
import type { McpToolDisplayMetadata, SteerHolder, ToolApprovalEmitterHolder } from './types'

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

/**
 * The CLI reported that the resume target does not exist — deleted by its transcript cleanup, a
 * different CLAUDE_CONFIG_DIR, or a copied database. The SDK carries no typed reason for this, so
 * the discriminator is the CLI's error string, matched against the result's raw `errors` entries.
 */
function isConversationNotFoundFailure(error: unknown): boolean {
  return (
    error instanceof ClaudeCodeResultError &&
    error.subtype === 'error_during_execution' &&
    error.errors.some((entry) => /no conversation found with session id/i.test(entry))
  )
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

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = []
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = []
  private closed = false

  push(item: T): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ value: item, done: false })
      return
    }
    this.items.push(item)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ value: undefined as T, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift()
        if (item) return Promise.resolve({ value: item, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as T, done: true })
        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve)
        })
      }
    }
  }
}

class SdkInputQueue implements AsyncIterable<SDKUserMessage> {
  private readonly messages: SDKUserMessage[] = []
  private waitResolve?: (value: IteratorResult<SDKUserMessage>) => void
  private closed = false

  push(message: SDKUserMessage): void {
    if (this.closed) return
    if (this.waitResolve) {
      const resolve = this.waitResolve
      this.waitResolve = undefined
      resolve({ value: message, done: false })
      return
    }
    this.messages.push(message)
  }

  close(): void {
    this.closed = true
    if (this.waitResolve) {
      const resolve = this.waitResolve
      this.waitResolve = undefined
      resolve({ value: undefined as unknown as SDKUserMessage, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const next = this.messages.shift()
        if (next) return Promise.resolve({ value: next, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as unknown as SDKUserMessage, done: true })
        return new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          this.waitResolve = resolve
        })
      }
    }
  }
}

class ClaudeCodeRuntimeConnection implements AgentRuntimeConnection {
  private readonly eventQueue = new AsyncEventQueue<AgentRuntimeEvent>()
  private sdkInputQueue = new SdkInputQueue()
  private readonly abortController = new AbortController()
  private query?: Query
  /** The exact spawn options of the live query — the stale-resume retry re-spawns from these. */
  private spawnOptions?: Options
  private lastSdkUserMessage?: SDKUserMessage
  private staleResumeRetried = false
  /** Session-scoped: dispatches every message for the connection's lifetime, resetting per turn. */
  private adapter?: ClaudeCodeStreamAdapter
  private adapterModelId?: string
  private approvalEmitter?: ToolApprovalEmitterHolder
  private mcpToolMetadata?: Record<string, McpToolDisplayMetadata>
  private resumeToken?: string
  private toolPolicySnapshot?: ClaudeAgentToolPolicySnapshot
  private steerHolder?: SteerHolder
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
  /** Set when the PreToolUse hook injects a steer; the next top-level assistant `message_start`
   *  emits a `steer-boundary` (rolls A1a + A2) and clears this. */
  private steerBoundaryPending?: AgentRuntimeUserInput[]

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
      this.resumeToken,
      this.input.modelId,
      this.input.reasoningEffort ?? 'default',
      this.input.fastMode === true,
      this.input.knowledgeBaseIds
    )
    if (!request) {
      throw new Error(`Unable to build Claude Code query options for agent session ${this.input.sessionId}`)
    }
    this.connectionConfig = request.connectionConfig
    this.assistantFileToolsEnabled = Boolean(request.settings.mcpServers?.['assistant-files'])

    const traceEnv = await this.prepareTraceEnv()
    const options: Options = {
      ...request.options,
      ...(traceEnv
        ? {
            env: {
              ...request.options.env,
              ...traceEnv
            }
          }
        : {}),
      abortController: this.abortController
    }
    // Env is part of the warm signature, so a traced turn asks with the OTEL vars merged in and can
    // never match a query parked without them: the mismatch cold-starts and disposes the stale park,
    // which is exactly what tracing needs (env is fixed at spawn). No trace branch required here.
    const consumedWarmQuery = await application.get('ClaudeCodeWarmQueryManager').consume({
      key: request.key,
      options,
      initializeTimeoutMs: request.initializeTimeoutMs,
      credentialsFingerprint: request.credentialsFingerprint,
      usageCapture: request.usageCapture,
      knowledgeBaseIds: request.knowledgeBaseIds
    })

    // A matching warm process may have selected a different rotated key when
    // it was started. Its receipt, not the freshly materialized request's,
    // describes the credential that will actually serve this connection.
    this._usageCapture = consumedWarmQuery?.usageCapture ?? request.usageCapture
    this.spawnOptions = options
    this.query = consumedWarmQuery
      ? consumedWarmQuery.warmQuery.query(this.sdkInputQueue)
      : createClaudeQuery({ prompt: this.sdkInputQueue, options })
    this.adapterModelId = request.sdkModelId
    this.mcpToolMetadata = request.settings.mcpToolMetadata
    // Session-scoped: it must exist before the query loop starts so `system/init` — which can land
    // before any turn opens — is dispatched by the adapter rather than parked by the driver.
    this.adapter = this.createAdapter(this.adapterModelId ?? this.input.modelId)
    this.approvalEmitter = request.settings.approvalEmitter
    // Bind the approval emit once for the connection's lifetime — it only pushes into the connection
    // event queue, so it never varies per turn. (The prior per-turn rebind was the mirror of the
    // now-removed per-turn dispose; both gone, the emitter is plainly session-scoped.)
    this.bindApprovalEmitter()
    this.toolPolicySnapshot = request.settings.toolPolicySnapshot
    this.steerHolder = request.settings.steerHolder
    registerMcpSessionCatalogSync(
      this.input.sessionId,
      this.input.agentId,
      request.connectionConfig?.live.toolPolicy.mcps ?? [],
      this.mcpToolMetadata
    )
    // Arm a `steer-boundary` when the PreToolUse hook injects a steer this turn. Bound on the live
    // connection (not the warm prewarm) so the boundary is observed by this connection's query loop.
    if (this.steerHolder) {
      this.steerHolder.onInjected = (inputs) => {
        this.steerBoundaryPending = inputs
        // Reserve the host continuation synchronously before the hook returns. A gateway-backed
        // subprocess can issue its next provider request before the later `message_start` reaches
        // this query loop, so the async `steer-boundary` event is too late for request correlation.
        this.input.onSteerInjected?.(inputs)
      }
    }
    void this.runQueryLoop()
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
    if (isFastSlashCommand(input)) {
      throw new Error('The /fast command is unavailable; use the host Fast control instead')
    }

    this.adapter?.beginTurn()

    const sdkMessage = await toSdkUserMessage(input.message, this.resumeToken, input.systemReminder, {
      supportsAttachmentReads: this.assistantFileToolsEnabled,
      supportsImages: resolveModelImageSupport(this.input.modelId)
    })
    this.lastSdkUserMessage = sdkMessage
    this.sdkInputQueue.push(sdkMessage)
  }

  redirect(input: AgentRuntimeUserInput): boolean {
    // The hook can only inject text (`extractSteerText` drops everything else), so accept a steer only
    // when every part is one we know survives that reduction — fail closed on anything new rather than
    // silently swallowing it. `data-knowledge-scope` qualifies because the host's fold gate has already
    // proven the incoming effective scope equals the live turn's, making the part redundant here; a
    // `file` part does not, so it is declined and the host queues it as the next SDK turn immediately
    // instead of stranding it in session-scoped state until this turn ends.
    const isInjectableSteerPart = (part: { type: string }) =>
      part.type === 'text' || part.type === 'data-knowledge-scope'
    const canInject = input.message.data?.parts?.every(isInjectableSteerPart) ?? true
    // A steer is only injectable into a running turn. The adapter lives for the whole connection,
    // so its turn flag — not its existence — reports whether one is open.
    if (!this.adapter?.isTurnActive || !this.steerHolder || !canInject) return false
    // Stash for the PreToolUse steer hook to inject as `additionalContext` before the next tool runs.
    // If the turn ends with no tool call, runQueryLoop emits `steer-undelivered` and the host queues it.
    this.steerHolder.pending.push(input)
    return true
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
    if (!this.query) return 'rebuild'
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
    const deferPermissionMode = permissionModeChanged && this.adapter?.isTurnActive === true
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
          await this.query.setPermissionMode((fresh.live.toolPolicy.permissionMode ?? 'default') as AgentPermissionMode)
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
    if (!this.query) return null
    try {
      return await this.query.getContextUsage()
    } catch (error) {
      logger.warn('getContextUsage failed', { sessionId: this.input.sessionId, error })
      return null
    }
  }

  async getSupportedCommands(): Promise<AgentSessionSlashCommand[] | null> {
    if (!this.query) return null
    try {
      return (await this.query.supportedCommands()).filter((command) => !isHostManagedSlashCommand(command))
    } catch (error) {
      logger.warn('getSupportedCommands failed', { sessionId: this.input.sessionId, error })
      return null
    }
  }

  async stopTask(taskId: string): Promise<boolean> {
    if (!this.query) return false
    try {
      await this.query.stopTask(taskId)
      return true
    } catch (error) {
      logger.warn('stopTask failed', { sessionId: this.input.sessionId, taskId, error })
      return false
    }
  }

  close(): void {
    this.settlePendingInvocations()
    this.sdkInputQueue.close()
    this.abortController.abort('agent-runtime-closed')
    this.steerBoundaryPending = undefined
    this.teardownSession()
    this.query?.close()
    this.eventQueue.close()
  }

  private async runQueryLoop(): Promise<void> {
    try {
      for await (const message of this.query!) {
        // A steer was injected this turn → the first TOP-LEVEL assistant message after it (the model's
        // post-steer response; subagent/nested messages carry a parent_tool_use_id and are skipped) is
        // where the host rolls A1a + A2. Emit the boundary BEFORE the adapter handles this message so it
        // lands ahead of A2's content chunks in the event stream. (message_start is a no-op in the adapter.)
        if (
          this.steerBoundaryPending &&
          message.type === 'stream_event' &&
          message.event.type === 'message_start' &&
          message.parent_tool_use_id == null
        ) {
          this.commitPendingInvocations()
          this.eventQueue.push({ type: 'steer-boundary', inputs: this.steerBoundaryPending })
          this.steerBoundaryPending = undefined
        }

        const messageAssociation = this.adapter!.isTurnActive ? 'current-turn' : 'stateless'
        if (message.type === 'stream_event') this.captureStreamInvocation(message, messageAssociation)
        if (message.type === 'assistant') this.captureAssistantInvocation(message, messageAssociation)

        let result: ReturnType<ClaudeCodeStreamAdapter['handleMessage']>
        try {
          // `start()` builds the session-scoped adapter before the loop, so it is always present here.
          result = this.adapter!.handleMessage(message)
        } catch (error) {
          this.settlePendingInvocations()
          throw error
        }
        if (result.type === 'result') {
          this.commitPendingInvocations()
          this.updateResumeToken(result.sessionId)
          // The steer was injected but no post-steer top-level assistant message followed (rare; the
          // turn ended right after the gated tool). Drop the arm — no boundary, no empty A2.
          this.steerBoundaryPending = undefined
          // `readUIMessageStream` only reads token counts from `message-metadata`
          // chunks. The streamAdapter's V3-shaped `finish.usage` is ignored, so
          // we project the SDK BetaUsage onto a UIMessageChunk here — keeping
          // the chunk shape identical to `attachUsageObserver` (AI SDK runtime).
          this.emitUsageMetadata(result.message.usage)
          // NOTE: do NOT dispose the approval emitter here. It is session-scoped — it lives across
          // turns on the warm connection and is torn down only on close/error (below). Disposing it
          // per turn evicted the session emitter, so the next turn's `canUseTool` resolved no emitter
          // and denied with "Approval emitter not ready" (the approval never reached the renderer).
          // Steers not injected by the hook this turn (the turn called no tool after they arrived) →
          // hand them back so the host queues them as the next turn (the steer_undelivered fallback).
          this.emitPendingSteersAsUndelivered()
          this.eventQueue.push({ type: 'turn-complete' })
        }
      }
    } catch (error) {
      this.settlePendingInvocations()
      if (this.tryRecoverFromStaleResume(error)) {
        // `await` is load-bearing: without it the finally below closes the event queue while the
        // recovered loop is still streaming.
        return await this.runQueryLoop()
      }
      // The Claude Code SDK sometimes ends the stream abruptly mid-output. When
      // enough text was already buffered, salvage it as a truncated turn (the
      // adapter emits the buffered text + a `truncated` finish through the sink)
      // instead of dropping the partial response and surfacing an error.
      const salvaged = this.adapter?.handleTruncationError(error) ?? false
      if (!salvaged && !this.abortController.signal.aborted) {
        logger.error('Claude Code query loop failed', {
          sessionId: this.input.sessionId,
          modelId: this.adapterModelId ?? this.input.modelId,
          error
        })
      }
      // The query stream ended (errored) → the connection is dead; tear the whole session down here
      // rather than relying on a later close() to dispose the steer holder / snapshot.
      this.emitPendingSteersAsUndelivered()
      this.teardownSession()
      this.eventQueue.push(salvaged ? { type: 'turn-complete' } : { type: 'error', error })
    } finally {
      this.settlePendingInvocations()
      this.query = undefined
      this.eventQueue.close()
    }
  }

  /**
   * A stale persisted resume token kills the CLI before it does any work ("No conversation found").
   * Degrade instead of failing the turn: re-spawn once WITHOUT the resume token on a fresh input
   * queue (the dead query's iterator still holds the old one), and replay the pending user message
   * so the turn continues on a new conversation. The recovered init reports a new session id, which
   * the host persists on the next assistant row — the stale token heals itself after one good turn.
   * Context from the lost conversation is gone; that is the accepted cost of the degradation.
   */
  private tryRecoverFromStaleResume(error: unknown): boolean {
    if (this.staleResumeRetried || !this.resumeToken || !this.spawnOptions) return false
    if (!isConversationNotFoundFailure(error) || this.abortController.signal.aborted) return false
    this.staleResumeRetried = true

    logger.warn('Persisted resume token no longer resolves to a CLI conversation; retrying without it', {
      sessionId: this.input.sessionId,
      staleResumeToken: this.resumeToken
    })
    this.resumeToken = undefined
    // Tell the user, in the transcript itself, that the prior conversation could not be found and
    // the reply below starts fresh. Persisted with the recovered turn like any other data part.
    this.eventQueue.push({
      type: 'chunk',
      chunk: { type: 'data-conversation-reset', id: crypto.randomUUID(), data: {} }
    })
    this.sdkInputQueue.close()
    this.sdkInputQueue = new SdkInputQueue()
    if (this.lastSdkUserMessage) {
      this.sdkInputQueue.push({ ...this.lastSdkUserMessage, session_id: '' })
    }
    this.query = createClaudeQuery({
      prompt: this.sdkInputQueue,
      options: { ...this.spawnOptions, resume: undefined }
    })
    return true
  }

  private createAdapter(modelId: string): ClaudeCodeStreamAdapter {
    return new ClaudeCodeStreamAdapter({
      modelId,
      sessionId: this.input.sessionId,
      streamOptions: {} as never,
      sink: {
        enqueue: (chunk) => this.eventQueue.push({ type: 'chunk', chunk })
      },
      statusSink: {
        emit: (event) => {
          // Mirror `getSupportedCommands`: host-managed commands never reach the catalog, whether it
          // arrives at init or as a mid-session `commands_changed` push.
          if (event.type === 'supported-commands') {
            this.eventQueue.push({
              ...event,
              commands: event.commands.filter((command) => !isHostManagedSlashCommand(command))
            })
            return
          }
          this.eventQueue.push(event)
        }
      },
      onSessionId: (resumeToken) => this.updateResumeToken(resumeToken),
      mcpToolMetadata: this.mcpToolMetadata
    })
  }

  private emitPendingSteersAsUndelivered(): void {
    const undelivered = this.steerHolder?.pending.splice(0) ?? []
    if (undelivered.length > 0) this.eventQueue.push({ type: 'steer-undelivered', inputs: undelivered })
  }

  private bindApprovalEmitter(): void {
    if (!this.approvalEmitter) return
    this.approvalEmitter.emit = (request) => this.eventQueue.push({ type: 'tool-approval-request', request })
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
    this.steerHolder?.dispose()
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

    const next = pendingInvocationFromAssistant(message, messageAssociation, this.adapterModelId ?? this.input.modelId)
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
        model: resolveSdkInvocationModel(sdkMessage.model, this.adapterModelId ?? this.input.modelId),
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
        requestId: pending.requestId,
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
 * Build SDK user content from a message entity. When the model supports vision,
 * supported image attachments (png, jpeg, gif, webp) are materialized into native
 * Anthropic image blocks; otherwise first-party images are OCR'd to text by the
 * shared routing, like first-party non-image files. Ordinary Agents forward first-party
 * archives as tool-readable paths, while Cherry Assistant keeps them behind opaque
 * attachment handles. External files and images that cannot be materialized fall back
 * to local paths when available.
 *
 * **Side effect**: performs file I/O via {@link materializeNativeFilePart}.
 */
async function materializeUserContent(
  message: AgentSessionMessageEntity,
  supportsImages: boolean,
  supportsAttachmentReads: boolean
): Promise<SDKUserMessage['message']['content']> {
  const parts = message.data?.parts ?? []
  const firstPartyArchiveParts = parts.filter(
    (part): part is FileUIPart =>
      !supportsAttachmentReads &&
      part.type === 'file' &&
      Boolean(readCherryMeta(part)?.fileEntryId) &&
      isArchiveFilePart(part)
  )
  const firstPartyParts = parts.filter(
    (part) =>
      part.type === 'text' ||
      (part.type === 'file' &&
        Boolean(readCherryMeta(part)?.fileEntryId) &&
        (supportsAttachmentReads || !isArchiveFilePart(part)))
  )
  const externalFileParts = parts.filter(
    (part): part is FileUIPart => part.type === 'file' && !readCherryMeta(part)?.fileEntryId
  )
  const originalFirstPartyFiles = new Map(
    firstPartyParts
      .filter((part): part is FileUIPart => part.type === 'file')
      .map((part) => [readCherryMeta(part)?.fileEntryId, part] as const)
      .filter((entry): entry is [string, FileUIPart] => Boolean(entry[0]))
  )

  let routedParts = firstPartyParts
  let turnAttachments: ReturnType<typeof collectAssistantFileAttachments> = []
  if (firstPartyParts.some((part) => part.type === 'file')) {
    const userMessage = { id: message.id, role: 'user', parts: firstPartyParts } as CherryUIMessage
    const attachments = supportsAttachmentReads
      ? collectAssistantFileAttachments([userMessage])
      : collectFileAttachments([userMessage])
    if (supportsAttachmentReads) turnAttachments = attachments
    const [prepared] = await prepareChatMessages([userMessage], {
      attachments,
      nativeSupport: { image: supportsImages, pdf: false, audio: false, video: false },
      isToolCapable: supportsAttachmentReads
    })
    routedParts = prepared.parts
  }

  const text = routedParts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
  const images: ImageBlockParam[] = []
  const fallbackParts: FileUIPart[] = []
  const unavailableParts: FileUIPart[] = []

  for (const part of [
    ...routedParts.filter((part): part is FileUIPart => part.type === 'file'),
    ...firstPartyArchiveParts,
    ...externalFileParts
  ]) {
    const fileEntryId = readCherryMeta(part)?.fileEntryId
    const originalPart = (fileEntryId && originalFirstPartyFiles.get(fileEntryId)) || part
    const isArchive = isArchiveFilePart(originalPart)
    const isFirstPartyArchive = Boolean(readCherryMeta(originalPart)?.fileEntryId) && isArchive
    if (isFirstPartyArchive && supportsAttachmentReads) continue
    if (isArchive || !supportsImages || !canBeClaudeImage(part)) {
      const target = originalPart.url?.startsWith('file://') ? fallbackParts : unavailableParts
      target.push(originalPart)
      continue
    }

    const preparedDataUrl = part.url ? parseDataUrl(part.url) : null
    let parsed = preparedDataUrl?.isBase64 ? preparedDataUrl : null
    if (!parsed) {
      const materialized = await materializeNativeFilePart(part)
      if (!materialized) {
        unavailableParts.push(originalPart)
        continue
      }
      parsed = materialized.url ? parseDataUrl(materialized.url) : null
    }

    if (!parsed?.isBase64 || parsed.data.length === 0) {
      unavailableParts.push(originalPart)
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

    if (originalPart.url?.startsWith('file://')) {
      fallbackParts.push(originalPart)
    } else {
      unavailableParts.push(originalPart)
    }
  }

  const paths = extractAttachmentPaths(fallbackParts)
  let textContent = appendAttachmentPaths(text, paths)
  if (supportsAttachmentReads) textContent = appendAttachmentManifest(textContent, turnAttachments)
  if (unavailableParts.length > 0) {
    const names = unavailableParts.map((part) => part.filename || 'attachment')
    logger.warn('Claude Code attachments could not be sent', { attachments: names })
    const note = `Unavailable attachments: ${names.join(', ')}`
    textContent = textContent.trim() ? `${textContent}\n\n${note}` : note
  }
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

function appendAttachmentPaths(text: string, paths: string[]): string {
  if (paths.length === 0) return text

  const list = paths.map((path) => `- ${path}`).join('\n')
  const section = `Attached files (read them with your tools using these absolute paths):\n${list}`
  return text.trim() ? `${text}\n\n${section}` : section
}

/** Absolute local paths of `file://`-backed attachment parts (shared path extraction). */
function extractAttachmentPaths(parts: Array<{ type: string; url?: string }>): string[] {
  const paths: string[] = []
  for (const part of parts) {
    if (part.type !== 'file' || !part.url?.startsWith('file://')) continue
    paths.push(fileURLToPath(part.url))
  }
  return paths
}

function isArchiveFilePart(part: FileUIPart): boolean {
  const filename = part.filename?.toLowerCase()
  return filename ? archiveExts.some((extension) => filename.endsWith(extension)) : false
}

function canBeClaudeImage(part: FileUIPart): boolean {
  const mediaType = part.mediaType?.toLowerCase()
  if (!mediaType || mediaType === 'application/octet-stream' || mediaType.startsWith('image/')) return true

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
  readonly type = 'claude-code'
  readonly capabilities = ['agent-session'] as const

  async validateSession(session: AgentSessionEntity): Promise<void> {
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
    return new ClaudeCodeRuntimeConnection(input).start()
  }

  onSessionIdle(sessionId: string): void {
    // `prewarmAgentSession` bakes the session's trace env when trace mode is on, so the park it
    // leaves behind matches what the next turn asks for either way — no driver-side guard needed.
    void application.get('ClaudeCodeWarmQueryManager').prewarmAgentSession(sessionId)
  }
}
