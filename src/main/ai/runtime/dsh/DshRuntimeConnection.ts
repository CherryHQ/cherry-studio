import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import {
  BRIDGE_SOCKET_ENV,
  BRIDGE_TOKEN_ENV,
  type BridgePermissionMode,
  type BridgePolicy
} from '@cherrystudio/dsh-bridge'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { HarnessClient, NotificationSubscription } from '@deepseek-ai/dsh-sdk-client'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import { loggerService } from '@logger'
import { ensureAgentDataDirectory } from '@main/ai/agents/agentDataDirectory'
import { resolveAgentCapabilities, resolveMountedMcpServers } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { buildAgentMcpServers } from '@main/ai/runtime/agentMcpServers'
import { buildAgentRuntimePrompt } from '@main/ai/runtime/agentPrompt'
import { buildAgentUserContent } from '@main/ai/runtime/agentUserContent'
import { buildCitationsGuidance } from '@main/ai/runtime/citationsGuidance'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { resolveKnowledgeBaseScope } from '@main/ai/utils/knowledgeScope'
import { getBinaryExecutionEnv, getBinarySearchDirs, mergePathSuffixes } from '@main/utils/binaryEnv'
import { getPathFromEnvironment, getRawShellEnv } from '@main/utils/shellEnv'
import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'
import {
  KB_READ_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME
} from '@shared/ai/builtinTools'
import { type DshBuiltinToolDescriptor, getDshRuntimeBuiltinTools } from '@shared/ai/dshBuiltinTools'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { UniqueModelId } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

import { ApiGatewayNotRunningError } from '../agentApiGateway'
import { AsyncEventQueue } from '../AsyncEventQueue'
import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeReconcileResult,
  AgentRuntimeTraceContext,
  AgentSessionUsageCapture
} from '../types'
import { buildDshCompositionYaml, resolveDshRuntimeBinPath } from './compositionBuilder'
import { DshBridgeServer } from './DshBridgeServer'
import {
  buildDshCherryToolBridge,
  buildDshCherryToolName,
  DSH_APPROVAL_REQUIRED_BRIDGED_TOOLS,
  DSH_AUTO_APPROVED_BRIDGED_TOOLS,
  DSH_NON_BYPASSABLE_APPROVAL_BRIDGED_TOOLS,
  type DshCherryToolBridge,
  warmDshMcpToolCatalogs
} from './DshCherryToolBridge'
import { DshSubagentCoordinator, type DshSubagentSink } from './dshChildFlow'
import {
  captureDshConnectionSnapshot,
  type DshConnectionSnapshot,
  DshInvalidConnectionSnapshotError
} from './dshConnectionSignature'
import { loadDshSdk } from './dshSdk'
import { type DshInvocationMetrics, DshStreamAdapter } from './dshStreamAdapter'
import { DshTraceRecorder } from './dshTrace'
import { type DshProviderInjection, resolveDshProviderInjectionFromSnapshot, usesDshGateway } from './modelInjection'

const logger = loggerService.withContext('DshRuntimeConnection')

const DSH_TOOL_DESCRIPTORS: readonly DshBuiltinToolDescriptor[] = getDshRuntimeBuiltinTools(process.platform)
const DSH_READ_TOOLS = DSH_TOOL_DESCRIPTORS.filter((tool) => tool.permissionClass === 'read').map((tool) => tool.name)
const DSH_EDIT_TOOLS = DSH_TOOL_DESCRIPTORS.filter((tool) => tool.permissionClass === 'edit').map((tool) => tool.name)
// Class-less `approval: 'auto'` built-ins (todo_write, goal state ops): session-log-only side
// effects, no path to contain — auto-allow per the descriptor contract instead of fail-closed ask.
const DSH_AUTO_APPROVED_BUILTIN_TOOLS = DSH_TOOL_DESCRIPTORS.filter(
  (tool) => tool.approval === 'auto' && tool.permissionClass === undefined
).map((tool) => tool.name)
// Builtins that stay executable in plan mode (descriptor opt-in) — the subagent
// family is auto-approved yet NOT plan-safe: delegation would bypass read-only.
const DSH_PLAN_SAFE_BUILTIN_TOOLS = DSH_TOOL_DESCRIPTORS.filter((tool) => tool.planSafe).map((tool) => tool.name)
const DSH_BUILTIN_TOOL_ALIASES = new Map(DSH_TOOL_DESCRIPTORS.map((tool) => [tool.name.toLowerCase(), tool.name]))
const DSH_SHELL_TOOL_NAME = DSH_TOOL_DESCRIPTORS.find((tool) => tool.category === 'shell')?.name
if (DSH_SHELL_TOOL_NAME) {
  DSH_BUILTIN_TOOL_ALIASES.set('bash', DSH_SHELL_TOOL_NAME)
  DSH_BUILTIN_TOOL_ALIASES.set('pwsh', DSH_SHELL_TOOL_NAME)
}

