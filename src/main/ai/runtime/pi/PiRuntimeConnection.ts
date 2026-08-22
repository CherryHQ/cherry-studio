import { randomUUID } from 'node:crypto'
import { readdirSync } from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import type {
  AgentSession,
  AgentSessionEvent,
  CompactionResult,
  ContextUsage,
  ProviderConfig,
  ToolDefinition
} from '@earendil-works/pi-coding-agent'
import { loggerService } from '@logger'
import { ensureAgentDataDirectory } from '@main/ai/agents/agentDataDirectory'
import { resolveAgentCapabilities, resolveMountedMcpServers } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { endAgentRuntimeSpan, startAgentRuntimeChildSpan } from '@main/ai/observability'
import { buildAgentMcpServers } from '@main/ai/runtime/agentMcpServers'
import { buildAgentRuntimePrompt } from '@main/ai/runtime/agentPrompt'
import { buildAgentUserContent } from '@main/ai/runtime/agentUserContent'
import { buildCitationsGuidance } from '@main/ai/runtime/citationsGuidance'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import { listBuiltinToolPolicies } from '@main/ai/toolApproval/builtinToolPolicy'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { customFetch } from '@main/ai/utils/customFetch'
import { resolveKnowledgeBaseScope } from '@main/ai/utils/knowledgeScope'
import { CHERRY_NODE_PROXY_RULES_ENV, getProxyEnvironment, proxyUrlHasCredentials } from '@main/services/proxy/proxyEnv'
import {
  getBinarySearchDirs,
  getBinaryShimsDir,
  mergeBinaryExecutionEnv,
  mergePathSuffixes
} from '@main/utils/binaryEnv'
import { getPathFromEnvironment, getShellEnv } from '@main/utils/shellEnv'
import { type Span, SpanKind, SpanStatusCode } from '@opentelemetry/api'
import type { AgentSessionCompactionAnchorData, AgentSessionCompactionTrigger } from '@shared/ai/agentSessionCompaction'
import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'
import {
  KB_READ_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME
} from '@shared/ai/builtinTools'
import { PI_NATIVE_BUILTIN_TOOLS, PI_TOOL_EXEC_TOOL_NAME } from '@shared/ai/piBuiltinTools'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { UniqueModelId } from '@shared/data/types/model'

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
import { createPiApprovalExtension, createPiToolAuthorizer } from './approvalExtension'
import { materializePiProviderStream, resolvePiProviderInjectionForSession } from './modelInjection'
import { createPiCodeModeTools } from './piCodeMode'
import { capturePiConnectionSnapshot, PiInvalidConnectionSnapshotError } from './piConnectionSignature'
import {
  buildMcpToolDefinitions,
  buildPiMcpToolName,
  type PiMcpToolBridge,
  warmMcpToolCatalogs
} from './piMcpToolAdapter'
import { loadPiAiCompat, loadPiSdk } from './piSdk'
import { PiStreamAdapter } from './piStreamAdapter'
import { createPiProviderExtension } from './providerExtension'

const logger = loggerService.withContext('PiRuntimeConnection')
const PI_BUILTIN_TOOL_NAMES = PI_NATIVE_BUILTIN_TOOLS.map((tool) => tool.name)
const PI_BUILTIN_TOOL_ALIASES = new Map(PI_BUILTIN_TOOL_NAMES.map((name) => [name.toLowerCase(), name]))

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
const PI_AUTO_APPROVED_MCP_TOOLS = new Set(
  listBuiltinToolPolicies({ approval: 'auto' }).map(({ serverName, toolName }) =>
    buildPiMcpToolName(serverName, toolName)
  )
)
const PI_APPROVAL_REQUIRED_TOOLS = new Set([
  PI_TOOL_EXEC_TOOL_NAME,
  ...listBuiltinToolPolicies({ approval: 'required' }).map(({ serverName, toolName }) =>
    buildPiMcpToolName(serverName, toolName)
  )
])
const PI_NON_BYPASSABLE_APPROVAL_TOOLS = new Set(
  listBuiltinToolPolicies({ approval: 'required', bypassApproval: 'enforce' }).map(({ serverName, toolName }) =>
    buildPiMcpToolName(serverName, toolName)
  )
)

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

interface PendingSteer {
  input: AgentRuntimeUserInput
}

