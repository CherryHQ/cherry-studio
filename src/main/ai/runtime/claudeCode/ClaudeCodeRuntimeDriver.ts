import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { validate as isUuid } from 'uuid'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { loggerService } from '@logger'
import { logAiFailure } from '@main/ai/errorReporting'
import type { ClaudeAgentToolPolicySnapshot } from '@main/ai/tools/adapters/claudeCode/agentTools'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { isUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import { LocalAgentSessionRestoreError } from '../LocalAgentSessionRestoreError'
import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeReconcileResult,
  AgentSessionRuntimeDriver
} from '../types'
import { type UnavailableNativeContext, unavailableNativeContext } from '../types'
import {
  buildClaudeCodeQueryRequestForAgentSession,
  type ConnectionConfig,
  deriveConnectionConfig,
  toolPolicyFactsEqual
} from './agentSessionWarmup'
import { createClaudeCodeProcessDiagnostics, createSpawnClaudeCodeProcess } from './ClaudeCodeProcessManager'
import { claudeBranchQueryIdentity } from './claudeContext'
import { forkClaudeSession } from './claudeFork'
import { ClaudeSdkConnection } from './ClaudeSdkConnection'
import { classifyClaudeFailure } from './failureFacts'
import { ClaudeForkCheckpointSchema } from './forkCheckpoint'
import {
  AgentSessionWorkspaceError,
  disposeToolPolicySnapshot,
  prepareClaudeCodeWorkspaceDirectory,
  registerMcpSessionCatalogSync
} from './settingsBuilder'
import { claudeWorkspaceRelocation } from './workspaceRelocation'

const logger = loggerService.withContext('ClaudeCodeRuntimeDriver')

function getChangedRebuildFacts(baseline: ConnectionConfig, fresh: ConnectionConfig): string[] {
  const baselineFacts = baseline.rebuildFactFingerprints
  const freshFacts = fresh.rebuildFactFingerprints
  if (!baselineFacts || !freshFacts) return ['unknown']

  const changedFacts = [...new Set([...Object.keys(baselineFacts), ...Object.keys(freshFacts)])]
    .filter((name) => baselineFacts[name] !== freshFacts[name])
    .sort()
  return changedFacts.length > 0 ? changedFacts : ['unknown']
}

class ClaudeCodeRuntimeConnection extends ClaudeSdkConnection<AgentRuntimeConnectInput & { modelId: UniqueModelId }> {
  private toolPolicySnapshot?: ClaudeAgentToolPolicySnapshot
  /** Staleness identity captured by the materialized request; live facts advance during reconcile. */
  private connectionConfig?: ConnectionConfig
  /** Serializes reconciles per connection so push/pull can't interleave SDK and snapshot writes. */
  private reconcileChain: Promise<unknown> = Promise.resolve()

  constructor(input: AgentRuntimeConnectInput) {
    if (!isUniqueModelId(input.modelId)) throw new Error('Provider model required')
    super({ ...input, modelId: input.modelId })
  }

  async start(): Promise<this | UnavailableNativeContext> {
    // Route with the host-chosen model, not a fresh DB read: a live turn's connection must serve
    // the model captured when that turn was created, even if the agent was edited since.
    const storedResume = messages.getLastRuntimeResumeToken(this.input.sessionId, this.input.branchHead)
    const request = await buildClaudeCodeQueryRequestForAgentSession(
      this.input.sessionId,
      storedResume,
      this.input.modelId,
      this.input.reasoningEffort ?? 'default',
      this.input.fastMode === true,
      this.input.knowledgeBaseIds,
      this.input.serviceTier,
      this.input.headless === true,
      this.input.permissionModeOverride
    )
    if (!request) {
      throw new Error(`Unable to build Claude Code query options for agent session ${this.input.sessionId}`)
    }
    this.connectionConfig = request.connectionConfig
    this.approvalEmitter = request.settings.approvalEmitter
    this.assistantFileToolsEnabled = Boolean(request.settings.mcpServers?.['assistant-files'])
    this.context = this.prepareContext(
      request.options.env,
      storedResume ?? request.options.resume ?? this.input.nativeSessionId,
      this.input.branchHead,
      true
    )
    if (!this.context.nativeThreadId || !isUuid(this.context.nativeThreadId))
      return unavailableNativeContext(this.context, 'Invalid Claude session identity')

    const traceEnv = await this.prepareTraceEnv()
    const coldProcessDiagnostics = createClaudeCodeProcessDiagnostics()
    const options: Options = {
      ...request.options,
      ...claudeBranchQueryIdentity(this.context, storedResume ?? undefined),
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
    if (!options.resume) this.resumeToken = undefined
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
    this.sdkModelId = request.sdkModelId
    this.mcpToolMetadata = request.settings.mcpToolMetadata
    this.toolPolicySnapshot = request.settings.toolPolicySnapshot
    this.toolPolicySnapshot?.setPermissionMode(request.connectionConfig?.live.toolPolicy.permissionMode ?? undefined)
    registerMcpSessionCatalogSync(
      this.input.sessionId,
      this.input.agentId,
      request.connectionConfig?.live.toolPolicy.mcps ?? [],
      this.mcpToolMetadata
    )
    try {
      return await this.startSdk(options, this.context, request.contextWindow, consumedWarmQuery)
    } catch (error) {
      if (error instanceof LocalAgentSessionRestoreError) return unavailableNativeContext(this.context, error.message)
      throw error
    }
  }

  async reconcile(input: Parameters<AgentRuntimeConnection['reconcile']>[0]): Promise<AgentRuntimeReconcileResult> {
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

  private async reconcileOnce(
    input: Parameters<AgentRuntimeConnection['reconcile']>[0]
  ): Promise<AgentRuntimeReconcileResult> {
    if (!this.handle) return 'rebuild'
    if (!isUniqueModelId(input.modelId)) return 'invalid'
    const derived = await deriveConnectionConfig(
      this.input.sessionId,
      input.modelId,
      input.reasoningEffort ?? 'default',
      input.fastMode === true,
      input.knowledgeBaseIds,
      input.serviceTier,
      input.headless === true,
      input.permissionModeOverride
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
          this.toolPolicySnapshot?.setPermissionMode(fresh.live.toolPolicy.permissionMode ?? undefined)
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

  protected disposeSettings() {
    disposeToolPolicySnapshot(this.input.sessionId)
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
    let connection = new ClaudeCodeRuntimeConnection(input)
    try {
      const opened = await connection.start()
      if (!('status' in opened)) return opened
      await connection.close()
      contexts.rebuildFileBranch(opened.context)
      logger.warn('Rebuilding Claude context from session messages', {
        sessionId: input.sessionId,
        reason: opened.reason
      })
      connection = new ClaudeCodeRuntimeConnection(input)
      const rebuilt = await connection.start()
      if (!('status' in rebuilt)) return rebuilt
      throw new Error(rebuilt.reason)
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
