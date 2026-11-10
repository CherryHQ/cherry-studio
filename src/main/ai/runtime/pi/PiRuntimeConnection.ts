import { randomUUID } from 'node:crypto'
import { readdirSync, lstatSync } from 'node:fs'

import type { Usage } from '@earendil-works/pi-ai'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'

import { application } from '@application'
import type { BehaviorEvent, CallRef } from '@cherrystudio/agent-behavior'
import { runtimeId, type InputState, type Observation, type Subagent } from '@cherrystudio/agent-runtime'
import type {
  AgentRuntimeEvent as PiEvent,
  PiObservation,
  PiRuntime,
  PiThreadHandle
} from '@cherrystudio/agent-runtime-pi'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import { ensureAgentDataDirectory } from '@main/ai/agents/agentDataDirectory'
import { resolveAgentCapabilities, resolveMountedMcpServers } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { ChildThreadProjection } from '@main/ai/agentSession/ChildThreadProjection'
import {
  prepareNativeSubmission,
  lookupNativeInput,
  bindNativeInput,
  applyNativeSubmissionResult
} from '@main/ai/agentSession/nativeSubmission'
import { ThreadProjection } from '@main/ai/agentSession/ThreadProjection'
import { buildAgentMcpServers, warmAgentMcpToolCatalogs } from '@main/ai/runtime/agentMcpServers'
import { buildAgentRuntimePrompt } from '@main/ai/runtime/agentPrompt'
import { prepareAgentSessionWorkspaceDirectory } from '@main/ai/runtime/agentSessionWorkspace'
import { buildAgentUserContent } from '@main/ai/runtime/agentUserContent'
import { buildCitationsGuidance } from '@main/ai/runtime/citationsGuidance'
import { preparePiBranch } from '@main/ai/runtime/pi/piContext'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import { CHERRY_MCP_SERVER, listBuiltinToolPolicies } from '@main/ai/toolApproval/builtinToolPolicy'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { resolveKnowledgeBaseScope } from '@main/ai/utils/knowledgeScope'
import { getPathFromEnvironment, getShellEnv } from '@main/utils/shellEnv'
import type { AgentSessionCompactionTrigger } from '@shared/ai/agentSessionCompaction'
import type { AutonomousTurnOrigin } from '@shared/ai/agentSessionTurnOrigin'
import {
  KB_READ_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME
} from '@shared/ai/builtinTools'
import { normalizePiDisabledToolId } from '@shared/ai/piBuiltinTools'
import { LEGACY_DSH_TOOL_PREFIX } from '@shared/ai/retiredAgentRuntime'
import { buildFunctionCallToolName } from '@shared/ai/tools/mcpToolName'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { UniqueModelId } from '@shared/data/types/model'
import { AsyncEventQueue } from '@shared/utils/async'

import { resolveApiGatewayRuntime } from '../agentApiGateway'
import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeReconcileResult,
  AgentRuntimeTraceContext,
  AgentRuntimeCommand,
  AgentSessionUsageCapture
} from '../types'
import { childTaskStatus } from './childTaskStatus'
import { PiForkCheckpointSchema } from './forkCheckpoint'
import { createPiGatewayModelBinding } from './gatewayModelBinding'
import { createPiIdentityExtension } from './identityExtension'
import { legacyDisabledToolId, assertLegacyDisabledToolsResolved } from './legacyToolPolicy'
import { createPiBehaviorHost } from './piBehaviorHost'
import { PiChildTasks } from './PiChildTasks'
import {
  capturePiConnectionSnapshot,
  type PiConnectionSnapshot,
  PiInvalidConnectionSnapshotError
} from './piConnectionSignature'
import { buildPiMcpToolName, createPiMcpExtension } from './piMcpExtension'
import { PiMessageMetadata, resolvePiMcpToolMetadata } from './PiMessageMetadata'
import { isPiObservationError, PiObservationError } from './piObservationError'
import { loadPiSdk } from './piSdk'
import { buildPiLoginPathPrefix, mergePiBashExecutionEnv, resolvePiShellPath } from './piShell'
import { PiTurnUsage } from './PiTurnUsage'

const logger = loggerService.withContext('PiRuntimeConnection')

type PiChildResource = {
  relation: Subagent
  handle: PiThreadHandle
  projection: ChildThreadProjection
}

export class PiRuntimeConnection implements AgentRuntimeConnection {
  get contextId(): string | undefined {
    return this.context?.id
  }