export class PiRuntimeConnection implements AgentRuntimeConnection {
  private readonly generation = randomUUID()
  private readonly eventQueue = new AsyncEventQueue<AgentRuntimeEvent>()
  private readonly committedInvocationIds = new Set<string>()
  private readonly providerSpans = new Set<Span>()
  private readonly toolSpans = new Map<string, Span>()
  private readonly adapter = new PiStreamAdapter({ enqueue: (chunk) => this.eventQueue.push({ type: 'chunk', chunk }) })
  private session?: AgentSession
  private mcpBridge?: PiMcpToolBridge
  private unsubscribe?: () => void
  private resumeToken?: string
  private lastStopReason?: string
  private lastAgentError?: string
  private closed = false
  /** Injected model id (pi `apiModelId`), stamped on context-usage so the renderer's
   *  per-model usage filter matches the composer's model candidates. */
  private modelId = ''
  /** Live tool policy read by the approval extension at fire-time (plan D4). */
  private permissionMode: AgentPermissionMode = 'default'
  private disabledTools = new Set<string>()
  /** Spawn-frozen agent/model facts, excluding the live permission gate. */
  private connectionSignature?: string
  /** Serializes push/pull reconciles so snapshot reads and live policy writes cannot land out of order. */
  private reconcileChain: Promise<unknown> = Promise.resolve()
  private traceContext?: AgentRuntimeTraceContext
  private _usageCapture?: AgentSessionUsageCapture
  private apiProviderSourceId?: string
  private promptRunActive = false
  /** Manual compact is a Cherry user turn, but pi only emits compaction events for `compact()` —
   *  no `agent_end`. This flag lets that path close exactly one host turn without making auto-compacts terminal. */
  private manualCompactInFlight = false
  /** Steers accepted by pi but not yet observed as delivered. pi emits the delivery boundary as a
   *  user `message_start`; default steering mode is one-at-a-time, so the delivery drain is mode-aware. */
  private readonly pendingSteers: PendingSteer[] = []

  readonly events = this.eventQueue

  get usageCapture(): AgentSessionUsageCapture | undefined {
    return this._usageCapture
  }

  constructor(private readonly input: AgentRuntimeConnectInput) {
    this.resumeToken = input.resumeToken
    this.traceContext = input.trace
  }