export class DshRuntimeConnection implements AgentRuntimeConnection {
  private readonly generation = randomUUID()
  private readonly eventQueue = new AsyncEventQueue<AgentRuntimeEvent>()
  private readonly committedInvocationIds = new Set<string>()
  private readonly adapter = new DshStreamAdapter({
    enqueue: (chunk) => {
      this.subagents.noteMainChunk(chunk)
      this.eventQueue.push({ type: 'chunk', chunk })
    },
    onAssistantUsage: (info) => this.recordProviderInvocation(info),
    onTurnEnd: (reason) => this.handleTurnEnd(reason),
    onCompaction: (event) => this.eventQueue.push(event),
    onApiRetry: (retry) => this.eventQueue.push({ type: 'api-retry', retry }),
    onAutonomousTurnState: (state) => {
      // Reconcile treats a goal round like any live turn: policy swaps wait for idle.
      if (state === 'started') this.markTurnActive()
      this.eventQueue.push({ type: 'autonomous-turn-state', state })
    },
    onPlanMode: (active) => this.handlePlanModeFold(active)
  })
  private readonly subagents: DshSubagentCoordinator
  private bridge?: DshBridgeServer
  private toolBridge?: DshCherryToolBridge
  private traceRecorder?: DshTraceRecorder
  private traceContext?: AgentRuntimeTraceContext
  private client?: HarnessClient
  private subscription?: NotificationSubscription
  private compositionPath?: string
  private resumeToken?: string
  private closed = false
  private turnActive = false
  /** Monotonic host-turn identity; child items pin it at open so they never split across streams. */
  private turnEpoch = 0
  private modelId = ''
  private contextWindow = 0
  private reasoningEffort: ReasoningEffortOption = 'default'
  private workspacePath = ''
  private agentDataPath = ''
  /** Live tool policy pushed to the bridge plugin at open and on reconcile. */
  private permissionMode: BridgePermissionMode = 'default'
  /**
   * The runtime's committed `plan/mode` fold. dsh self-exits plan on an approved
   * review WITHOUT Cherry rewriting the stored mode (claude parity), so the
   * effective policy derives from stored mode + this overlay, and reconcile
   * comparisons keep using the stored mode alone.
   */
  private runtimePlanActive?: boolean
  private disabledTools = new Set<string>()
  /** Spawn-frozen agent/model facts, excluding the live permission gate. */
  private connectionSignature?: string
  /** Serializes push/pull reconciles so snapshot reads and live policy writes cannot land out of order. */
  private reconcileChain: Promise<unknown> = Promise.resolve()
  private _usageCapture?: AgentSessionUsageCapture

  readonly events = this.eventQueue

  get usageCapture(): AgentSessionUsageCapture | undefined {
    return this._usageCapture
  }

  constructor(private readonly input: AgentRuntimeConnectInput) {
    this.resumeToken = input.resumeToken
    this.traceContext = input.trace
    // Constructor-body creation: parameter properties are not yet assigned while
    // field initializers run, so `input.sessionId` is unavailable up there.
    this.subagents = new DshSubagentCoordinator(input.sessionId, this.buildSubagentSink())
  }

  /** Bridge-socket events. A stream-presented approval whose `tool/call` has not landed yet would
   *  truncate the turn accumulator instead of showing a card, so materialize its tool part first. */
  private emitBridgeEvent(event: AgentRuntimeEvent): void {
    if (event.type === 'tool-approval-request' && event.request.presentation === 'stream') {
      this.adapter.ensureToolCall(event.request.toolCallId, event.request.toolName, event.request.input)
    }
    this.eventQueue.push(event)
  }

  /** Flip the live-turn flag; a false→true edge opens a NEW host turn identity. */
  private markTurnActive(): void {
    if (!this.turnActive) this.turnEpoch += 1
    this.turnActive = true
  }

