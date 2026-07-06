import path from 'node:path'

import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import type { AgentSession, AgentSessionEvent, CompactionResult, ContextUsage } from '@earendil-works/pi-coding-agent'
import { loggerService } from '@logger'
import { buildAgentUserContent } from '@main/ai/runtime/agentUserContent'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import { application } from '@main/core/application'
import type { AgentSessionCompactionAnchorData, AgentSessionCompactionTrigger } from '@shared/ai/agentSessionCompaction'
import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'

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
import { loadPiSdk } from './piSdk'
import { PiStreamAdapter } from './piStreamAdapter'
import { createPiProviderExtension } from './providerExtension'

const logger = loggerService.withContext('PiRuntimeConnection')
const PI_BUILTIN_TOOL_NAMES = ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write'] as const

interface PendingSteer {
  input: AgentRuntimeUserInput
}

/** Bridges pi's callback-based `subscribe` onto the `AsyncIterable` event contract. */
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
    const session = await agentSessionService.getById(this.input.sessionId)
    const workspacePath = session?.workspace?.path
    if (!session?.agentId || !workspacePath) {
      throw new Error(`pi agent session ${this.input.sessionId} has no agent or workspace configured`)
    }
    const agent = await agentService.getAgent(session.agentId)
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

    // Cherry owns the credential + model registry: in-memory only, never pi's
    // global auth.json/models.json. The real key is a runtime override; the
    // registered provider config carries only the placeholder (plan D1).
    const authStorage = pi.AuthStorage.inMemory()
    authStorage.setRuntimeApiKey(injection.providerName, injection.apiKey)
    const modelRegistry = pi.ModelRegistry.inMemory(authStorage)
    modelRegistry.registerProvider(injection.providerName, injection.providerConfig)
    const model = modelRegistry.find(injection.providerName, injection.modelId)
    if (!model) {
      throw new Error(`pi model ${injection.providerName}/${injection.modelId} could not be resolved after injection`)
    }

    const settingsManager = pi.SettingsManager.inMemory({}, { projectTrusted: false })

    const instructions = agent.instructions?.trim()
    const resourceLoader = new pi.DefaultResourceLoader({
      cwd: workspacePath,
      agentDir,
      settingsManager,
      // Provider injection re-applies across reloads (plan D1); the approval/policy
      // gate enforces disabledTools/global-install/rtk/approval per turn (plan D4).
      // Project-local and user-global pi resources are disabled for v1. Loading
      // workspace `.pi/*`, `.agents/skills`, AGENTS.md/CLAUDE.md, or user
      // ~/.agents requires an explicit Cherry trust/import model first.
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        createPiProviderExtension(injection.providerName, injection.providerConfig),
        createPiApprovalExtension({
          sessionId: this.input.sessionId,
          emit: (chunk) => this.eventQueue.push({ type: 'chunk', chunk }),
          getPermissionMode: () => this.permissionMode,
          isDisabled: (toolName) => this.disabledTools.has(toolName)
        })
      ],
      // Suppress pi's disk-discovered SYSTEM.md / APPEND_SYSTEM.md before the
      // override runs; Cherry owns the persona from the agent record only.
      systemPrompt: '',
      appendSystemPrompt: [],
      ...(instructions ? { systemPromptOverride: () => instructions } : {})
    })
    await resourceLoader.reload()

    const sessionManager = this.resumeToken
      ? pi.SessionManager.open(assertResumeTokenInSessionDir(this.resumeToken, sessionDir), sessionDir, workspacePath)
      : pi.SessionManager.create(workspacePath, sessionDir)

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
      // Bake disabled tools out of the session's tool set (plan capability matrix);
      // the approval gate also blocks them live so a mid-session disable is enforced.
      ...(this.disabledTools.size > 0 ? { excludeTools: [...this.disabledTools] } : {})
    })

    this.session = piSession
    this.unsubscribe = piSession.subscribe((event) => this.handlePiEvent(event))
    this.maybeEmitResumeToken()
    return this
  }

  send(input: AgentRuntimeUserInput): void {
    const content = buildAgentUserContent(input.message)
    const session = this.session
    if (!session) {
      this.eventQueue.push({ type: 'error', error: new Error('pi session is not started') })
      return
    }
    const manualCompact = parseManualCompactCommand(content)
    if (manualCompact) {
      this.manualCompactInFlight = true
      void session.compact(manualCompact.instructions || undefined).then(
        // compaction_end normally settles the turn first (events fire before resolve); this
        // settles the no-op case where pi resolves without emitting any compaction event.
        () => this.maybeCompleteManualCompactTurn(),
        (error) => {
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
      if (undelivered.length > 0) this.eventQueue.push({ type: 'steer-undelivered', inputs: undelivered })
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
      this.eventQueue.push({ type: 'compaction-error', error: event.errorMessage ?? 'pi compaction aborted' })
      this.maybeCompleteManualCompactTurn()
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

  /** resume-token = pi `sessionFile` path (reopen handle for `SessionManager.open`). */
  private maybeEmitResumeToken(): void {
    const sessionFile = this.session?.sessionFile
    if (!sessionFile || sessionFile === this.resumeToken) return
    this.resumeToken = sessionFile
    this.eventQueue.push({ type: 'resume-token', token: sessionFile })
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

function assertResumeTokenInSessionDir(resumeToken: string, sessionDir: string): string {
  const resolvedToken = path.resolve(resumeToken)
  const resolvedSessionDir = path.resolve(sessionDir)
  const relative = path.relative(resolvedSessionDir, resolvedToken)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('pi resume token points outside Cherry-owned session dir')
  }
  return resolvedToken
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