  async start(): Promise<this> {
    // Warm the catalog before the authoritative snapshot so a cold cache does not look like a
    // configuration change halfway through materialization. A concurrent agent edit is caught by
    // the final snapshot check below.
    const discoverySnapshot = await capturePiConnectionSnapshot(
      this.input.sessionId,
      this.input.agentId,
      this.input.modelId,
      this.input.knowledgeBaseIds
    )
    await warmMcpToolCatalogs(discoverySnapshot.agent.mcps ?? [])
    const initialSnapshot = await capturePiConnectionSnapshot(
      this.input.sessionId,
      this.input.agentId,
      this.input.modelId,
      this.input.knowledgeBaseIds
    )
    const { agent, session } = initialSnapshot
    const workspacePath = session?.workspace?.path
    if (!session?.agentId || !workspacePath) {
      throw new Error(`pi agent session ${this.input.sessionId} has no agent or workspace configured`)
    }

    // pi has no native permission modes; the approval extension enforces them.
    // `plan` is unsupported for pi (deferred) — it falls through to gate-all.
    this.permissionMode = agent.configuration?.permission_mode ?? 'default'
    this.disabledTools = normalizeDisabledTools(agent.disabledTools)
    const injection = await resolvePiProviderInjectionForSession(
      this.input.sessionId,
      initialSnapshot.provider,
      initialSnapshot.model,
      initialSnapshot.enabledApiKeys
    )
    this.modelId = injection.modelId
    this._usageCapture = injection.usageCapture

    const agentDir = application.getPath('feature.agents.pi.root')
    const sessionDir = application.getPath('feature.agents.pi.sessions')
    const pi = await loadPiSdk()

    const materializedProvider = await materializePiProviderStream(injection)
    const providerConfig = withPiInvocationCapture(
      materializedProvider.providerConfig,
      withPiRequestEnvironment(materializedProvider.streamSimple, injection.requestEnvironment),
      (message) => this.recordProviderInvocation(message),
      (model) => this.startProviderSpan(model)
    )

    // Cherry owns the credential + model registry: in-memory only, never pi's
    // global auth.json/models.json. The real key is a runtime override; the
    // registered provider config carries only the placeholder (plan D1).
    const runtimeProviderName = `${injection.providerName}:${this.input.sessionId}:${this.generation}`
    const runtimeApi = `cherry-${this.input.sessionId}-${this.generation}-${injection.api}`
    const isolatedProviderConfig: ProviderConfig = {
      ...providerConfig,
      api: runtimeApi,
      models: providerConfig.models?.map((model) => ({ ...model, api: runtimeApi }))
    }
    const authStorage = pi.AuthStorage.inMemory()
    authStorage.setRuntimeApiKey(runtimeProviderName, injection.apiKey)
    const modelRegistry = pi.ModelRegistry.inMemory(authStorage)
    modelRegistry.registerProvider(runtimeProviderName, isolatedProviderConfig)
    this.apiProviderSourceId = `provider:${runtimeProviderName}`
    try {
      const model = modelRegistry.find(runtimeProviderName, injection.modelId)
      if (!model)
        throw new Error(`pi model ${runtimeProviderName}/${injection.modelId} could not be resolved after injection`)

      // The workspace is always trusted: the user picked it by hand in Cherry, so there is
      // no separate "do you trust this project?" prompt. What actually loads from it is
      // still governed by the explicit `no*` flags below.
      const settingsManager = pi.SettingsManager.inMemory({}, { projectTrusted: true })
      const loginPathPrefix = buildPiLoginPathPrefix(getPathFromEnvironment(await getShellEnv()))
      if (loginPathPrefix) settingsManager.setShellCommandPrefix(loginPathPrefix)

      // The agent's ENABLED Cherry-managed skills, resolved to absolute on-disk dirs
      // from the same store the claude driver reads. These are injected explicitly
      // via `additionalSkillPaths` below; disk auto-discovery stays off (see comment).
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
        citationsGuidance
      })
      const approvalContext = {
        sessionId: this.input.sessionId,
        workspacePath,
        agentDataPath,
        emit: (event: AgentRuntimeEvent) => this.eventQueue.push(event),
        getInteractionState: () =>
          application.get('AgentSessionRuntimeService').getInteractionState(this.input.sessionId),
        getPermissionMode: () => this.permissionMode,
        isDisabled: (toolName: string) => this.disabledTools.has(toolName),
        additionalReadOnlyRoots: additionalSkillPaths,
        // Safe first-party MCP tools may run headlessly; third-party and mutating tools still prompt.
        // disabledTools hard-blocks every class at fire-time.
        autoApprovedTools: PI_AUTO_APPROVED_MCP_TOOLS,
        approvalRequiredTools: PI_APPROVAL_REQUIRED_TOOLS,
        nonBypassableApprovalTools: PI_NON_BYPASSABLE_APPROVAL_TOOLS
      }
      const authorizeTool = createPiToolAuthorizer(approvalContext)
      const resourceLoader = new pi.DefaultResourceLoader({
        cwd: workspacePath,
        agentDir,
        settingsManager,
        // Provider injection re-applies across reloads (plan D1); the approval/policy
        // gate enforces disabledTools/global-install/rtk/approval per turn (plan D4).
        // The workspace is trusted (user-selected), so its AGENTS.md/CLAUDE.md context
        // files load — parity with the claude driver's `project` setting source. Other
        // disk auto-discovery stays off: extensions are arbitrary JS running inside
        // Cherry's main process (a different trust class than workspace text), and
        // skills/prompt-templates/themes are Cherry-managed — the agent's enabled
        // skills are injected explicitly via `additionalSkillPaths`, which loads even
        // under `noSkills` because the paths are Cherry-owned, not discovered.
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: false,
        additionalSkillPaths,
        extensionFactories: [
          createPiProviderExtension(runtimeProviderName, isolatedProviderConfig),
          createPiApprovalExtension(approvalContext)
        ],
        // Suppress pi's disk-discovered SYSTEM.md / APPEND_SYSTEM.md before the
        // override runs; Cherry owns the agent persona.
        systemPromptOverride: () => (prompt.base.kind === 'custom' ? prompt.base.content : undefined),
        appendSystemPromptOverride: () => (prompt.append ? [prompt.append] : [])
      })
      await resourceLoader.reload()

      const sessionManager = this.resolveSessionManager(pi, workspacePath, sessionDir)

      // Pi custom tools consume the complete runtime-neutral MCP set. Knowledge, memory, skills,
      // assistant tools, and user-configured servers all cross the same protocol adapter.
      const mountedServers = resolveMountedMcpServers(agent, { channelLinked: linkedChannel !== null })
      this.mcpBridge = await buildMcpToolDefinitions(
        buildAgentMcpServers(
          session,
          agent,
          mountedServers,
          initialSnapshot.mcpServerSnapshots,
          linkedChannel,
          agentDataPath,
          this.input.knowledgeBaseIds
        )
      )
      const customTools = createPiCodeModeTools(
        this.mcpBridge.tools,
        (toolName) => this.disabledTools.has(toolName),
        authorizeTool
      )
      // Replace pi's built-in bash with its SDK definition plus a spawn hook that preserves pi's
      // agent-bin PATH and safely layers the applicable Cherry-managed binary contract.
      const managedBashTool = pi.createBashToolDefinition(workspacePath, {
        spawnHook: (context) => ({
          ...context,
          env: mergePiBashExecutionEnv(context.env)
        })
      }) as ToolDefinition
      const finalSnapshot = await capturePiConnectionSnapshot(
        this.input.sessionId,
        this.input.agentId,
        this.input.modelId,
        this.input.knowledgeBaseIds
      )
      if (finalSnapshot.signature !== initialSnapshot.signature) {
        throw new Error(`Pi connection materialization changed during startup: ${this.input.sessionId}`)
      }
      this.connectionSignature = initialSnapshot.signature