  private buildSubagentSink(): DshSubagentSink {
    return {
      currentTurnToken: () => (this.turnActive ? this.turnEpoch : null),
      emitFlowChunk: (rootToolCallId, chunk, turnToken) => {
        if (this.closed) return
        // Mid-turn nested content rides the live stream (the host hides parented
        // parts from the main transcript) — but ONLY chunks whose item opened in
        // THIS turn. A stale pin falls back to the background-flow patch, whose
        // accumulator tolerates orphans; the turn stream's does not (it dies
        // silently and the whole turn persists empty).
        if (turnToken !== null && turnToken === this.turnEpoch && this.turnActive) {
          this.eventQueue.push({ type: 'chunk', chunk })
        } else {
          this.eventQueue.push({ type: 'background-flow-chunk', rootToolCallId, chunk })
        }
      },
      emitTaskEvent: (data, edgeId) => {
        if (this.closed) return
        this.eventQueue.push({ type: 'background-task-event', data })
        if (this.turnActive) {
          this.eventQueue.push({
            type: 'chunk',
            chunk: { type: 'data-agent-task-event', id: `task-${data.taskId}-${edgeId}`, data }
          })
        }
      },
      emitTasks: (tasks) => {
        if (!this.closed) this.eventQueue.push({ type: 'background-tasks', tasks })
      },
      emitWorkState: (active) => {
        if (!this.closed) this.eventQueue.push({ type: 'background-work-state', active })
      },
      recordChildUsage: (info) =>
        this.recordProviderInvocation(
          {
            turn: info.turn,
            seq: info.seq,
            usage: info.usage,
            ...(info.model !== undefined ? { model: info.model } : {})
          },
          info.childSessionId
        )
    }
  }