  readonly retainWhileIdle = true
  readonly usageCapture: AgentSessionUsageCapture = { owner: 'provider-calls' }
  private readonly eventQueue = new AsyncEventQueue<AgentRuntimeEvent>()
  readonly events = this.eventQueue
  private runtime?: PiRuntime
  private handle?: PiThreadHandle
  private observation?: Observation
  private context?: ReturnType<typeof preparePiBranch>
  private closing = false
  private readonly closingAccess = new AbortController()
  private closePromise?: Promise<void>
  private nativeClosed = false
  private active = false
  private sending = false
  private manualCompactInFlight = false
  private autonomous = false
  private nextOrigin: AutonomousTurnOrigin = { kind: 'background-work' }
  private readonly childTasks = new PiChildTasks(
    (id) => this.childOrigin(id),
    (event) => this.eventQueue.push(event)
  )
  private readonly children = new Map<
    string,
    | { state: 'opening'; pending: Promise<PiChildResource | undefined> }
    | { state: 'attached' | 'closing'; resource: PiChildResource }
  >()
  private failure?: unknown
  private connectionSignature?: string
  private permissionMode: AgentPermissionMode = 'default'
  private disabledTools = new Set<string>()
  private reconcileChain: Promise<unknown> = Promise.resolve()
  private mcpServerSnapshots: PiConnectionSnapshot['mcpServerSnapshots'] = new Map()
  private readonly pendingSteers = new Set<string>()
  private readonly pendingBindings = new Map<string, InputState>()
  private checkpoint?: string
  private readonly turnUsage = new PiTurnUsage()
  private readonly adapter = new PiMessageMetadata((name) => this.resolveMcpToolMetadata(name))
  private projection?: ThreadProjection

  constructor(private readonly input: AgentRuntimeConnectInput) {}