      const created = await pi.createAgentSession({
        cwd: workspacePath,
        agentDir,
        authStorage,
        modelRegistry,
        settingsManager,
        sessionManager,
        resourceLoader,
        model,
        // pi treats `tools` as the complete active-tool allowlist, not just a built-in selector.
        tools: [...PI_BUILTIN_TOOL_NAMES, ...customTools.map((tool) => tool.name)],
        customTools: [managedBashTool, ...customTools],
        // Bake disabled tools out of built-in and custom tool sets; the approval gate also blocks
        // them live so a mid-session disable is enforced.
        ...(this.disabledTools.size > 0 ? { excludeTools: [...this.disabledTools] } : {})
      })
      const piSession = created.session

      this.session = piSession
      this.unsubscribe = piSession.subscribe((event) => this.handlePiEvent(event))
      this.maybeEmitResumeToken()
      return this
    } catch (error) {
      const bridge = this.mcpBridge
      this.mcpBridge = undefined
      const cleanup = await Promise.allSettled([bridge?.close(), this.unregisterApiProvider()])
      for (const result of cleanup) {
        if (result.status === 'rejected') logger.warn('Pi startup cleanup failed', { error: result.reason })
      }
      throw error
    }
  }

  /**
   * Pick the session manager for this connection. A fresh session (no resume token) is created with
   * the Cherry session id. On resume, a format-valid token whose file is missing on disk falls back
   * to a fresh session with the SAME id — pi flushes the JSONL lazily (nothing until the first
   * assistant message), so a token emitted before that flush points at a never-persisted session; a
   * hard failure here would brick the session forever (e.g. a first turn of `/compact` or a preflight
   * rejection). A malformed token still throws — that's the resume-dir attack-surface guard.
   */
  private resolveSessionManager(pi: Awaited<ReturnType<typeof loadPiSdk>>, workspacePath: string, sessionDir: string) {
    if (!this.resumeToken) {
      return pi.SessionManager.create(workspacePath, sessionDir, { id: this.input.sessionId })
    }
    const file = resolveResumeTokenSessionFile(this.resumeToken, sessionDir)
    if (file) return pi.SessionManager.open(file, sessionDir, workspacePath)
    logger.warn('pi resume token has no session file on disk; creating a fresh session with the same id', {
      sessionId: this.input.sessionId
    })
    return pi.SessionManager.create(workspacePath, sessionDir, { id: this.input.sessionId })
  }

  send(input: AgentRuntimeUserInput): void {
    const session = this.session
    if (!session) {
      this.eventQueue.push({ type: 'error', error: new Error('pi session is not started') })
      return
    }
    const rawContent = buildAgentUserContent(input.message)

    // A `systemReminder` message is a steer the host re-queued as its own turn (an undelivered steer
    // or a mid-turn-queued message). It must reach pi wrapped as a redirect (invariant 7, mirroring
    // the claude driver) and is never a manual `/compact` command — so skip the compact parse and
    // only wrapped, non-reminder text is considered for `/compact`.
    const manualCompact = input.systemReminder ? undefined : parseManualCompactCommand(rawContent)
    if (manualCompact) {
      this.manualCompactInFlight = true
      void session.compact(manualCompact.instructions || undefined).then(
        // compaction_end normally settles the turn first (events fire before resolve); this
        // settles the no-op case where pi resolves without emitting any compaction event.
        () => this.maybeCompleteManualCompactTurn(),
        (error) => {
          // pi always emits compaction_end (which already settled the turn and cleared the flag)
          // before rejecting, so this is normally a no-op. Only settle here defensively if the flag
          // is somehow still set (compaction_end never arrived) — never push a second terminal.
          if (!this.manualCompactInFlight) return
          this.manualCompactInFlight = false
          if (this.closed) return
          logger.error('pi compact failed', error as Error)
          this.eventQueue.push({ type: 'error', error })
        }
      )
      return
    }

    // Native steer lives in redirect() (plan D6); send() starts normal turns. pi only exposes
    // `/compact` as an SDK method; other Claude CLI commands stay Claude-only slash text.
    // `followUp` is a defensive guard in case a message arrives while a turn is still winding down.
    const content = input.systemReminder ? wrapSteerReminder(rawContent) : rawContent
    const options = session.isStreaming ? ({ streamingBehavior: 'followUp' } as const) : undefined
    this.promptRunActive = true
    void session.prompt(content, options).then(
      () => this.finishPromptRun(),
      (error) => this.finishPromptRun(error)
    )
  }

  redirect(input: AgentRuntimeUserInput): boolean {
    const session = this.session
    if (!session?.isStreaming) return false

    // buildAgentUserContent intentionally flattens attachments to filenames and absolute paths for
    // filesystem agents; pi's native image channel stays unused until Cherry models multimodal agent
    // attachments end-to-end.
    const wrappedText = wrapSteerReminder(buildAgentUserContent(input.message))
    const pending: PendingSteer = { input }
    this.pendingSteers.push(pending)
    void session.steer(wrappedText).catch((error) => {
      this.removePendingSteer(pending)
      if (this.closed) return
      logger.error('pi steer failed', error as Error)
      this.eventQueue.push({ type: 'error', error })
    })
    return true
  }

  refreshTraceContext(context: AgentRuntimeTraceContext): void {
    this.traceContext = context
  }

  /**
   * Reconcile Pi against the current agent snapshot. Disabled tools tighten immediately;
   * permission-mode changes wait for an idle boundary. Any spawn-frozen difference is
   * rebuilt by the host at the next safe boundary.
   */
  async reconcile(input: {
    modelId: UniqueModelId
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
    knowledgeBaseIds?: readonly string[]
  }): Promise<AgentRuntimeReconcileResult> {
    let snapshot
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
    const { agent } = snapshot

    const nextPermissionMode = agent.configuration?.permission_mode ?? 'default'
    // Changing the permission mode can alter admission for the current tool loop, so defer it until
    // pi is idle. Disabled tools only tighten policy and still apply immediately below.
    const applicablePermissionMode = this.session?.isStreaming ? this.permissionMode : nextPermissionMode
    const nextDisabledTools = normalizeDisabledTools(agent.disabledTools)
    const applicableDisabledTools = this.session?.isStreaming
      ? new Set([...this.disabledTools, ...nextDisabledTools])
      : nextDisabledTools
    const policyChanged =
      applicablePermissionMode !== this.permissionMode || !setsEqual(applicableDisabledTools, this.disabledTools)
    this.permissionMode = applicablePermissionMode
    this.disabledTools = applicableDisabledTools

    if (snapshot.signature !== this.connectionSignature) {
      return 'rebuild'
    }
    return policyChanged ? 'patched' : 'current'
  }

  /**
   * Live context-window usage, read straight from pi's own accounting (no token
   * re-derivation). Returns null before the first assistant response, when pi
   * cannot yet estimate occupancy. The host also pulls this on `turn-complete`
   * and `compaction-complete`, so the renderer indicator stays current.
   */
  async getContextUsage(): Promise<AgentSessionContextUsage | null> {
    const usage = this.session?.getContextUsage()
    // pi returns a truthy `ContextUsage` with `tokens: null` right after compaction
    // (before the next LLM response) — treat that as "not yet known" and return null
    // rather than projecting a misleading 0 / 0%.
    return usage && usage.tokens != null ? this.projectContextUsage(usage) : null
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    // Deny any approval still awaiting a renderer decision so its held tool
    // promise resolves instead of hanging past teardown (plan Phase 3).
    toolApprovalRegistry.abort(this.input.sessionId, 'pi-session-closed')
    // Unsubscribe first so the abort's terminal events do not race into a
    // closing queue.
    this.unsubscribe?.()
    this.unsubscribe = undefined
    try {
      await this.session?.abort()
    } catch (error) {
      logger.warn('pi session abort failed during close', { error })
    }
    this.session?.dispose()
    this.session = undefined
    this.endOpenTraceSpans('pi connection closed')
    await this.unregisterApiProvider()
    await this.mcpBridge?.close()
    this.mcpBridge = undefined
    this.eventQueue.close()
  }

  private handlePiEvent(event: AgentSessionEvent): void {
    if (this.closed) return

    if (event.type === 'tool_execution_start') this.startToolSpan(event)

    if (isUserMessageStart(event) && this.pendingSteers.length > 0) {
      const delivered = this.takeDeliveredSteers()
      if (delivered.length > 0) this.eventQueue.push({ type: 'steer-boundary', inputs: delivered })
    }

    this.adapter.handleEvent(event)

    if (event.type === 'tool_execution_end') this.endToolSpan(event)

    if (event.type === 'turn_end') {
      const stopReason = (event.message as { stopReason?: string }).stopReason
      if (stopReason) this.lastStopReason = stopReason
      return
    }

    if (event.type === 'compaction_start') {
      this.eventQueue.push({ type: 'compaction-start', trigger: mapCompactionTrigger(event.reason) })
      return
    }

    if (event.type === 'compaction_end') {
      this.handleCompactionEnd(event)
      return
    }

    if (event.type === 'agent_end') {
      // Auto-retry pending — the loop is not actually done, so hold the turn open.
      // Clear the stop-reason so a retry that succeeds isn't tainted by a prior
      // turn_end's `error` and mislabeled as a failed turn.
      if (event.willRetry) {
        this.lastStopReason = undefined
        this.lastAgentError = undefined
        return
      }
      this.lastAgentError = lastErrorMessage(event.messages)
      this.endOpenToolSpans(this.lastAgentError ?? 'pi agent run ended before tool completion')
      // Defensive compatibility for SDK-originated runs not started through send(). Normal Cherry
      // turns settle from session.prompt(), after retry/compaction continuation has fully drained.
      if (!this.promptRunActive) this.finishPromptRun()
    }
  }

  private finishPromptRun(error?: unknown): void {
    if (this.closed) return
    this.promptRunActive = false
    this.maybeEmitResumeToken()
    const undelivered = this.pendingSteers.splice(0).map((pending) => pending.input)
    if (undelivered.length > 0) {
      // pi does not drain its steering queue when a run ends. The host owns re-queuing.
      this.session?.clearQueue()
      this.eventQueue.push({ type: 'steer-undelivered', inputs: undelivered })
    }
    if (error || this.lastStopReason === 'error' || this.lastStopReason === 'length') {
      let failure: Error
      if (error instanceof Error) {
        failure = error
      } else if (this.lastStopReason === 'length') {
        failure = new Error(
          this.lastAgentError ??
            'Response truncated at the model output limit (stopReason: length). The reply may be incomplete or empty — try continuing the turn or retrying with a higher maximum output.'
        )
      } else {
        failure = new Error(this.lastAgentError ?? 'pi agent turn failed')
      }
      logger.error('pi prompt failed', failure)
      this.eventQueue.push({ type: 'error', error: failure })
    } else {
      this.emitContextUsage()
      this.eventQueue.push({ type: 'turn-complete' })
    }
    this.lastStopReason = undefined
    this.lastAgentError = undefined
  }

  private async unregisterApiProvider(): Promise<void> {
    const sourceId = this.apiProviderSourceId
    if (!sourceId) return
    this.apiProviderSourceId = undefined
    const compat = await loadPiAiCompat()
    compat.unregisterApiProviders(sourceId)
  }

  /** Capture at the provider stream boundary so compaction calls and ordinary turns share one owner. */
  private recordProviderInvocation(message: AssistantMessage): void {
    if (this.closed) return
    if (this._usageCapture?.owner !== 'agent-sdk') return
    if (message.stopReason === 'error' || message.stopReason === 'aborted') return

    const providerRequestId = message.responseId?.trim() || `${message.timestamp}:${message.model}`
    const requestId = `pi-agent:${this.input.sessionId}:${providerRequestId}`
    if (this.committedInvocationIds.has(requestId)) return
    this.committedInvocationIds.add(requestId)

    const noCacheTokens = finiteTokenCount(message.usage.input)
    const cacheReadTokens = finiteTokenCount(message.usage.cacheRead)
    const cacheWriteTokens = finiteTokenCount(message.usage.cacheWrite)
    const inputTokens = noCacheTokens + cacheReadTokens + cacheWriteTokens
    const outputTokens = finiteTokenCount(message.usage.output)
    this.eventQueue.push({
      type: 'usage',
      invocation: {
        requestId,
        model: message.responseModel?.trim() || message.model || this.modelId,
        messageAssociation: 'current-turn',
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          ...(message.usage.reasoning !== undefined
            ? { reasoningTokens: finiteTokenCount(message.usage.reasoning) }
            : {}),
          noCacheTokens,
          cacheReadTokens,
          cacheWriteTokens
        }
      }
    })
  }

  private startProviderSpan(model: { provider?: string; id?: string }): PiProviderSpanObserver | undefined {
    const span = startAgentRuntimeChildSpan(this.traceContext, 'pi.generate_content', SpanKind.CLIENT, {
      'gen_ai.operation.name': 'chat',
      ...(model.provider ? { 'gen_ai.provider.name': model.provider } : {}),
      ...(model.id ? { 'gen_ai.request.model': model.id } : {})
    })
    if (!span) return undefined
    this.providerSpans.add(span)
    return {
      complete: (message) => {
        if (!this.providerSpans.delete(span)) return
        try {
          const inputTokens =
            finiteTokenCount(message.usage.input) +
            finiteTokenCount(message.usage.cacheRead) +
            finiteTokenCount(message.usage.cacheWrite)
          span.setAttribute('gen_ai.response.model', message.responseModel?.trim() || message.model || this.modelId)
          if (message.responseId?.trim()) span.setAttribute('gen_ai.response.id', message.responseId.trim())
          span.setAttribute('gen_ai.response.finish_reasons', [message.stopReason])
          span.setAttribute('gen_ai.usage.input_tokens', inputTokens)
          span.setAttribute('gen_ai.usage.output_tokens', finiteTokenCount(message.usage.output))
          span.setAttribute('gen_ai.usage.cache_read_tokens', finiteTokenCount(message.usage.cacheRead))
          span.setAttribute('gen_ai.usage.cache_write_tokens', finiteTokenCount(message.usage.cacheWrite))
          if (message.usage.reasoning !== undefined) {
            span.setAttribute('gen_ai.usage.reasoning_tokens', finiteTokenCount(message.usage.reasoning))
          }
        } catch (error) {
          logger.warn('Failed to annotate Pi provider span', { error })
        }
        const failed = message.stopReason === 'error' || message.stopReason === 'aborted'
        endAgentRuntimeSpan(
          span,
          failed
            ? { code: SpanStatusCode.ERROR, message: message.errorMessage ?? message.stopReason }
            : { code: SpanStatusCode.OK }
        )
      },
      error: (error) => {
        if (!this.providerSpans.delete(span)) return
        const failure = error instanceof Error ? error : new Error(String(error))
        endAgentRuntimeSpan(span, { code: SpanStatusCode.ERROR, message: failure.message }, failure)
      }
    }
  }

  private startToolSpan(event: Extract<AgentSessionEvent, { type: 'tool_execution_start' }>): void {
    const previous = this.toolSpans.get(event.toolCallId)
    if (previous) this.endSpanWithError(previous, 'duplicate pi tool execution start')
    const span = startAgentRuntimeChildSpan(this.traceContext, 'pi.execute_tool', SpanKind.INTERNAL, {
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': event.toolName,
      'gen_ai.tool.call.id': event.toolCallId
    })
    if (span) this.toolSpans.set(event.toolCallId, span)
  }

  private endToolSpan(event: Extract<AgentSessionEvent, { type: 'tool_execution_end' }>): void {
    const span = this.toolSpans.get(event.toolCallId)
    if (!span) return
    this.toolSpans.delete(event.toolCallId)
    endAgentRuntimeSpan(
      span,
      event.isError ? { code: SpanStatusCode.ERROR, message: `${event.toolName} failed` } : { code: SpanStatusCode.OK }
    )
  }

  private endOpenToolSpans(message: string): void {
    for (const span of this.toolSpans.values()) this.endSpanWithError(span, message)
    this.toolSpans.clear()
  }

  private endOpenTraceSpans(message: string): void {
    this.endOpenToolSpans(message)
    for (const span of this.providerSpans) this.endSpanWithError(span, message)
    this.providerSpans.clear()
  }

  private endSpanWithError(span: Span, message: string): void {
    endAgentRuntimeSpan(span, { code: SpanStatusCode.ERROR, message })
  }

  private handleCompactionEnd(event: Extract<AgentSessionEvent, { type: 'compaction_end' }>): void {
    if (event.errorMessage || event.aborted) {
      // A failed manual /compact is a host turn: settle it with EXACTLY ONE terminal error (never
      // turn-complete, which would report the failure as a junk empty-assistant success and feed the
      // resume-token brick). pi always emits this compaction_end before `compact()` rejects, so
      // clearing the flag here makes the later reject handler a no-op.
      if (this.manualCompactInFlight) {
        this.manualCompactInFlight = false
        this.eventQueue.push({ type: 'error', error: new Error(event.errorMessage ?? 'pi compaction aborted') })
        return
      }
      // Auto-compaction failure stays non-terminal — the surrounding turn owns the terminal event.
      this.eventQueue.push({ type: 'compaction-error', error: event.errorMessage ?? 'pi compaction aborted' })
      return
    }
    // `willRetry` keeps the surrounding agent turn open; it does not defer this compaction result.
    // pi emits this successful compaction_end only once before retrying the model.
    this.eventQueue.push({ type: 'compaction-complete', anchor: buildCompactionAnchor(event.reason, event.result) })
    this.maybeCompleteManualCompactTurn()
  }

  private maybeCompleteManualCompactTurn(): void {
    if (this.closed) return
    if (!this.manualCompactInFlight) return
    this.manualCompactInFlight = false
    this.eventQueue.push({ type: 'turn-complete' })
  }

  private takeDeliveredSteers(): AgentRuntimeUserInput[] {
    const mode = this.session?.steeringMode ?? 'one-at-a-time'
    const count = mode === 'all' ? this.pendingSteers.length : 1
    return this.pendingSteers.splice(0, count).map((pending) => pending.input)
  }

  private removePendingSteer(pending: PendingSteer): void {
    const index = this.pendingSteers.indexOf(pending)
    if (index !== -1) this.pendingSteers.splice(index, 1)
  }

  private emitContextUsage(): void {
    const usage = this.session?.getContextUsage()
    // Skip the emit while pi cannot yet report occupancy (see getContextUsage).
    if (!usage || usage.tokens == null) return
    this.eventQueue.push({ type: 'context-usage', usage: this.projectContextUsage(usage) })
  }

  /** pi reports occupancy/window directly; Cherry owns per-category breakdown, which
   *  pi cannot produce, so `categories` is always empty (plan D5 — the total bar still renders). */
  private projectContextUsage(usage: ContextUsage): AgentSessionContextUsage {
    const totalTokens = usage.tokens ?? 0
    const maxTokens = usage.contextWindow
    const percentage = usage.percent ?? (maxTokens > 0 ? Math.min(100, (totalTokens / maxTokens) * 100) : 0)
    return { categories: [], totalTokens, maxTokens, percentage, model: this.modelId }
  }

  /** resume-token = pi session id; reopen scans Cherry's session dir for `*_<id>.jsonl`. */
  private maybeEmitResumeToken(): void {
    const token = this.session?.sessionId
    if (!token || token === this.resumeToken) return
    this.resumeToken = token
    this.eventQueue.push({ type: 'resume-token', token })
  }
}