  async start(): Promise<this> {
    if (this.input.resumeToken) assertValidDshResumeToken(this.input.resumeToken)
    const resolveInjection = async (snapshot: DshConnectionSnapshot): Promise<DshProviderInjection> => {
      try {
        return await resolveDshProviderInjectionFromSnapshot(
          this.input.sessionId,
          snapshot.provider,
          snapshot.model,
          snapshot.enabledApiKeys,
          this.input.reasoningEffort ?? 'default'
        )
      } catch (error) {
        if (error instanceof ApiGatewayNotRunningError) {
          application.get('IpcApiService').broadcast('api_gateway.required', { sessionId: this.input.sessionId })
        }
        throw error
      }
    }

    const discoverySnapshot = await captureDshConnectionSnapshot(
      this.input.sessionId,
      this.input.agentId,
      this.input.modelId,
      this.input.knowledgeBaseIds
    )
    // Settle Gateway startup before the authoritative snapshot; resolve again afterward so the
    // connection is built from the exact provider/model facts protected by the final check.
    if (usesDshGateway(discoverySnapshot.provider, discoverySnapshot.model)) await resolveInjection(discoverySnapshot)
    await warmDshMcpToolCatalogs(discoverySnapshot.agent.mcps ?? [])
    const snapshot = await captureDshConnectionSnapshot(
      this.input.sessionId,
      this.input.agentId,
      this.input.modelId,
      this.input.knowledgeBaseIds
    )
    const { agent, session } = snapshot
    const workspacePath = session.workspace?.path
    if (!session.agentId || !workspacePath) {
      throw new Error(`dsh agent session ${this.input.sessionId} has no agent or workspace configured`)
    }

    // dsh has no native permission modes; the bridge plugin enforces the pushed policy.
    this.permissionMode = toBridgePermissionMode(agent.configuration?.permission_mode)
    this.disabledTools = normalizeDisabledTools(agent.disabledTools)
    const injection = await resolveInjection(snapshot)
    this.modelId = injection.modelId
    this.contextWindow = injection.modelConfig.contextWindow
    this.reasoningEffort = this.input.reasoningEffort ?? 'default'
    this._usageCapture = injection.usageCapture
    this.workspacePath = workspacePath
    this.traceRecorder = new DshTraceRecorder(() => this.traceContext, {
      provider: injection.providerName,
      model: injection.modelId
    })

    const dshRoot = application.getPath('feature.agents.dsh.root')
    const sessionsRoot = application.getPath('feature.agents.dsh.sessions')
    const agentsDataRoot = application.getPath('feature.agents.data')
    this.agentDataPath = await ensureAgentDataDirectory(agentsDataRoot, agent.id)
    const toolResultRoot = path.join(this.agentDataPath, 'tool-results', 'v1', 'objects')

    const knowledgeBaseScope = resolveKnowledgeBaseScope(agent.knowledgeBaseIds, this.input.knowledgeBaseIds)
    const isToolEnabled = (serverName: string, toolName: string) =>
      !this.disabledTools.has(buildDshCherryToolName(serverName, toolName))
    const citationsGuidance = buildCitationsGuidance({
      web: isToolEnabled('cherry-tools', WEB_SEARCH_TOOL_NAME) || isToolEnabled('cherry-tools', WEB_FETCH_TOOL_NAME),
      kb:
        (resolveAgentCapabilities(agent).allKnowledgeBases || knowledgeBaseScope.length > 0) &&
        (isToolEnabled('cherry-tools', KB_SEARCH_TOOL_NAME) || isToolEnabled('cherry-tools', KB_READ_TOOL_NAME))
    })
    const prompt = await buildAgentRuntimePrompt({
      workspacePath,
      agentDataPath: this.agentDataPath,
      agent,
      citationsGuidance,
      // Compensates a custom base for the workspace context the native base owns (claude parity).
      customBaseContext: [
        '## Current Workspace',
        `Current working directory: ${JSON.stringify(workspacePath)}`,
        'Use it as the default base for file operations and shell commands; resolve unspecified or relative paths against it.'
      ].join('\n')
    })
    const persona = [prompt.base.kind === 'custom' ? prompt.base.content : undefined, prompt.append || undefined]
      .filter(Boolean)
      .join('\n\n')

    const yaml = buildDshCompositionYaml({
      providerName: injection.providerName,
      api: injection.api,
      baseUrl: injection.baseUrl,
      ...(injection.headers ? { headers: injection.headers } : {}),
      ...(injection.reasoning ? { reasoning: injection.reasoning } : {}),
      modelConfig: injection.modelConfig,
      workspacePath,
      dshRoot,
      sessionsRoot,
      permissionMode: this.permissionMode,
      persona,
      customBase: prompt.base.kind === 'custom',
      skillDirs: snapshot.additionalSkillPaths
    })
    this.compositionPath = path.join(dshRoot, 'compositions', `${this.input.sessionId}.${this.generation}.yml`)
    await mkdir(path.dirname(this.compositionPath), { recursive: true })
    await writeFile(this.compositionPath, yaml, { encoding: 'utf8', mode: 0o600 })

    try {
      const mountedServers = resolveMountedMcpServers(agent, { channelLinked: snapshot.linkedChannel !== null })
      const toolBridge = await buildDshCherryToolBridge(
        buildAgentMcpServers(
          session,
          agent,
          mountedServers,
          snapshot.mcpServerSnapshots,
          snapshot.linkedChannel,
          this.agentDataPath,
          this.input.knowledgeBaseIds
        ),
        { agentsDataRoot, toolResultRoot }
      )
      this.toolBridge = toolBridge
      const finalSnapshot = await captureDshConnectionSnapshot(
        this.input.sessionId,
        this.input.agentId,
        this.input.modelId,
        this.input.knowledgeBaseIds
      )
      if (finalSnapshot.signature !== snapshot.signature) {
        throw new Error(`dsh connection materialization changed during startup: ${this.input.sessionId}`)
      }
      this.connectionSignature = snapshot.signature

      this.bridge = new DshBridgeServer({
        sessionId: this.input.sessionId,
        emit: (event) => this.emitBridgeEvent(event),
        getInteractionState: () =>
          application.get('AgentSessionRuntimeService').getInteractionState(this.input.sessionId),
        onToolCall: (name, args, signal) => toolBridge.callTool(name, args, signal),
        onSubagentLifecycle: (edge) => this.subagents.handleLifecycle(edge)
      })
      await this.bridge.listen()

      const sdk = await loadDshSdk()
      const rawShellEnv = await getRawShellEnv()
      const loginPath = getPathFromEnvironment(rawShellEnv)
      // Preserve the user's MISE_* contract so system mise shims (e.g. pnpx)
      // don't get redirected to Cherry's isolated data dir (#19738).
      // Cherry-managed shims remain reachable as PATH tails; Cherry's
      // MISE vars are added only where the user has no value of their own.
      const rawMiseEnv = Object.fromEntries(
        Object.entries(rawShellEnv).filter(([key]) => key.toUpperCase().startsWith('MISE_'))
      )
      const binaryExecutionEnv = mergePathSuffixes(
        loginPath !== undefined ? { PATH: loginPath } : {},
        getBinarySearchDirs()
      )
      const cherryMiseEnv = getBinaryExecutionEnv()
      const miseEnv = Object.keys(rawMiseEnv).length > 0 ? rawMiseEnv : cherryMiseEnv
      // Complete replacement env — deliberate credential scope: the child sees
      // only managed binary locations, the routed API key, and the bridge socket.
      const client = new sdk.HarnessClient({
        command: process.execPath,
        args: [resolveDshRuntimeBinPath(), this.compositionPath],
        cwd: workspacePath,
        env: {
          ...binaryExecutionEnv,
          ...miseEnv,
          ...(rawShellEnv.HOME !== undefined
            ? { HOME: rawShellEnv.HOME }
            : process.env.HOME !== undefined
              ? { HOME: process.env.HOME }
              : {}),
          ELECTRON_RUN_AS_NODE: '1',
          CHERRY_DSH_API_KEY: injection.apiKey,
          [BRIDGE_SOCKET_ENV]: this.bridge.socketPath,
          [BRIDGE_TOKEN_ENV]: this.bridge.authenticationToken,
          DSH_HOME: dshRoot
        }
      })
      this.client = client
      client.start()
      await client.initialize({ cwd: workspacePath, provider: injection.providerName, model: injection.modelId })
      await this.bridge.whenReady()
      await this.bridge.request('session/open', {
        sessionId: this.input.sessionId,
        provider: injection.providerName,
        model: injection.modelId,
        cwd: workspacePath,
        // The plugin degrades resume to a fresh create when no session log exists yet.
        resume: Boolean(this.input.resumeToken),
        policy: this.buildPolicy(),
        tools: toolBridge.tools
      })
      if (this.permissionMode === 'plan') {
        // Activate dsh's plan surface (prompt section + exit tool); a resumed log
        // that already folds to plan makes this a no-op.
        this.runtimePlanActive = true
        await this.bridge.request('plan/set', { sessionId: this.input.sessionId, active: true })
      }
      this.maybeEmitResumeToken()

      const subscription = client.subscribe()
      this.subscription = subscription
      void this.pumpNotifications(subscription)
      return this
    } catch (error) {
      await this.disposeRuntime()
      throw error
    }
  }