  async start(): Promise<this> {
    const discovery = await capturePiConnectionSnapshot(
      this.input.sessionId,
      this.input.agentId,
      this.input.modelId,
      this.input.knowledgeBaseIds
    )
    await resolveApiGatewayRuntime(this.input.sessionId)
    await warmAgentMcpToolCatalogs(discovery.agent.mcps ?? [])
    const initialSnapshot = await capturePiConnectionSnapshot(
      this.input.sessionId,
      this.input.agentId,
      this.input.modelId,
      this.input.knowledgeBaseIds
    )
    const { agent, session } = initialSnapshot
    const workspacePath = session.workspace?.path
    if (!session.agentId || !workspacePath) throw new Error('Pi requires an agent and workspace')
    await prepareAgentSessionWorkspaceDirectory(session)
    this.permissionMode = agent.configuration?.permission_mode ?? 'default'
    this.disabledTools = normalizeDisabledTools(agent.disabledTools, initialSnapshot)
    this.mcpServerSnapshots = initialSnapshot.mcpServerSnapshots
    const pi = await loadPiSdk()
    const { createPiRuntime } = await import('@cherrystudio/agent-runtime-pi')
    const agentDir = application.getPath('feature.agents.pi.root')
    const sessionDir = application.getPath('feature.agents.pi.sessions')
    const shellPath = resolvePiShellPath()
    const loginPathPrefix = buildPiLoginPathPrefix(getPathFromEnvironment(await getShellEnv()))
    const additionalSkillPaths = [...initialSnapshot.additionalSkillPaths]
    const agentDataPath = await ensureAgentDataDirectory(application.getPath('feature.agents.data'), agent.id)
    const linkedChannel = initialSnapshot.linkedChannel
    const knowledgeBaseScope = resolveKnowledgeBaseScope(agent.knowledgeBaseIds, this.input.knowledgeBaseIds)
    const isToolEnabled = (serverName: string, toolName: string) =>
      !this.disabledTools.has(buildPiMcpToolName(serverName, toolName))
    const citationsGuidance = buildCitationsGuidance({
      web: isToolEnabled('cherry-tools', WEB_SEARCH_TOOL_NAME) || isToolEnabled('cherry-tools', WEB_FETCH_TOOL_NAME),
      kb:
        (resolveAgentCapabilities(agent).allKnowledgeBases || knowledgeBaseScope.length > 0) &&
        (isToolEnabled('cherry-tools', KB_SEARCH_TOOL_NAME) || isToolEnabled('cherry-tools', KB_READ_TOOL_NAME))
    })
    const prompt = await buildAgentRuntimePrompt({
      workspacePath,
      agentDataPath,
      agent,
      citationsGuidance,
      effectiveLanguage: initialSnapshot.effectiveLanguage
    })
    const mountedServers = resolveMountedMcpServers(agent, {
      browserEnabled: application.get('PreferenceService').get('app.browser.agent_control.enabled'),
      computerUseEnabled: application.get('PreferenceService').get('app.computer_use.agent_control.enabled'),
      channelLinked: linkedChannel !== null
    })
    const mountedPolicies = listBuiltinToolPolicies({ mountedServers })
    const approvalContext = {
      sessionId: this.input.sessionId,
      workspacePath,
      agentDataPath,
      emit: (event: AgentRuntimeEvent) => this.eventQueue.push(event),
      getInteractionState: () =>
        application.get('AgentSessionRuntimeService').getInteractionState(this.input.sessionId),
      getPermissionMode: () => this.permissionMode,
      isDisabled: (toolName: string) => this.isToolDisabled(toolName),
      additionalReadOnlyRoots: [...additionalSkillPaths, application.getPath('feature.agents.outputs')],
      // Approval follows the mounted server set; disabledTools still blocks at fire-time.
      autoApprovedTools: new Set(
        mountedPolicies
          .filter(({ approval }) => approval === 'auto')
          .map(({ serverName, toolName }) => buildPiMcpToolName(serverName, toolName))
      ),
      approvalRequiredTools: new Set(
        mountedPolicies
          .filter(({ approval }) => approval === 'required')
          .map(({ serverName, toolName }) => buildPiMcpToolName(serverName, toolName))
      ),
      nonBypassableApprovalTools: new Set(
        mountedPolicies
          .filter(({ approval, bypassApproval }) => approval === 'required' && bypassApproval === 'enforce')
          .map(({ serverName, toolName }) => buildPiMcpToolName(serverName, toolName))
      ),
      delegationTools: new Set(
        mountedPolicies
          .filter(({ approval }) => approval === 'delegation')
          .map(({ serverName, toolName }) => buildPiMcpToolName(serverName, toolName))
      )
    }
    const mcpServers = buildAgentMcpServers(
      session,
      agent,
      mountedServers,
      initialSnapshot.mcpServerSnapshots,
      linkedChannel,
      agentDataPath,
      this.input.knowledgeBaseIds
    )

    const finalSnapshot = await capturePiConnectionSnapshot(
      this.input.sessionId,
      this.input.agentId,
      this.input.modelId,
      this.input.knowledgeBaseIds
    )
    if (finalSnapshot.signature !== initialSnapshot.signature)
      throw new Error('Pi configuration changed during startup')
    this.connectionSignature = initialSnapshot.signature
    this.context = preparePiBranch(
      this.input.sessionId,
      this.input.branchHead,
      this.input.resumeToken ?? this.input.nativeSessionId
    )
    const nativeId = this.context.nativeThreadId
    if (!nativeId || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(nativeId)) throw new Error('Invalid Pi session identity')
    let files: string[]
    try {
      files = readdirSync(sessionDir).filter((file) => file.endsWith(`_${nativeId}.jsonl`))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      files = []
    }
    if (files.length > 1) throw new Error('Pi session identity is ambiguous')
    if (
      (this.context.bindingState === 'bound' || messages.hasContextInput(this.input.sessionId, this.context.id)) &&
      files.length !== 1
    )
      throw new Error('Pi session history is missing')
    if (files.length && !lstatSync(application.getPath('feature.agents.pi.sessions', files[0])).isFile())
      throw new Error('Pi session must be a regular file')
    const manager = files.length
      ? pi.SessionManager.openExisting(
          application.getPath('feature.agents.pi.sessions', files[0]),
          nativeId,
          workspacePath
        )
      : pi.SessionManager.create(workspacePath, sessionDir, { id: nativeId })
    const binding = await createPiGatewayModelBinding(
      this.input,
      initialSnapshot.provider,
      initialSnapshot.model,
      (usage, sessionId, responseId) => {
        if (sessionId === nativeId) {
          if (responseId) this.eventQueue.push({ type: 'response-start', responseId })
          this.recordUsage(usage)
        }
      }
    )
    const managedBashTool = pi.createBashToolDefinition(workspacePath, {
      commandPrefix: loginPathPrefix,
      shellPath,
      spawnHook: (context) => ({ ...context, env: mergePiBashExecutionEnv(context.env) })
    }) as ToolDefinition
    const toolCallId = async (call: CallRef) => {
      const opened = await this.runtime!.open({ backendId: runtimeId(this.context!.backendId), id: call.thread })
      if (opened.status !== 'confirmed') throw new Error(opened.error.message)
      try {
        const id = opened.value.pi.toolCallId(call)
        if (!id) throw new Error('Behavior call has no native tool identity')
        return id
      } finally {
        await opened.value.release()
      }
    }
    const behavior = await createPiBehaviorHost({
      input: this.input,
      root: runtimeId(nativeId),
      binding,
      model: initialSnapshot.model,
      approval: approvalContext,
      emit: (event) => this.eventQueue.push(event),
      observe: (event) => this.handleBehaviorEvent(event),
      toolCallId,
      usageSessionId: async (thread) => {
        if (thread === nativeId) return this.input.sessionId
        const child = await this.observeChild(thread)
        if (!child) throw new Error('Native child usage context is unavailable')
        return child.projection.context.sessionId
      }
    })
    const options = {
      ...binding,
      cwd: workspacePath,
      agentDir,
      sessionManager: manager,
      systemPrompt: prompt.base.kind === 'custom' ? prompt.base.content : undefined,
      appendSystemPrompt: prompt.append ? [prompt.append] : [],
      contextFiles: true,
      skillPaths: additionalSkillPaths,
      builtinTools: ['read', 'bash', 'edit', 'write'],
      tools: [managedBashTool],
      excludeTools: [...this.disabledTools],
      behavior,
      settings: {
        ...(shellPath ? { shellPath } : {}),
        ...(loginPathPrefix ? { shellCommandPrefix: loginPathPrefix } : {})
      },
      extensionFactories: [
        createPiIdentityExtension(agentDataPath),
        pi.createCodemodeExtension({ models: false }),
        pi.createToolSearchExtension(),
        createPiMcpExtension(pi, mcpServers, application.getPath('feature.agents.pi.root', 'mcp.log'))
      ],
      onEvent: (event: PiEvent) => this.handleNativeEvent(event)
    }
    const created = await createPiRuntime({
      backendId: runtimeId(this.context.backendId),
      load: async (thread) => {
        if (thread.id !== nativeId) return undefined
        return options
      },
      onError: (error) => {
        this.failure ??= error
        logger.error('Pi Runtime operation failed', { error })
      }
    })
    if (created.status !== 'confirmed') throw new Error(created.error.message)
    this.runtime = created.value
    try {
      const opened = files.length
        ? await this.runtime.open({ backendId: runtimeId(this.context.backendId), id: runtimeId(nativeId) })
        : await this.runtime.create(options)
      if (opened.status !== 'confirmed') throw this.failure ?? new Error(opened.error.message)
      this.failure = undefined
      this.handle = opened.value
      if (files.length) this.context = contexts.bindContext(this.context.id, nativeId)
      const observed = await this.handle.pi.observe((batch) => this.handleObservation(batch))
      if (observed.status !== 'confirmed') throw new Error(observed.error.message)
      this.observation = observed.value
      if (files.length) this.eventQueue.push({ type: 'resume-token', token: nativeId })
      return this
    } catch (error) {
      await this.close()
      throw error
    }
  }

