import { readFileSync, readdirSync, lstatSync } from 'node:fs'

import type { Usage } from '@earendil-works/pi-ai'
import type { ContextUsage, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { SpanKind, SpanStatusCode, type Span } from '@opentelemetry/api'

import { application } from '@application'
import { runtimeId, type InputState, type Observation, type ObservationPayload } from '@cherrystudio/agent-runtime'
import type { AgentRuntimeEvent as PiEvent, PiRuntime, PiThreadHandle } from '@cherrystudio/agent-runtime-pi'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { loggerService } from '@logger'
import { ensureAgentDataDirectory } from '@main/ai/agents/agentDataDirectory'
import { resolveAgentCapabilities, resolveMountedMcpServers } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { ThreadProjection } from '@main/ai/agentSession/ThreadProjection'
import { startAgentRuntimeChildSpan, endAgentRuntimeSpan } from '@main/ai/observability'
import { buildAgentMcpServers, warmAgentMcpToolCatalogs } from '@main/ai/runtime/agentMcpServers'
import { buildAgentRuntimePrompt } from '@main/ai/runtime/agentPrompt'
import { prepareAgentSessionWorkspaceDirectory } from '@main/ai/runtime/agentSessionWorkspace'
import { buildAgentUserContent } from '@main/ai/runtime/agentUserContent'
import { readRetryPolicy } from '@main/ai/runtime/aiSdk'
import { buildCitationsGuidance } from '@main/ai/runtime/citationsGuidance'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import { CHERRY_MCP_SERVER, listBuiltinToolPolicies } from '@main/ai/toolApproval/builtinToolPolicy'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { resolveKnowledgeBaseScope } from '@main/ai/utils/knowledgeScope'
import {
  getBinarySearchDirs,
  getBinaryShimsDir,
  mergeBinaryExecutionEnv,
  mergePathSuffixes
} from '@main/utils/binaryEnv'
import { autoDiscoverGitBash, validateGitBashPath } from '@main/utils/commandResolver'
import { getPathFromEnvironment, getShellEnv } from '@main/utils/shellEnv'
import type { AgentSessionCompactionTrigger } from '@shared/ai/agentSessionCompaction'
import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'
import {
  KB_READ_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME
} from '@shared/ai/builtinTools'
import { normalizePiDisabledToolId } from '@shared/ai/piBuiltinTools'
import { LEGACY_DSH_TOOL_PREFIX } from '@shared/ai/retiredAgentRuntime'
import { buildFunctionCallToolName } from '@shared/ai/tools/mcpToolName'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import { resolveApiGatewayRuntime } from '../agentApiGateway'
import { AsyncEventQueue } from '../AsyncEventQueue'
import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeReconcileResult,
  AgentRuntimeTraceContext,
  AgentRuntimeUserInput,
  AgentSessionUsageCapture
} from '../types'
import { createPiApprovalExtension } from './approvalExtension'
import { PiForkCheckpointSchema } from './forkCheckpoint'
import { createPiGatewayModelBinding } from './gatewayModelBinding'
import { createPiIdentityExtension } from './identityExtension'
import { legacyDisabledToolId, assertLegacyDisabledToolsResolved } from './legacyToolPolicy'
import {
  capturePiConnectionSnapshot,
  type PiConnectionSnapshot,
  PiInvalidConnectionSnapshotError
} from './piConnectionSignature'
import { buildPiMcpToolName, createPiMcpExtension } from './piMcpExtension'
import { loadPiSdk, loadPiVccExtension } from './piSdk'
import { PiStreamAdapter, resolvePiMcpToolMetadata } from './piStreamAdapter'

const logger = loggerService.withContext('PiRuntimeConnection')