  async send(input: Parameters<AgentRuntimeConnection['send']>[0]): Promise<void> {
    const bridge = this.bridge
    if (!bridge) {
      this.eventQueue.push({ type: 'error', error: new Error('dsh session is not started') })
      return
    }
    const rawContent = buildAgentUserContent(input.message)
    // A systemReminder message is a host-requeued steer, never a command line (pi parity).
    if (!input.systemReminder && isDshCommandLine(rawContent)) {
      const handled = await this.runSlashCommand(bridge, rawContent.trim())
      // Admission miss (unknown name) — dsh client semantics: the line stays ordinary prose.
      if (handled) return
    }
    const content = input.systemReminder ? wrapSteerReminder(rawContent) : rawContent
    this.markTurnActive()
    // Before the request: the turn can start streaming before the socket result returns.
    this.adapter.beginTurn()
    try {
      await bridge.request('session/prompt', {
        sessionId: this.input.sessionId,
        contentBlocks: [{ type: 'text', text: content }]
      })
    } catch (error) {
      this.turnActive = false
      this.adapter.abortTurn()
      if (this.closed) return
      logger.error('dsh prompt failed', error as Error)
      this.eventQueue.push({ type: 'error', error })
    }
  }

  /**
   * Reconcile against the current agent snapshot. Disabled tools tighten
   * immediately over the bridge; permission-mode changes wait for an idle
   * boundary. Any spawn-frozen difference is rebuilt by the host.
   */
  async reconcile(input: {
    modelId: UniqueModelId
    reasoningEffort?: ReasoningEffortOption
    knowledgeBaseIds?: readonly string[]
  }): Promise<AgentRuntimeReconcileResult> {
    const run = this.reconcileChain.then(
      () => this.reconcileOnce(input),
      () => this.reconcileOnce(input)
    )
    this.reconcileChain = run.catch(() => undefined)
    return run
  }

  private async reconcileOnce(input: {
    modelId: UniqueModelId
    reasoningEffort?: ReasoningEffortOption
    knowledgeBaseIds?: readonly string[]
  }): Promise<AgentRuntimeReconcileResult> {
    let snapshot
    try {
      snapshot = await captureDshConnectionSnapshot(
        this.input.sessionId,
        this.input.agentId,
        input.modelId,
        input.knowledgeBaseIds
      )
    } catch (error) {
      if (error instanceof DshInvalidConnectionSnapshotError) return 'invalid'
      throw error
    }
    const { agent } = snapshot

    const nextPermissionMode = toBridgePermissionMode(agent.configuration?.permission_mode)
    const sandboxBoundaryChanged = isBypassMode(nextPermissionMode) !== isBypassMode(this.permissionMode)
    // A mode change can alter admission for the live tool loop, so defer it to idle.
    // Disabled tools only tighten policy and still push immediately below.
    const applicablePermissionMode = this.turnActive ? this.permissionMode : nextPermissionMode
    const nextDisabledTools = normalizeDisabledTools(agent.disabledTools)
    const applicableDisabledTools = this.turnActive
      ? new Set([...this.disabledTools, ...nextDisabledTools])
      : nextDisabledTools
    const policyChanged =
      applicablePermissionMode !== this.permissionMode || !setsEqual(applicableDisabledTools, this.disabledTools)
    const planBoundaryChanged = (applicablePermissionMode === 'plan') !== (this.permissionMode === 'plan')
    this.permissionMode = applicablePermissionMode
    this.disabledTools = applicableDisabledTools
    // Optimistic: the pushed policy must already enforce the new plan stance; the
    // committed `plan/mode` fold confirms (or corrects) it.
    if (planBoundaryChanged) this.runtimePlanActive = applicablePermissionMode === 'plan'

    if (policyChanged) {
      try {
        await this.bridge?.request('policy/update', {
          sessionId: this.input.sessionId,
          policy: this.buildPolicy()
        })
      } catch (error) {
        // Fail closed: the plugin may still be enforcing the OLD policy.
        logger.error('dsh policy update failed', error as Error)
        return 'failed'
      }
    }
    if (planBoundaryChanged) {
      try {
        await this.bridge?.request('plan/set', {
          sessionId: this.input.sessionId,
          active: applicablePermissionMode === 'plan'
        })
      } catch (error) {
        // Fail closed: prompt guidance and enforcement would disagree.
        logger.error('dsh plan mode switch failed', error as Error)
        return 'failed'
      }
    }
    if (
      sandboxBoundaryChanged ||
      snapshot.signature !== this.connectionSignature ||
      (input.reasoningEffort ?? 'default') !== this.reasoningEffort
    ) {
      return 'rebuild'
    }
    return policyChanged ? 'patched' : 'current'
  }