  async send(input: AgentRuntimeCommand): Promise<void> {
    if (!this.handle || !this.context || this.closing) throw new Error('Pi Runtime is unavailable')
    if (this.sending) throw new Error('Pi already has an active submission')
    this.sending = true
    this.failure = undefined
    this.turnUsage.reset()
    const content = buildAgentUserContent(input.message)
    const command = input.systemReminder ? undefined : parseManualCompactCommand(content)
    if (command) {
      this.manualCompactInFlight = true
      const result = await this.handle.pi.compact(command.instructions || undefined)
      this.manualCompactInFlight = false
      if (result.status !== 'confirmed') this.failure ??= new Error(result.error.message)
      this.finishTurn()
      return
    }
    try {
      await this.submit(input, input.systemReminder ? wrapSteerReminder(content) : content, 'reject')
    } catch (error) {
      this.sending = false
      this.failure = error
      throw error
    }
  }

  lookupInput(contextId: string, inputId: string) {
    return lookupNativeInput(this.runtime!, this.input.sessionId, contextId, inputId)
  }

  redirect(input: AgentRuntimeCommand): boolean {
    if (!this.active || this.closing) return false
    this.pendingSteers.add(input.message.id)
    void this.submit(input, wrapSteerReminder(buildAgentUserContent(input.message)), 'steer').catch((error) => {
      this.pendingSteers.delete(input.message.id)
      this.failure = error
      this.eventQueue.push({ type: 'error', error })
    })
    return true
  }

  private async submit(input: AgentRuntimeCommand, text: string, whenBusy: 'reject' | 'steer'): Promise<void> {
    const draft = prepareNativeSubmission(this.input.sessionId, input.message.id, this.context!.id, whenBusy, {
      text,
      parts: input.message.data.parts
    })
    this.input.onInputPrepared?.(input.message.id, this.context!.id)
    const result = await this.handle!.input.submit(draft)
    this.eventQueue.push({ type: 'input-submission', contextId: this.context!.id, result })
    if (result.status !== 'acknowledged') applyNativeSubmissionResult(this.input.sessionId, this.context!.id, result)
    if (result.status === 'acknowledged') {
      this.captureInput(result)
      if (result.facts.includes('locally-handled') && !this.active) this.finishTurn()
    } else {
      this.failure ??= new Error(result.error.message)
      this.finishTurn()
      if (result.status === 'unknown')
        void this.close().catch((error) => logger.error('Pi submission shutdown failed', { error }))
    }
  }

  private observationIdentity(): { backendId?: string; nativeThreadId?: string } {
    return {
      backendId: this.context?.backendId,
      nativeThreadId: this.context?.nativeThreadId ?? this.handle?.thread.id ?? undefined
    }
  }

  private observationFailure(
    kind: 'gap' | 'closed' | 'diagnostic' | 'outcome',
    reason: string,
    causeMessage?: string
  ): PiObservationError {
    const failure = new PiObservationError({
      runtime: 'pi',
      kind,
      reason,
      sessionId: this.input.sessionId,
      ...this.observationIdentity(),
      ...(causeMessage ? { causeMessage } : {})
    })
    logger.error('Pi observation interrupted', failure.toLogContext())
    return failure
  }

