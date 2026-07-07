import { readdirSync } from 'node:fs'
import path from 'node:path'

import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import type { AgentSession, AgentSessionEvent, CompactionResult, ContextUsage } from '@earendil-works/pi-coding-agent'
import { loggerService } from '@logger'
import { PromptBuilder } from '@main/ai/agents/prompt'
import type { MemoryToolContext } from '@main/ai/agents/tools/memoryTools'
import { buildAgentUserContent } from '@main/ai/runtime/agentUserContent'
import { skillService } from '@main/ai/skills/SkillService'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import { application } from '@main/core/application'
import type { AgentSessionCompactionAnchorData, AgentSessionCompactionTrigger } from '@shared/ai/agentSessionCompaction'
import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'
import { PI_BUILTIN_TOOLS } from '@shared/ai/piBuiltinTools'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import type { AgentConfiguration } from '@shared/data/types/agent'

import { AsyncEventQueue } from '../asyncEventQueue'
import { toolApprovalRegistry } from '../toolApproval/ToolApprovalRegistry'
import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimePolicyUpdate,
  AgentRuntimeUserInput
} from '../types'
import { createPiApprovalExtension } from './approvalExtension'
import { resolvePiProviderInjection } from './modelInjection'
import { buildMcpToolDefinitions } from './piMcpToolAdapter'
import { loadPiAi, loadPiOpenAiResponsesApi, loadPiSdk } from './piSdk'
import { PiStreamAdapter } from './piStreamAdapter'
import { AUTONOMY_TOOL_NAMES, buildAutonomyToolDefinitions } from './piToolAdapter'
import { type PiAiStreamFns, withTransportStream } from './piTransportStream'
import { createPiProviderExtension } from './providerExtension'

const logger = loggerService.withContext('PiRuntimeConnection')
const PI_BUILTIN_TOOL_NAMES = PI_BUILTIN_TOOLS.map((tool) => tool.name)
/** Agent persona assembler, shared across pi connections (mtime-cached reads). */
const promptBuilder = new PromptBuilder()

interface PendingSteer {
  input: AgentRuntimeUserInput
}

export class PiRuntimeConnection implements AgentRuntimeConnection {
  private readonly eventQueue = new AsyncEventQueue<AgentRuntimeEvent>()
  private readonly adapter = new PiStreamAdapter({ enqueue: (chunk) => this.eventQueue.push({ type: 'chunk', chunk }) })
  private session?: AgentSession
  private unsubscribe?: () => void
  private resumeToken?: string
  private lastStopReason?: string
  private closed = false
  /** Injected model id (pi `apiModelId`), stamped on context-usage so the renderer's
   *  per-model usage filter matches the composer's model candidates. */
  private modelId = ''
  /** Live tool policy read by the approval extension at fire-time (plan D4). */
  private permissionMode: AgentPermissionMode = 'default'
  private disabledTools = new Set<string>()
  /** Manual compact is a Cherry user turn, but pi only emits compaction events for `compact()` —
   *  no `agent_end`. This flag lets that path close exactly one host turn without making auto-compacts terminal. */
  private manualCompactInFlight = false
  /** Steers accepted by pi but not yet observed as delivered. pi emits the delivery boundary as a
   *  user `message_start`; default steering mode is one-at-a-time, so the delivery drain is mode-aware. */
  private readonly pendingSteers: PendingSteer[] = []

  readonly events = this.eventQueue

  constructor(private readonly input: AgentRuntimeConnectInput) {
    this.resumeToken = input.resumeToken
  }