  /**
   * Live context occupancy from the plugin's `ctx.tokenMeter.measure()` over the
   * bridge. Pull-only: the host reads this on connect-active, turn-complete, and
   * the throttled hover refresh. Null before the first provider request (a 0%
   * projection would mislead — pi precedent) and whenever the bridge is gone.
   */
  refreshTraceContext(context: AgentRuntimeTraceContext): void {
    this.traceContext = context
  }

  async getContextUsage(): Promise<AgentSessionContextUsage | null> {
    const bridge = this.bridge
    if (!bridge || this.closed) return null
    let usage
    try {
      usage = await bridge.requestContextUsage(this.input.sessionId, { timeoutMs: 5_000 })
    } catch (error) {
      logger.warn('dsh context usage query failed', { error })
      return null
    }
    if (usage.totalTokens <= 0) return null
    const maxTokens = this.contextWindow
    // Names must match the renderer's CATEGORY_NAME_KEYS map (Claude vocabulary).
    const categories = [
      { name: 'System prompt', tokens: finiteTokenCount(usage.systemTokens) },
      { name: 'System tools', tokens: finiteTokenCount(usage.toolsTokens) },
      { name: 'Messages', tokens: finiteTokenCount(usage.messageTokens) }
    ].filter((category) => category.tokens > 0)
    return {
      categories,
      totalTokens: usage.totalTokens,
      maxTokens,
      percentage: maxTokens > 0 ? Math.min(100, (usage.totalTokens / maxTokens) * 100) : 0,
      model: this.modelId
    }
  }