function withPiInvocationCapture(
  config: ProviderConfig,
  streamSimple: NonNullable<ProviderConfig['streamSimple']>,
  onComplete: (message: AssistantMessage) => void,
  startTrace: (model: { provider?: string; id?: string }) => PiProviderSpanObserver | undefined
): ProviderConfig {
  return {
    ...config,
    streamSimple: (model, context, options) => {
      const traceObserver = startTrace(model)
      let stream: ReturnType<typeof streamSimple>
      try {
        stream = streamSimple(model, context, options)
      } catch (error) {
        traceObserver?.error(error)
        throw error
      }
      void stream.result().then(
        (message) => {
          traceObserver?.complete(message)
          onComplete(message)
        },
        (error) => traceObserver?.error(error)
      )
      return stream
    }
  }
}

interface PiProviderSpanObserver {
  complete(message: AssistantMessage): void
  error(error: unknown): void
}

function withPiRequestEnvironment(
  streamSimple: NonNullable<ProviderConfig['streamSimple']>,
  providerEnvironment: Record<string, string> | undefined
): NonNullable<ProviderConfig['streamSimple']> {
  return (model, context, options) => {
    const proxyEnvironment = getProxyEnvironment(process.env)
    const usesAuthenticatedNodeProxy = proxyUrlHasCredentials(proxyEnvironment[CHERRY_NODE_PROXY_RULES_ENV])

    // Electron net.fetch cannot authenticate these proxies; retain NodeProxyBackend's credential-aware dispatcher.
    return streamSimple(model, context, {
      ...options,
      env: { ...options?.env, ...proxyEnvironment, ...providerEnvironment },
      ...(!usesAuthenticatedNodeProxy && { fetch: customFetch })
    })
  }
}

function finiteTokenCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Alias only known pi built-ins from legacy Claude casing (`Bash` → `bash`). Custom and MCP ids are
 * runtime-native and case-sensitive, so preserve them exactly or their hard block silently misses.
 */
function normalizeDisabledTools(disabledTools: string[] | undefined | null): Set<string> {
  return new Set((disabledTools ?? []).map((tool) => PI_BUILTIN_TOOL_ALIASES.get(tool.toLowerCase()) ?? tool))
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

/**
 * Resolve a resume token to its on-disk pi session file. Returns `null` when the token is
 * format-valid but no matching file exists yet (pi persists the JSONL lazily, so a token can point
 * at a session that never flushed) — the caller degrades to a fresh session instead of failing.
 * Throws only on a malformed token (path separators / traversal / illegal chars), which stays
 * fail-closed as the resume-dir attack-surface guard.
 */
function resolveResumeTokenSessionFile(resumeToken: string, sessionDir: string): string | null {
  if (
    !resumeToken ||
    resumeToken !== path.basename(resumeToken) ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(resumeToken)
  ) {
    throw new Error('pi resume token must be a valid session id inside Cherry-owned session dir')
  }

  let entries: string[]
  try {
    entries = readdirSync(sessionDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') entries = []
    else throw error
  }

  // pi owns the timestamped filename prefix; Cherry persists the stable id suffix.
  // If the same id is recreated, the lexicographically greatest timestamp is the newest state.
  const match = entries
    .filter((entry) => entry.endsWith(`_${resumeToken}.jsonl`))
    .sort()
    .at(-1)
  return match ? path.join(sessionDir, match) : null
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

function buildCompactionAnchor(
  reason: 'manual' | 'threshold' | 'overflow',
  result: CompactionResult | undefined
): AgentSessionCompactionAnchorData {
  const anchor: AgentSessionCompactionAnchorData = {
    status: 'done',
    phase: 'agent-session',
    trigger: mapCompactionTrigger(reason),
    completedAt: new Date().toISOString()
  }
  if (typeof result?.tokensBefore === 'number') anchor.preTokens = result.tokensBefore
  if (typeof result?.estimatedTokensAfter === 'number') anchor.postTokens = result.estimatedTokensAfter
  return anchor
}

function isUserMessageStart(event: AgentSessionEvent): boolean {
  return event.type === 'message_start' && (event.message as { role?: string }).role === 'user'
}

function lastErrorMessage(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as { role?: string; errorMessage?: string }
    if (message.role === 'assistant' && typeof message.errorMessage === 'string') return message.errorMessage
  }
  return undefined
}