  private async handleObservation(batch: PiObservation): Promise<void> {
    try {
      this.projection ??= new ThreadProjection(
        this.handle!.thread,
        this.context!.id,
        (projection) => this.eventQueue.push({ type: 'message-projection', projection }),
        (message) => this.adapter.decorate(message)
      )
      for (const event of batch.events) {
        if (event.type === 'context.changed') this.eventQueue.push({ type: 'context-usage', result: event.result })
        if (event.type === 'snapshot' && event.contextUsage)
          this.eventQueue.push({ type: 'context-usage', result: event.contextUsage })
        const inputs = event.type === 'snapshot' ? event.inputs : event.type === 'input.changed' ? [event.input] : []
        for (const input of inputs) {
          this.captureInput(input)
          const steer = input.inputId && this.pendingSteers.has(input.inputId) ? input.inputId : undefined
          if (steer && input.facts.includes('placed')) {
            this.pendingSteers.delete(steer)
            this.eventQueue.push({ type: 'steer-boundary', inputIds: [steer] })
          }
        }
        if (event.type === 'snapshot') {
          for (const relation of event.subagents ?? []) if (relation.child) void this.observeChild(relation.child.id)
          this.active = event.activity.state === 'active'
        } else if (event.type === 'activity.changed') {
          this.active = event.activity.state === 'active'
          if (this.active && !this.sending && !this.closing) {
            this.autonomous = true
            this.sending = true
            this.failure = undefined
            this.turnUsage.reset()
            this.eventQueue.push({
              type: 'autonomous-turn-state',
              state: 'started',
              origin: this.nextOrigin,
              sourceToolCallIds:
                batch.backgroundResults?.status === 'confirmed' ? batch.backgroundResults.value.notification : undefined
            })
            this.nextOrigin = { kind: 'background-work' }
          }
        } else if (event.type === 'subagent.upsert' && event.subagent.child)
          void this.observeChild(event.subagent.child.id)
        else if (event.type === 'diagnostic')
          this.failure ??= this.observationFailure('diagnostic', event.error.message, event.error.message)
        else if (event.type === 'gap' && !['mapping-reset', 'overflow'].includes(event.reason))
          throw this.observationFailure('gap', event.reason)
        else if (event.type === 'closed' && event.reason !== 'shutdown' && !this.closing)
          throw this.observationFailure('closed', event.reason)
      }
      for (const input of batch.outcomes)
        if (input.outcome !== 'completed')
          this.failure ??= this.observationFailure('outcome', input.outcome, input.error?.message ?? input.outcome)
      await this.projection.accept(batch)
      if (batch.backgroundResults) {
        const result = batch.backgroundResults
        this.eventQueue.push({
          type: 'background-results',
          result: result.status === 'confirmed' ? { status: 'confirmed', value: result.value.pending } : result
        })
        this.eventQueue.push({
          type: 'background-work-state',
          active: result.status !== 'confirmed' || result.value.active
        })
      }
      for (const child of batch.children)
        void this.observeChild(child.thread.id).then(() =>
          this.childTasks.publish(child.thread.id, childTaskStatus(child.outcome))
        )
      if (batch.settled && this.sending && !this.manualCompactInFlight) this.finishTurn()
    } catch (error) {
      const failure =
        isPiObservationError(error) || error instanceof Error
          ? error
          : this.observationFailure('diagnostic', 'unknown', String(error))
      if (!isPiObservationError(failure)) {
        logger.error('Pi observation interrupted', {
          sessionId: this.input.sessionId,
          ...this.observationIdentity(),
          error: failure
        })
      }
      // Retain the failure so `reconcile()` reports `rebuild`: the next turn
      // reconnects fresh instead of reusing this retired observation.
      this.failure = failure
      this.sending = false
      this.eventQueue.push({ type: 'error', error: failure })
      void this.close().catch((closeError) =>
        logger.error('Failed to retire Pi after observation error', { error: closeError })
      )
    }
  }

  private handleBehaviorEvent(event: BehaviorEvent): void {
    if (this.handle && event.thread !== this.handle.thread.id) return
    if (event.type === 'goal-round') this.nextOrigin = { kind: 'goal-round', round: event.round.round }
    else if (event.type === 'goal-notice') {
      this.projection?.notice(event.notice.text)
    } else if (event.type === 'subagents') this.childTasks.showSubagents(event.views, true)
  }

  private childKey(id: string): string {
    return JSON.stringify([this.context!.backendId, id])
  }

  private childOrigin(id: string) {
    const child = this.children.get(this.childKey(id))
    return child && child.state !== 'opening' ? child.resource.relation.origin : undefined
  }

  private async childResource(id: string): Promise<PiChildResource | undefined> {
    const child = this.children.get(this.childKey(id))
    return child?.state === 'opening' ? child.pending : child?.resource
  }