  /** Interrupt one continuable child's current turn (user authority); absent child = accepted no-op. */
  async stopTask(taskId: string): Promise<boolean> {
    const bridge = this.bridge
    if (!bridge || this.closed) return false
    try {
      await bridge.request(
        'subagent/interrupt',
        { sessionId: this.input.sessionId, childSessionId: taskId },
        { timeoutMs: 5_000 }
      )
      return true
    } catch (error) {
      logger.warn('dsh subagent interrupt failed', { error })
      return false
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.subagents.close()
    // Deny any approval still awaiting a renderer decision so its held tool
    // promise resolves instead of hanging past teardown.
    toolApprovalRegistry.abort(this.input.sessionId, 'dsh-session-closed')
    this.subscription?.close()
    this.subscription = undefined
    try {
      await this.bridge?.request('session/cancel', { sessionId: this.input.sessionId }, { timeoutMs: 2_000 })
    } catch (error) {
      logger.warn('dsh cancel during close failed', { error })
    }
    await this.disposeRuntime()
    this.eventQueue.close()
  }

  /** Best-effort teardown shared by close() and start() failure cleanup. */
  private async disposeRuntime(): Promise<void> {
    this.traceRecorder?.close('dsh connection closed')
    this.traceRecorder = undefined
    try {
      await this.client?.close()
    } catch (error) {
      logger.warn('dsh client close failed', { error })
    }
    this.client = undefined
    await this.bridge?.close().catch((error) => logger.warn('dsh bridge close failed', { error }))
    this.bridge = undefined
    const toolBridge = this.toolBridge
    this.toolBridge = undefined
    await toolBridge?.close().catch((error) => logger.warn('dsh Cherry tool bridge close failed', { error }))
    if (this.compositionPath) {
      await rm(this.compositionPath, { force: true }).catch(() => undefined)
      this.compositionPath = undefined
    }
  }

  /** Stored mode overlaid with the runtime's committed plan fold (see `runtimePlanActive`). */
  private effectivePermissionMode(): BridgePermissionMode {
    if (this.runtimePlanActive === true) return 'plan'
    if (this.runtimePlanActive === false && this.permissionMode === 'plan') return 'default'
    return this.permissionMode
  }

  /**
   * The runtime committed a `plan/mode` flip this connection did not push — an
   * approved exit_plan_mode review or a `/plan` command line. Mirror it into the
   * live policy; Cherry's stored mode is deliberately not rewritten.
   */
  private handlePlanModeFold(active: boolean): void {
    if (this.runtimePlanActive === active) return
    this.runtimePlanActive = active
    const bridge = this.bridge
    if (!bridge || this.closed) return
    // A failed refresh leaves the previous (plan-restricted or stored) policy in
    // force — over-restriction at worst, never an enforcement gap.
    void bridge
      .request('policy/update', { sessionId: this.input.sessionId, policy: this.buildPolicy() })
      .catch((error) => logger.warn('dsh plan-mode policy refresh failed', { error }))
  }

  private buildPolicy(): BridgePolicy {
    return {
      permissionMode: this.effectivePermissionMode(),
      disabledTools: [...this.disabledTools],
      // WORKSPACE FIRST: the plugin resolves relative tool paths against allowedRoots[0].
      allowedRoots: [this.workspacePath, this.agentDataPath],
      readTools: DSH_READ_TOOLS,
      editTools: DSH_EDIT_TOOLS,
      autoApprovedTools: [...DSH_AUTO_APPROVED_BUILTIN_TOOLS, ...DSH_AUTO_APPROVED_BRIDGED_TOOLS],
      approvalRequiredTools: [...DSH_APPROVAL_REQUIRED_BRIDGED_TOOLS],
      nonBypassableApprovalTools: [...DSH_NON_BYPASSABLE_APPROVAL_BRIDGED_TOOLS],
      // Closed plan-mode allow-list: plan-safe builtins plus Cherry's auto-approved
      // bridged tools; the subagent tools stay out (delegation bypasses read-only).
      planSafeTools: [...DSH_PLAN_SAFE_BUILTIN_TOOLS, ...DSH_AUTO_APPROVED_BRIDGED_TOOLS]
    }
  }

  private async pumpNotifications(subscription: NotificationSubscription): Promise<void> {
    try {
      for await (const notification of subscription) {
        if (this.closed) return
        // Fresh-create admission on the same pipe as session.event (ordered before the
        // child's first event); cold resumes never emit this — the bridge lifecycle does.
        if (notification.method === 'subagent.started') {
          const params = notification.params as { parentSessionId?: unknown; childSessionId?: unknown }
          if (typeof params?.parentSessionId === 'string' && typeof params?.childSessionId === 'string') {
            this.subagents.handleSdkSubagentStarted(params.parentSessionId, params.childSessionId)
          }
          continue
        }
        if (notification.method !== 'session.event') continue
        const params = notification.params as { sessionId?: unknown; event?: unknown }
        if (typeof params?.sessionId !== 'string') continue
        // The SDK server forwards session-log envelopes verbatim; the rc.6 pin keeps this
        // single wire-boundary cast sound. Unknown merged types fall through the adapter.
        const event = params.event as SessionEvent
        if (params.sessionId !== this.input.sessionId) {
          // Every other session in this process is a descendant (or one racing its
          // started/lifecycle signal); the coordinator buffers until a binding lands.
          this.subagents.handleChildEvent(params.sessionId, event)
          continue
        }
        this.traceRecorder?.handleEvent(event)
        this.adapter.handleEvent(event)
      }
    } catch (error) {
      if (this.closed) return
      logger.error('dsh notification stream failed', error as Error)
      this.eventQueue.push({ type: 'error', error })
      this.eventQueue.close()
    }
  }

  /**
   * dsh never parses slash text out of prompts (commands are a client concern),
   * so gesture lines dispatch through the bridge into the runtime's `ctx.commands`
   * registry. A handled command settles this turn with its `command/done` text
   * (dsh CLI parity — usage errors included); side effects like a manual
   * compaction stream their own session events alongside. Returns false on an
   * admission miss so the caller falls back to a normal prompt.
   */
  private async runSlashCommand(bridge: DshBridgeServer, line: string): Promise<boolean> {
    this.markTurnActive()
    let outcome
    try {
      outcome = await bridge.requestCommand(this.input.sessionId, line)
    } catch (error) {
      this.turnActive = false
      if (this.closed) return true
      logger.error('dsh command dispatch failed', error as Error)
      this.eventQueue.push({ type: 'error', error })
      return true
    }
    if (!outcome.handled) {
      this.turnActive = false
      return false
    }
    if (outcome.text) this.pushCommandOutput(outcome.text)
    this.turnActive = false
    this.eventQueue.push({ type: 'turn-complete' })
    return true
  }

  /** Command outcomes are host-fabricated assistant text — they never reach the model. */
  private pushCommandOutput(text: string): void {
    const id = `dsh-command-${randomUUID()}`
    this.eventQueue.push({ type: 'chunk', chunk: { type: 'text-start', id } })
    this.eventQueue.push({ type: 'chunk', chunk: { type: 'text-delta', id, delta: text } })
    this.eventQueue.push({ type: 'chunk', chunk: { type: 'text-end', id } })
  }

  private handleTurnEnd(reason: TurnEndReason): void {
    if (this.closed) return
    this.turnActive = false
    switch (reason.kind) {
      case 'completed':
      case 'max-tokens':
        this.eventQueue.push({ type: 'turn-complete' })
        return
      case 'aborted':
      case 'interrupted':
        // Arrives only during teardown/cancel — the host is already settling this turn.
        this.eventQueue.push({ type: 'turn-complete' })
        return
      case 'error': {
        const message = reason.error.message.trim() || 'dsh agent turn failed'
        this.eventQueue.push({ type: 'error', error: new Error(message) })
        return
      }
      default:
        // 'blocked' and merge-extended kinds fail loud rather than stranding the host turn.
        this.eventQueue.push({ type: 'error', error: new Error(`dsh turn ended: ${reason.kind}`) })
    }
  }

  private recordProviderInvocation(
    info: {
      turn: number
      seq: number
      usage: TokenUsage
      model?: string
      metrics?: DshInvocationMetrics
    },
    sessionId: string = this.input.sessionId
  ): void {
    if (this.closed) return
    if (this._usageCapture?.owner !== 'agent-sdk') return

    const requestId = `dsh-agent:${sessionId}:${info.turn}:${info.seq}`
    if (this.committedInvocationIds.has(requestId)) return
    this.committedInvocationIds.add(requestId)

    const noCacheTokens = finiteTokenCount(info.usage.inputTokens)
    const cacheReadTokens = finiteTokenCount(info.usage.cacheReadTokens)
    const cacheWriteTokens = finiteTokenCount(info.usage.cacheWriteTokens)
    const inputTokens = noCacheTokens + cacheReadTokens + cacheWriteTokens
    const outputTokens = finiteTokenCount(info.usage.outputTokens)
    this.eventQueue.push({
      type: 'usage',
      invocation: {
        requestId,
        model: info.model?.trim() || this.modelId,
        messageAssociation: 'current-turn',
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          ...(info.usage.reasoningTokens !== undefined
            ? { reasoningTokens: finiteTokenCount(info.usage.reasoningTokens) }
            : {}),
          noCacheTokens,
          cacheReadTokens,
          cacheWriteTokens
        },
        ...(info.metrics ? { metrics: info.metrics } : {})
      }
    })
  }