  async start(): Promise<this> {
    const session = agentSessionService.getById(this.input.sessionId)
    const workspacePath = session?.workspace?.path
    if (!session?.agentId || !workspacePath) {
      throw new Error(`pi agent session ${this.input.sessionId} has no agent or workspace configured`)
    }
    const agent = agentService.getAgent(session.agentId)
    if (!agent?.model) {
      throw new Error(`pi agent ${session.agentId} has no model configured`)
    }

    // pi has no native permission modes; the approval extension enforces them.
    // `plan` is unsupported for pi (deferred) — it falls through to gate-all.
    this.permissionMode = agent.configuration?.permission_mode ?? 'default'
    this.disabledTools = normalizeDisabledTools(agent.disabledTools)


    const injection = await resolvePiProviderInjection(this.input.modelId ?? agent.model)
    this.modelId = injection.modelId

    const agentDir = application.getPath('feature.agents.pi.root')
    const sessionDir = application.getPath('feature.agents.pi.sessions')
    // Belt: force pi's global discovery away from the user's ~/.pi/agent. The
    // explicit `agentDir`/session-dir passed to the SDK objects below are the
    // suspenders (plan D9).
    process.env.PI_CODING_AGENT_DIR = agentDir
    process.env.PI_CODING_AGENT_SESSION_DIR = sessionDir

    const pi = await loadPiSdk()

    // App-managed-OAuth providers register a `streamSimple` that injects a fresh
    // OAuth token + provider headers + payload rewrite per call (the placeholder
    // key is never used for auth). pi's api-family stream functions must be
    // in-hand before the sync `streamSimple` is invoked, so load them here.
    const providerConfig = injection.transportAdapter
      ? withTransportStream(injection.providerConfig, injection.transportAdapter, await loadPiAiStreamFns())
      : injection.providerConfig

    // Cherry owns the credential + model registry: in-memory only, never pi's
    // global auth.json/models.json. The real key is a runtime override; the
    // registered provider config carries only the placeholder (plan D1).
    const authStorage = pi.AuthStorage.inMemory()
    authStorage.setRuntimeApiKey(injection.providerName, injection.apiKey)
    const modelRegistry = pi.ModelRegistry.inMemory(authStorage)
    modelRegistry.registerProvider(injection.providerName, providerConfig)
    const model = modelRegistry.find(injection.providerName, injection.modelId)
    if (!model) {
      throw new Error(`pi model ${injection.providerName}/${injection.modelId} could not be resolved after injection`)
    }

    // The workspace is always trusted: the user picked it by hand in Cherry, so there is
    // no separate "do you trust this project?" prompt. What actually loads from it is
    // still governed by the explicit `no*` flags below.
    const settingsManager = pi.SettingsManager.inMemory({}, { projectTrusted: true })

    // The agent's ENABLED Cherry-managed skills, resolved to absolute on-disk dirs
    // from the same store the claude driver reads. These are injected explicitly
    // via `additionalSkillPaths` below; disk auto-discovery stays off (see comment).
    const additionalSkillPaths = await resolveEnabledSkillPaths(session.agentId)

    const instructions = agent.instructions?.trim()
    const systemPromptOverride = await buildAgentSystemPrompt(workspacePath, agent.configuration, instructions)
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
        createPiProviderExtension(injection.providerName, providerConfig),
        createPiApprovalExtension({
          sessionId: this.input.sessionId,
          workspacePath,
          emit: (chunk) => this.eventQueue.push({ type: 'chunk', chunk }),
          getPermissionMode: () => this.permissionMode,
          isDisabled: (toolName) => this.disabledTools.has(toolName),
          // Scheduled/headless autonomy tools cannot wait for a renderer approval prompt.
          // disabledTools still hard-blocks them at fire-time.
          autoApprovedTools: AUTONOMY_TOOL_NAMES
        })
      ],
      // Suppress pi's disk-discovered SYSTEM.md / APPEND_SYSTEM.md before the
      // override runs; Cherry owns the agent persona.
      systemPrompt: '',
      appendSystemPrompt: [],
      ...(systemPromptOverride ? { systemPromptOverride: () => systemPromptOverride } : {})
    })
    await resourceLoader.reload()

    const sessionManager = this.resolveSessionManager(pi, workspacePath, sessionDir)

    // Cherry-owned autonomy tools are auto-approved for headless turns; third-party MCP tools
    // remain approval-gated even though both are presented to pi as custom tools.
    const autonomyTools = buildAutonomyToolDefinitions(...buildAutonomyToolContexts(agent.id, session))
    const mcpTools = await buildMcpToolDefinitions(agent.mcps ?? [])
    const customTools = [...autonomyTools, ...mcpTools]

    const { session: piSession } = await pi.createAgentSession({
      cwd: workspacePath,
      agentDir,
      authStorage,
      modelRegistry,
      settingsManager,
      sessionManager,
      resourceLoader,
      model,
      // pi defaults to read/bash/edit/write only; Cherry exposes grep/find/ls too,
      // so opt into the full built-in set explicitly.
      tools: [...PI_BUILTIN_TOOL_NAMES],
      customTools,
      // Bake disabled tools out of built-in and custom tool sets; the approval gate also blocks
      // them live so a mid-session disable is enforced.
      ...(this.disabledTools.size > 0 ? { excludeTools: [...this.disabledTools] } : {})
    })

    this.session = piSession
    this.unsubscribe = piSession.subscribe((event) => this.handlePiEvent(event))
    this.maybeEmitResumeToken()
    return this
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
    void session.prompt(content, options).catch((error) => {
      if (this.closed) return
      logger.error('pi prompt failed', error as Error)
      this.eventQueue.push({ type: 'error', error })
    })
  }

  redirect(input: AgentRuntimeUserInput): boolean {
    const session = this.session
    if (!session?.isStreaming) return false

    // buildAgentUserContent intentionally flattens attachments to absolute paths for filesystem agents;
    // pi's native image channel stays unused until Cherry models multimodal agent attachments end-to-end.
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

  /**
   * Live policy changes. pi has no native permission modes, so both updates only
   * mutate the state the approval gate reads at fire-time — no pi round-trip.
   * A tool disabled mid-session is enforced by the gate's block even though it was
   * not `excludeTools`-baked at create; a tool re-enabled after being baked out at
   * create stays absent for this session (revisit if live re-enable is needed).
   */
  applyPolicyUpdate(update: AgentRuntimePolicyUpdate): boolean {
    if (update.type === 'permission-mode') {
      this.permissionMode = update.permissionMode ?? 'default'
      return true
    }
    this.disabledTools = normalizeDisabledTools(update.agent.disabledTools)
    return true
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
    this.eventQueue.close()
  }

  private handlePiEvent(event: AgentSessionEvent): void {
    if (this.closed) return

    if (isUserMessageStart(event) && this.pendingSteers.length > 0) {
      const delivered = this.takeDeliveredSteers()
      if (delivered.length > 0) this.eventQueue.push({ type: 'steer-boundary', inputs: delivered })
    }

    this.adapter.handleEvent(event)

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
        return
      }
      this.maybeEmitResumeToken()
      const undelivered = this.pendingSteers.splice(0).map((pending) => pending.input)
      if (undelivered.length > 0) {
        // pi does NOT drain its steering queue when a turn ends (its error path especially leaves the
        // queue intact), so the un-delivered steer would re-inject into the NEXT run and the model
        // would see it twice. Drop pi's queue here — the host re-queues these steers as the next turn.
        this.session?.clearQueue()
        this.eventQueue.push({ type: 'steer-undelivered', inputs: undelivered })
      }
      if (this.lastStopReason === 'error') {
        const message = lastErrorMessage(event.messages)
        this.eventQueue.push({ type: 'error', error: new Error(message ?? 'pi agent turn failed') })
      } else {
        this.emitContextUsage()
        this.eventQueue.push({ type: 'turn-complete' })
      }
      this.lastStopReason = undefined
    }
  }

  private handleCompactionEnd(event: Extract<AgentSessionEvent, { type: 'compaction_end' }>): void {
    // Retry pending — a later compaction_end settles it (mirrors the agent_end willRetry hold).
    if (event.willRetry) return
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
    this.eventQueue.push({ type: 'compaction-complete', anchor: buildCompactionAnchor(event.reason, event.result) })
    this.maybeCompleteManualCompactTurn()
  }

  private maybeCompleteManualCompactTurn(): void {
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

/**
 * Load the pi-ai api-family stream functions a transport-adapter provider needs.
 * Both adapter providers (grok-cli, openai-codex) speak the openai-responses
 * surface, so only that family is loaded (simplification ceiling: map by
 * `providerConfig.api` if a non-responses adapter provider is ever added).
 */
async function loadPiAiStreamFns(): Promise<PiAiStreamFns> {
  const [piAi, responsesApi] = await Promise.all([loadPiAi(), loadPiOpenAiResponsesApi()])
  return { lazyStream: piAi.lazyStream, apiStreamSimple: responsesApi.streamSimple }
}

/**
 * Resolve the agent's ENABLED managed skills to their absolute on-disk directories,
 * reusing the SAME store the claude driver reads (`skillService.list({ agentId })`,
 * `isEnabled` from the `agent_skill` join). Each `folderName` maps to its canonical
 * `{dataPath}/Skills/<folderName>` dir via `getSkillDirectory`.
 *
 * Workspace-local `.claude/skills` are intentionally NOT included (the claude driver
 * merges them, but pi keeps disk auto-discovery off for trust) — only Cherry-managed,
 * explicitly-enabled skills cross the boundary as `additionalSkillPaths`.
 */
async function resolveEnabledSkillPaths(agentId: string): Promise<string[]> {
  const installed = await skillService.list({ agentId })
  return installed.filter((skill) => skill.isEnabled).map((skill) => skillService.getSkillDirectory(skill.folderName))
}

/**
 * Assemble the same always-on agent persona used by the Claude runtime, with plain agent
 * instructions trailing it.
 */
async function buildAgentSystemPrompt(
  workspacePath: string,
  config: AgentConfiguration | undefined,
  instructions: string | undefined
): Promise<string> {
  const agentPrompt = await promptBuilder.buildSystemPrompt(workspacePath, config, Boolean(instructions))
  return instructions ? `${agentPrompt}\n\n${instructions}` : agentPrompt
}

function buildAutonomyToolContexts(
  agentId: string,
  session: AgentSessionEntity
): [
  {
    agentId: string
    workspaceSource: AgentSessionWorkspaceSource
    workspacePath: string
    sourceChannelId?: string
  },
  MemoryToolContext
] {
  const workspacePath = session.workspace.path
  return [
    {
      agentId,
      workspaceSource: toWorkspaceSource(session),
      workspacePath,
      sourceChannelId: resolveSourceChannel(agentId, session.id)
    },
    { agentId, workspacePath }
  ]
}

/** Map the session's workspace to the source discriminated union the claw tools persist. */
function toWorkspaceSource(session: AgentSessionEntity): AgentSessionWorkspaceSource {
  switch (session.workspace.type) {
    case AGENT_WORKSPACE_TYPE.USER:
      return { type: AGENT_WORKSPACE_TYPE.USER, workspaceId: session.workspaceId }
    case AGENT_WORKSPACE_TYPE.SYSTEM:
      return { type: AGENT_WORKSPACE_TYPE.SYSTEM }
    default: {
      const exhaustive: never = session.workspace.type
      throw new Error(`Unsupported workspace type: ${String(exhaustive)}`)
    }
  }
}

/** The channel whose linked session is this one, if any — scopes notify/cron default delivery. */
function resolveSourceChannel(agentId: string, sessionId: string): string | undefined {
  try {
    return channelService.listChannels({ agentId }).find((channel) => channel.sessionId === sessionId)?.id
  } catch {
    return undefined
  }
}

/**
 * pi's built-in tool names are lowercase (`bash`/`read`/`edit`/`write`/…), but Cherry's
 * tool vocabulary is Claude-capitalized (`Bash`/`Read`/…) and the agent editor writes those
 * ids verbatim into `disabledTools`. The live approval gate (`has`) and the `excludeTools`
 * bake-out both match pi's lowercase names, so case-fold here or a disabled tool silently
 * runs at main-process privilege (a fail-open on a hard-block control).
 */
function normalizeDisabledTools(disabledTools: string[] | undefined | null): Set<string> {
  return new Set((disabledTools ?? []).map((tool) => tool.toLowerCase()))
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