  private async observeChild(id: string, granted?: PiThreadHandle): Promise<PiChildResource | undefined> {
    const key = this.childKey(id)
    const existing = this.children.get(key)
    if (existing) {
      await granted?.release()
      if (existing.state === 'closing') {
        await existing.resource.projection.stop()
        await existing.resource.handle.release()
        this.children.delete(key)
        return this.observeChild(id)
      }
      return existing.state === 'opening' ? existing.pending : existing.resource
    }
    if (this.nativeClosed) {
      await granted?.release()
      return undefined
    }
    let handle: PiThreadHandle | undefined
    let resource: PiChildResource | undefined
    const pending = Promise.resolve()
      .then(async () => {
        if (granted) handle = granted
        else {
          const opened = await this.runtime!.open({ backendId: runtimeId(this.context!.backendId), id: runtimeId(id) })
          if (opened.status !== 'confirmed') throw new Error(opened.error.message)
          handle = opened.value
        }
        const relation = handle.pi.relation()
        if (!relation?.origin) throw new Error('Native child creation origin is unavailable')
        const parent =
          relation.parent.id === this.handle?.thread.id ? undefined : await this.observeChild(relation.parent.id)
        const parentContext =
          parent?.projection.context ?? (relation.parent.id === this.handle?.thread.id ? this.context : undefined)
        if (!parentContext) throw new Error('Native child owner context is unavailable')
        const context = contexts.child(
          parentContext.id,
          id,
          relation.origin.toolCallId,
          relation.origin.description ?? id
        )
        const access = handle
        const projection = new ChildThreadProjection(
          context,
          {
            ...access,
            observe: (sink) =>
              access.observe(async (event) => {
                await sink(event)
                if (event.type === 'snapshot')
                  for (const child of event.subagents ?? []) if (child.child) void this.observeChild(child.child.id)
                if (event.type === 'subagent.upsert' && event.subagent.child)
                  void this.observeChild(event.subagent.child.id)
              })
          },
          () => access.pi.archive(),
          (message) => this.adapter.decorate(message),
          (responseId, messageId) => this.eventQueue.push({ type: 'response-start', responseId, messageId })
        )
        resource = { relation, handle: access, projection }
        await projection.attach()
        this.children.set(key, { state: 'attached', resource })
        this.childTasks.publish(id, this.childTasks.status(id) ?? 'in_progress')
        return resource
      })
      .catch(async (error) => {
        logger.error('Failed to observe Pi child', { id, error })
        if (resource) {
          try {
            await resource.projection.stop()
          } catch (flushError) {
            this.children.set(key, { state: 'closing', resource })
            logger.error('Failed to flush Pi child attachment', { id, error: flushError })
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
    const opened = await this.handle.pi.openChild(toolCallId, this.closingAccess.signal)
    if (opened.status !== 'confirmed') return undefined
    const child = await this.observeChild(opened.value.relation.child.id, opened.value.handle)
    if (!child) return undefined
    await child.projection.attach()
    return {
      snapshot: child.projection.snapshot.bind(child.projection),
      subscribe: child.projection.subscribe.bind(child.projection)
    }
  }

  async messageChild(contextId: string, text: string): Promise<void> {
    const child = (await this.childResources()).find((child) => child.projection.context.id === contextId)
    const projection = child?.projection
    const handle = child?.handle
    if (!handle || !projection || this.closing) throw new Error('Child native owner is unavailable')
    await projection.flush()
    const { sessionId } = projection.context
    const messageId = randomUUID()
    messages.saveMessage({
      sessionId,
      message: { id: messageId, role: 'user', data: { parts: [{ type: 'text', text }] } }
    })
    const draft = prepareNativeSubmission(sessionId, messageId, contextId, 'steer')
    await projection.refresh()
    const result = await handle.input.submit(draft)
    applyNativeSubmissionResult(sessionId, contextId, result)
    await projection.refresh()
    if (result.status !== 'acknowledged') throw new Error(result.error.message)
  }

  private async childResources(): Promise<PiChildResource[]> {
    const resources: PiChildResource[] = []
    for (const child of this.children.values()) {
      const resource = child.state === 'opening' ? await child.pending : child.resource
      if (resource) resources.push(resource)
    }
    return resources
  }

  async drainChildWrites(): Promise<void> {
    await this.handle?.pi.settled()
    await this.observation?.drain()
    await this.childResources()
    if (this.closing) {
      await this.closePromise
      return
    }
    for (const child of await this.childResources()) await child.projection.drain()
  }

  async stopTask(taskId: string): Promise<boolean> {
    const handle = (await this.childResource(taskId))?.handle
    if (!handle?.interrupt) return false
    const result = await handle.interrupt()
    if (result.status !== 'confirmed') throw new Error(result.error.message)
    return true
  }

  private captureInput(input: InputState): void {
    this.eventQueue.push({ type: 'input-state', contextId: this.context!.id, input })
    if (!input.inputId || !input.nativeInput) return
    this.pendingBindings.set(input.inputId, input)
    this.flushInputs()
  }

  private flushInputs(): void {
    for (const [id, input] of this.pendingBindings) {
      bindNativeInput(this.input.sessionId, this.context!.id, input)
      this.pendingBindings.delete(id)
    }
  }

  private handleNativeEvent(event: PiEvent): void {
    if (event.type === 'input-placed') {
      if (this.handle)
        this.captureInput({
          inputId: runtimeId(event.inputId),
          facts: ['placed'],
          nativeInput: { session: this.handle.thread, id: runtimeId(event.entryId) }
        })
      const steer = this.pendingSteers.has(event.inputId) ? event.inputId : undefined
      if (steer) {
        this.input.onSteerInjected?.([steer])
      }
    } else if (event.type === 'turn-complete') this.checkpoint = event.headEntryId
    else if (event.type === 'session-append' && this.context) {
      // Native SessionManager synchronously flushes on the first conversation entry.
      const id = this.context.nativeThreadId
      if (
        this.context.bindingState === 'pending' &&
        id &&
        event.entries.some((entry) => entry.type === 'message' && ['user', 'assistant'].includes(entry.message.role))
      ) {
        this.context = contexts.bindContext(this.context.id, id)
        this.eventQueue.push({ type: 'resume-token', token: id })
      }
    } else if (event.type === 'compaction-start')
      this.eventQueue.push({ type: 'compaction-start', trigger: mapCompactionTrigger(event.reason) })
    else if (event.type === 'compaction-end') {
      if (event.error || event.aborted) {
        const error = event.error ?? 'pi compaction aborted'
        if (this.manualCompactInFlight) this.failure = new Error(error)
        else this.eventQueue.push({ type: 'compaction-error', error, aborted: event.aborted })
      } else {
        this.checkpoint = this.handle?.pi.history().at(-1)?.id
        this.eventQueue.push({
          type: 'compaction-complete',
          anchor: {
            status: 'done',
            phase: 'agent-session',
            trigger: mapCompactionTrigger(event.reason),
            completedAt: new Date().toISOString()
          }
        })
      }
    }
  }

  private finishTurn(): void {
    if (!this.sending || this.closing) return
    this.cancelQueuedInputs()
    this.flushInputs()
    this.sending = false
    if (this.failure) this.eventQueue.push({ type: 'error', error: this.failure })
    else {
      const checkpoint = PiForkCheckpointSchema.safeParse({
        runtime: 'pi',
        runtimeSessionId: this.handle?.thread.id,
        leafId: this.checkpoint
      })
      this.eventQueue.push({
        type: 'turn-complete',
        forkAnchor: checkpoint.success ? { checkpoint: checkpoint.data } : undefined
      })
    }
    if (this.autonomous) {
      this.autonomous = false
      this.eventQueue.push({ type: 'autonomous-turn-state', state: 'finished' })
    }
  }

  private cancelQueuedInputs(): void {
    const result = this.handle?.pi.cancelQueuedInputs()
    if (!result) return
    if (result.status !== 'confirmed') throw new Error(result.error.message)
    for (const id of result.value) {
      this.pendingSteers.delete(id)
    }
    if (result.value.length) this.failure ??= new Error('Queued input was cancelled before Pi could consume it')
  }

  private recordUsage(usage: Usage): void {
    this.eventQueue.push({
      type: 'chunk',
      chunk: { type: 'message-metadata', messageMetadata: this.turnUsage.record(usage) }
    })
  }

  refreshTraceContext(context: AgentRuntimeTraceContext): void {
    this.input.trace = context
  }

  async reconcile(input: {
    modelId: UniqueModelId
    reasoningEffort?: AgentRuntimeConnectInput['reasoningEffort']
    serviceTier?: AgentRuntimeConnectInput['serviceTier']
    fastMode?: boolean
    knowledgeBaseIds?: readonly string[]
  }): Promise<AgentRuntimeReconcileResult> {
    const run = this.reconcileChain.then(() => this.reconcileOnce(input))
    this.reconcileChain = run.catch(() => undefined)
    return run
  }

  private async reconcileOnce(input: {
    modelId: UniqueModelId
    reasoningEffort?: AgentRuntimeConnectInput['reasoningEffort']
    serviceTier?: AgentRuntimeConnectInput['serviceTier']
    fastMode?: boolean
    knowledgeBaseIds?: readonly string[]
  }): Promise<AgentRuntimeReconcileResult> {
    let snapshot: PiConnectionSnapshot
    try {
      snapshot = await capturePiConnectionSnapshot(
        this.input.sessionId,
        this.input.agentId,
        input.modelId,
        input.knowledgeBaseIds
      )
    } catch (error) {
      if (error instanceof PiInvalidConnectionSnapshotError) return 'invalid'
      throw error
    }
    // The approval gate reads the mode per tool call, so a change applies mid-turn from the next call.
    const nextPermissionMode = snapshot.agent.configuration?.permission_mode ?? 'default'
    const nextDisabled = normalizeDisabledTools(snapshot.agent.disabledTools, snapshot)
    const disabled = this.active ? new Set([...this.disabledTools, ...nextDisabled]) : nextDisabled
    const changed = nextPermissionMode !== this.permissionMode || !setsEqual(disabled, this.disabledTools)
    const permissionChanged = this.permissionMode !== nextPermissionMode
    this.permissionMode = nextPermissionMode
    this.disabledTools = disabled
    if (
      this.failure ||
      snapshot.signature !== this.connectionSignature ||
      (input.reasoningEffort ?? 'default') !== (this.input.reasoningEffort ?? 'default') ||
      (input.serviceTier ?? 'standard') !== (this.input.serviceTier ?? 'standard') ||
      Boolean(input.fastMode) !== Boolean(this.input.fastMode)
    )
      return 'rebuild'
    if (permissionChanged) {
      const result = await this.handle?.pi.permissionModeChanged()
      if (result && result.status !== 'confirmed') return 'failed'
    }
    return changed ? 'patched' : 'current'
  }

  private resolveMcpToolMetadata(name: string) {
    return resolvePiMcpToolMetadata(this.handle?.pi.toolDefinition(name), this.mcpServerSnapshots)
  }

  private isToolDisabled(name: string): boolean {
    if (this.disabledTools.has(name)) return true
    const tool = this.resolveMcpToolMetadata(name)
    return (
      tool !== undefined &&
      (this.disabledTools.has(buildFunctionCallToolName(tool.serverName, tool.name)) ||
        this.disabledTools.has(`mcp__${tool.serverId}__${tool.name}`))
    )
  }

  async getContextUsage() {
    return this.handle
      ? this.handle.contextUsage()
      : {
          status: 'unknown' as const,
          error: { operation: 'contextUsage', code: 'not-connected', message: 'Runtime not connected' }
        }
  }

  close(): Promise<void> {
    this.closing = true
    this.closingAccess.abort()
    return (this.closePromise ??= this.finishClose().catch((error) => {
      this.closePromise = undefined
      throw error
    }))
  }

  private async finishClose(): Promise<void> {
    toolApprovalRegistry.abort(this.input.sessionId, 'pi-session-closed')
    if (!this.nativeClosed) {
      let activeArchive = true
      try {
        agentSessionService.getById(this.input.sessionId)
      } catch (error) {
        if (!isDataApiError(error) || error.code !== ErrorCode.NOT_FOUND) throw error
        activeArchive = false
      }
      // User-stop persists behavior state and reads approval rows; deleted archives only need owner shutdown.
      if (activeArchive) {
        if (this.handle?.interrupt) {
          const interrupted = await this.handle.interrupt()
          if (interrupted.status !== 'confirmed') throw new Error(interrupted.error.message)
        }
        await Promise.all(
          (await this.childResources()).map(async ({ handle }) => {
            if (handle?.interrupt) {
              const result = await handle.interrupt()
              if (result.status !== 'confirmed') throw new Error(result.error.message)
            }
          })
        )
      }
      this.cancelQueuedInputs()
      await this.observation?.drain()
      for (const child of await this.childResources()) await child.projection.drain()
      const result = await this.runtime?.shutdown()
      if (result && result.status !== 'confirmed') throw new Error(result.error.message)
      this.nativeClosed = true
    }
    await this.observation?.drain()
    for (const [key, child] of this.children) {
      const resource = child.state === 'opening' ? await child.pending : child.resource
      if (!resource) continue
      this.children.set(key, { state: 'closing', resource })
      await resource.projection.stop()
      await resource.handle.release()
      this.children.delete(key)
    }
    await this.observation?.stop()
    await this.projection?.close()
    this.flushInputs()
    await this.handle?.release()
    this.eventQueue.close()
  }
}

function normalizeDisabledTools(
  disabledTools: string[] | undefined | null,
  snapshot: PiConnectionSnapshot
): Set<string> {
  const disabled = new Set((disabledTools ?? []).map(normalizePiDisabledToolId))
  const unresolved = new Set([...disabled].filter((name) => name.startsWith(LEGACY_DSH_TOOL_PREFIX)))
  const legacyTools: Array<{ ids: string[]; nameAlias?: string; piName: string }> = listBuiltinToolPolicies({
    mountedServers: new Set(Object.values(CHERRY_MCP_SERVER))
  }).map((tool) => ({
    ids: [legacyDisabledToolId(tool.serverName, tool.toolName)],
    piName: buildPiMcpToolName(tool.serverName, tool.toolName)
  }))
  const catalog = application.get('McpCatalogService')
  for (const [namespace, server] of snapshot.mcpServerSnapshots) {
    if (!server) continue
    const tools = catalog.listTools(server.id, { includeDisabled: false })
    const names = tools.map((tool) => buildPiMcpToolName(server.id, tool.name))
    for (const tool of tools) {
      const name = buildPiMcpToolName(server.id, tool.name)
      const piName = buildPiMcpToolName(server.id, tool.name, names.indexOf(name) !== names.lastIndexOf(name))
      legacyTools.push({
        ids: [legacyDisabledToolId(namespace, tool.name), legacyDisabledToolId(server.id, tool.name)],
        nameAlias: legacyDisabledToolId(server.name, tool.name),
        piName
      })
      if (
        disabled.has(buildFunctionCallToolName(server.name, tool.name)) ||
        disabled.has(`mcp__${server.id}__${tool.name}`)
      ) {
        disabled.add(piName)
      }
    }
  }
  for (const id of unresolved) {
    // DSH used the configured namespace; display-name aliases are only safe when unambiguous.
    const exact = legacyTools.filter((tool) => tool.ids.includes(id))
    const matches = exact.length ? exact : legacyTools.filter((tool) => tool.nameAlias === id)
    const piNames = new Set(matches.map((tool) => tool.piName))
    if (piNames.size !== 1) continue
    for (const name of piNames) disabled.add(name)
    unresolved.delete(id)
  }
  assertLegacyDisabledToolsResolved(unresolved)
  // Sanitizing raw aliases can accidentally block another tool whose name collides.
  return disabled
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

/** pi triggers `manual` on `compact()`, `threshold`/`overflow` automatically — Cherry's
 *  anchor only distinguishes user-initiated from auto. */
function mapCompactionTrigger(reason: 'manual' | 'threshold' | 'overflow'): AgentSessionCompactionTrigger {
  return reason === 'manual' ? 'manual' : 'auto'
}

function parseManualCompactCommand(content: string): { instructions: string } | undefined {
  const trimmed = content.trim()
  if (!/^\/compact(?:\s|$)/.test(trimmed)) return undefined
  return { instructions: trimmed.slice('/compact'.length).trim() }
}