  /** resume-token = Cherry session id = dsh session id (the JSONL backend owns file pathing). */
  private maybeEmitResumeToken(): void {
    const token = this.input.sessionId
    if (token === this.resumeToken) return
    this.resumeToken = token
    this.eventQueue.push({ type: 'resume-token', token })
  }
}

function toBridgePermissionMode(mode: AgentPermissionMode | undefined): BridgePermissionMode {
  // `auto` stays unsupported for dsh (no model-side approval classifier); it falls through to gate-all.
  return mode === 'acceptEdits' || mode === 'bypassPermissions' || mode === 'plan' ? mode : 'default'
}

function isBypassMode(mode: BridgePermissionMode): boolean {
  return mode === 'bypassPermissions'
}

/**
 * Alias only known dsh built-ins from legacy Claude casing and the stable shell toggle. MCP ids are
 * runtime-native and case-sensitive, so preserve them exactly or their hard block silently misses.
 */
function normalizeDisabledTools(disabledTools: string[] | undefined | null): Set<string> {
  return new Set((disabledTools ?? []).map((tool) => DSH_BUILTIN_TOOL_ALIASES.get(tool.toLowerCase()) ?? tool))
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

/** dsh's command admission gesture (`parseCommand` shape): first token is `/name`. */
function isDshCommandLine(content: string): boolean {
  return /^\/[a-z][a-z0-9_-]*(?=$|[\t\n\r ])/.test(content.trim())
}

function finiteTokenCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Format-guard for hydrated resume tokens (no file scan — the JSONL backend owns
 * pathing). A malformed token fails closed as the resume attack-surface guard.
 */
function assertValidDshResumeToken(resumeToken: string): void {
  if (
    !resumeToken ||
    resumeToken !== path.basename(resumeToken) ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(resumeToken)
  ) {
    throw new Error('dsh resume token must be a valid session id')
  }
}