function quoteShellWord(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

/** Preserve pi's own PATH prefix while appending directories resolved by the user's login shell. */
export function buildPiLoginPathPrefix(
  loginPath: string | undefined,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  return platform !== 'win32' && loginPath ? `export PATH="$PATH":${quoteShellWord(loginPath)}` : undefined
}

/** Read the one field Cherry honors from the user's global pi settings; absent or malformed means unset. */
function readPiShellPathSetting(): string | undefined {
  try {
    const settings: unknown = JSON.parse(readFileSync(application.getPath('external.pi.settings_file'), 'utf8'))
    const shellPath = (settings as Record<string, unknown> | null)?.shellPath
    return typeof shellPath === 'string' && shellPath.trim() ? shellPath.trim() : undefined
  } catch {
    return undefined
  }
}

function resolvePiShellPath(): string | undefined {
  if (process.platform !== 'win32') return undefined
  const configured = readPiShellPathSetting()
  if (!configured) return autoDiscoverGitBash() ?? undefined

  const shellPath = validateGitBashPath(configured)
  if (!shellPath) throw new Error(`Configured Pi shellPath is unavailable or is not bash.exe: ${configured}`)
  return shellPath
}

function mergePiBashExecutionEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const definedEnv = Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  const binarySearchDirs = getBinarySearchDirs()
  const managedShimsDir = getBinaryShimsDir()
  const standaloneBinaryDirs = binarySearchDirs.filter((directory) => directory !== managedShimsDir)
  const callerOwnsMiseEnvironment = Object.keys(definedEnv).some((key) => key.toUpperCase().startsWith('MISE_'))

  if (callerOwnsMiseEnvironment) {
    // A generic shell may already be activated against the user's mise installation. Do not
    // redirect that installation to Cherry's isolated data directory or expose Cherry's shims
    // under an incompatible MISE_* contract. Bundled standalone binaries remain a safe fallback,
    // but stay behind the caller's PATH so they cannot replace the user's own tool versions.
    return mergePathSuffixes(definedEnv, standaloneBinaryDirs, [managedShimsDir])
  }

  return mergeBinaryExecutionEnv(definedEnv, standaloneBinaryDirs)
}

export class PiRuntimeConnection implements AgentRuntimeConnection {
  readonly retainWhileIdle = true
  readonly usageCapture: AgentSessionUsageCapture = { owner: 'provider-calls' }
  private readonly eventQueue = new AsyncEventQueue<AgentRuntimeEvent>()
  readonly events = this.eventQueue
  private runtime?: PiRuntime
  private handle?: PiThreadHandle
  private observation?: Observation
  private context?: ReturnType<typeof contexts.preparePiBranch>
  private closing = false
  private closePromise?: Promise<void>
  private active = false
  private sending = false
  private manualCompactInFlight = false
  private failure?: unknown
  private connectionSignature?: string
  private permissionMode: AgentPermissionMode = 'default'
  private disabledTools = new Set<string>()
  private reconcileChain: Promise<unknown> = Promise.resolve()
  private mcpServerSnapshots: PiConnectionSnapshot['mcpServerSnapshots'] = new Map()
  private readonly pendingSteers = new Map<string, AgentRuntimeUserInput>()
  private readonly pendingWrites = new Map<string, InputState[]>()
  private readonly toolSpans = new Map<string, Span>()
  private readonly toolNames = new Map<string, string>()
  private checkpoint?: string
  private reasoningTokens: number | undefined
  private usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  private readonly adapter = new PiStreamAdapter(
    { enqueue: (chunk) => this.eventQueue.push({ type: 'chunk', chunk }) },
    (name) => this.resolveMcpToolMetadata(name)
  )
  private readonly projection = new ThreadProjection(
    (chunk) => this.eventQueue.push({ type: 'chunk', chunk }),
    (item) => {
      const ref = item.type === 'tool-call' ? item.ref : item.call
      const id = ref && this.handle?.pi.toolCallId(ref)
      if (!id) throw new Error('Pi tool result has no matching call identity')
      if (item.type === 'tool-call') {
        const span = startAgentRuntimeChildSpan(this.input.trace, 'pi.execute_tool', SpanKind.INTERNAL, {
          'gen_ai.operation.name': 'execute_tool',
          'gen_ai.tool.name': item.name,
          'gen_ai.tool.call.id': id
        })
        if (span) this.toolSpans.set(id, span)
        this.toolNames.set(id, item.name)
        this.adapter.handleToolStart(id, item.name, JSON.parse(item.argumentsText))
      } else {
        this.adapter.handleToolEnd(id, this.toolNames.get(id) ?? '', item.data, item.outcome === 'error')
        const span = this.toolSpans.get(id)
        if (span)
          endAgentRuntimeSpan(span, { code: item.outcome === 'error' ? SpanStatusCode.ERROR : SpanStatusCode.OK })
        this.toolSpans.delete(id)
        this.toolNames.delete(id)
      }
    }
  )

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
    const binding = await createPiGatewayModelBinding(
      this.input,
      initialSnapshot.provider,
      initialSnapshot.model,
      (usage) => this.recordUsage(usage)
    )
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
      additionalReadOnlyRoots: additionalSkillPaths,
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
    this.context = contexts.preparePiBranch(
      this.input.sessionId,
      this.input.branchHead,
      this.input.resumeToken ?? this.input.nativeSessionId
    )
    const nativeId = this.context.nativeThreadId ?? this.context.intendedThreadId
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
      (this.context.nativeThreadId || messages.hasContextSubmission(this.input.sessionId, this.context.id)) &&
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
    const managedBashTool = pi.createBashToolDefinition(workspacePath, {
      commandPrefix: loginPathPrefix,
      shellPath,
      spawnHook: (context) => ({ ...context, env: mergePiBashExecutionEnv(context.env) })
    }) as ToolDefinition
    const retry = readRetryPolicy()
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
      settings: {
        retry: {
          enabled: retry.enabled,
          maxRetries: retry.maxAttempts - 1,
          ...(retry.backoffEnabled ? {} : { baseDelayMs: 0 })
        },
        ...(shellPath ? { shellPath } : {}),
        ...(loginPathPrefix ? { shellCommandPrefix: loginPathPrefix } : {})
      },
      extensionFactories: [
        createPiApprovalExtension(approvalContext),
        createPiIdentityExtension(agentDataPath),
        pi.createCodemodeExtension({ models: false }),
        pi.createToolSearchExtension(),
        createPiMcpExtension(pi, mcpServers, application.getPath('feature.agents.pi.root', 'mcp.log')),
        await loadPiVccExtension(application.getPath('feature.agents.pi.root', 'pi-vcc-config.json'))
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
      this.handle = opened.value
      if (files.length) contexts.bindContext(this.context.id, nativeId)
      const observed = await this.handle.observe((event) => this.handleObservation(event))
      if (observed.status !== 'confirmed') throw new Error(observed.error.message)
      this.observation = observed.value
      if (files.length) this.eventQueue.push({ type: 'resume-token', token: nativeId })
      return this
    } catch (error) {
      await this.close()
      throw error
    }
  }

  async send(input: AgentRuntimeUserInput): Promise<void> {
    if (!this.handle || !this.context || this.closing) throw new Error('Pi Runtime is unavailable')
    if (this.sending) throw new Error('Pi already has an active submission')
    this.sending = true
    this.failure = undefined
    this.usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    this.reasoningTokens = undefined
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

  redirect(input: AgentRuntimeUserInput): boolean {
    if (!this.active || this.closing) return false
    this.pendingSteers.set(input.message.id, input)
    void this.submit(input, wrapSteerReminder(buildAgentUserContent(input.message)), 'steer').catch((error) => {
      this.pendingSteers.delete(input.message.id)
      this.failure = error
      this.eventQueue.push({ type: 'error', error })
    })
    return true
  }

  private async submit(input: AgentRuntimeUserInput, text: string, whenBusy: 'reject' | 'steer'): Promise<void> {
    const draft = messages.prepareSubmission(this.input.sessionId, input.message.id, this.context!.id, whenBusy, text)
    const result = await this.handle!.input.submit(draft)
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

  private handleObservation(event: ObservationPayload): void {
    try {
      this.projection.accept(event)
      if (event.type === 'snapshot') {
        for (const input of event.inputs) this.captureInput(input)
        this.active = event.activity.state === 'active'
      } else if (event.type === 'input.changed') {
        this.captureInput(event.input)
        const steer = event.input.inputId && this.pendingSteers.get(event.input.inputId)
        if (steer && event.input.facts.includes('placed')) {
          this.pendingSteers.delete(steer.message.id)
          this.eventQueue.push({ type: 'steer-boundary', inputs: [steer] })
        }
        if (event.input.response) this.eventQueue.push({ type: 'input-response', input: event.input })
        if (event.input.outcome && event.input.outcome !== 'completed')
          this.failure ??= new Error(event.input.error?.message ?? event.input.outcome)
      } else if (event.type === 'activity.changed') {
        this.active = event.activity.state === 'active'
        if (event.activity.state === 'idle' && this.sending && !this.manualCompactInFlight) this.finishTurn()
      } else if (event.type === 'diagnostic') {
        this.failure ??= new Error(event.error.message)
        if (!this.active) this.finishTurn()
      } else if (event.type === 'gap' && event.reason !== 'mapping-reset') {
        throw new Error(`Pi observation interrupted: ${event.reason}`)
      }
    } catch (error) {
      this.failure = error
      this.sending = false
      this.eventQueue.push({ type: 'error', error })
      void this.close().catch((closeError) =>
        logger.error('Failed to retire Pi after observation error', { error: closeError })
      )
    }
  }

  private captureInput(input: InputState): void {
    if (!input.inputId || !messages.hasSubmission(this.input.sessionId, input.inputId)) return
    this.pendingWrites.set(input.inputId, [...(this.pendingWrites.get(input.inputId) ?? []), input])
    this.flushInputs()
  }

  private flushInputs(): void {
    for (const [id, inputs] of this.pendingWrites) {
      application.get('DbService').withWriteTx((tx) => {
        for (const input of inputs) messages.mergeSubmissionTx(tx, this.input.sessionId, id, input)
      })
      this.pendingWrites.delete(id)
    }
  }

  private handleNativeEvent(event: PiEvent): void {
    if (event.type === 'input-settled') {
      const completed = !event.aborted && event.stopReason === 'stop' && !event.hasToolCalls
      for (const inputId of event.inputIds)
        this.captureInput({
          inputId: runtimeId(inputId),
          facts: [],
          outcome: completed
            ? 'completed'
            : event.aborted
              ? 'aborted'
              : event.stopReason === 'error'
                ? 'failed'
                : 'unanswered'
        })
    } else if (event.type === 'input-placed') {
      if (this.handle)
        this.captureInput({
          inputId: runtimeId(event.inputId),
          facts: ['placed'],
          nativeInput: { session: this.handle.thread, id: runtimeId(event.entryId) }
        })
      const steer = this.pendingSteers.get(event.inputId)
      if (steer) {
        this.input.onSteerInjected?.([steer])
      }
    } else if (event.type === 'turn-complete') this.checkpoint = event.headEntryId
    else if (event.type === 'session-append' && this.context) {
      // Native SessionManager synchronously flushes on the first conversation entry.
      const id = this.context.intendedThreadId
      if (
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
    this.endToolSpans('Pi turn ended before tool completion')
    if (this.failure) this.eventQueue.push({ type: 'error', error: this.failure })
    else {
      const usage = this.handle?.pi.contextUsage()
      if (usage?.tokens != null) this.eventQueue.push({ type: 'context-usage', usage: this.projectContextUsage(usage) })
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
  }

  private cancelQueuedInputs(): void {
    const result = this.handle?.pi.cancelQueuedInputs()
    if (!result) return
    if (result.status !== 'confirmed') throw new Error(result.error.message)
    for (const id of result.value) {
      this.captureInput({ inputId: id, facts: [], outcome: 'aborted' })
      this.pendingSteers.delete(id)
    }
    if (result.value.length) this.failure ??= new Error('Queued input was cancelled before Pi could consume it')
  }

  private recordUsage(usage: Usage): void {
    if (usage.reasoning !== undefined) this.reasoningTokens = (this.reasoningTokens ?? 0) + usage.reasoning
    this.usage.inputTokens += usage.input + usage.cacheRead + usage.cacheWrite
    this.usage.outputTokens += usage.output
    this.usage.totalTokens += usage.totalTokens
    this.eventQueue.push({
      type: 'chunk',
      chunk: {
        type: 'message-metadata',
        messageMetadata: {
          totalTokens: this.usage.totalTokens,
          stats: {
            ...this.usage,
            ...(this.reasoningTokens === undefined
              ? {}
              : { outputTokenDetails: { reasoningTokens: this.reasoningTokens } })
          }
        }
      }
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
    const nextPermissionMode = this.active
      ? this.permissionMode
      : (snapshot.agent.configuration?.permission_mode ?? 'default')
    const nextDisabled = normalizeDisabledTools(snapshot.agent.disabledTools, snapshot)
    const disabled = this.active ? new Set([...this.disabledTools, ...nextDisabled]) : nextDisabled
    const changed = nextPermissionMode !== this.permissionMode || !setsEqual(disabled, this.disabledTools)
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

  async getContextUsage(): Promise<AgentSessionContextUsage | null> {
    const usage = this.handle?.pi.contextUsage()
    return usage && usage.tokens != null ? this.projectContextUsage(usage) : null
  }

  private projectContextUsage(usage: ContextUsage): AgentSessionContextUsage {
    return {
      categories: [],
      totalTokens: usage.tokens ?? 0,
      maxTokens: usage.contextWindow,
      percentage: usage.percent ?? 0,
      model: parseUniqueModelId(this.input.modelId).modelId
    }
  }

  private endToolSpans(message: string): void {
    for (const span of this.toolSpans.values()) endAgentRuntimeSpan(span, { code: SpanStatusCode.ERROR, message })
    this.toolSpans.clear()
    this.toolNames.clear()
  }

  close(): Promise<void> {
    this.closing = true
    return (this.closePromise ??= this.finishClose().catch((error) => {
      this.closePromise = undefined
      throw error
    }))
  }

  private async finishClose(): Promise<void> {
    toolApprovalRegistry.abort(this.input.sessionId, 'pi-session-closed')
    if (this.handle?.interrupt) {
      const interrupted = await this.handle.interrupt()
      if (interrupted.status !== 'confirmed') throw new Error(interrupted.error.message)
    }
    this.cancelQueuedInputs()
    const result = await this.runtime?.shutdown()
    if (result && result.status !== 'confirmed') throw new Error(result.error.message)
    await this.observation?.stop()
    this.flushInputs()
    await this.handle?.release()
    this.endToolSpans('Pi owner closed')
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
