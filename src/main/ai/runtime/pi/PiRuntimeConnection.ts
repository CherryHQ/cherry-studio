import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import type {
  AgentSession,
  AgentSessionEvent,
  CompactionResult,
  ContextUsage,
  LoadExtensionsResult
} from '@earendil-works/pi-coding-agent'
import { loggerService } from '@logger'
import { buildAgentUserContent } from '@main/ai/runtime/agentUserContent'
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
    this.disabledTools = new Set(agent.disabledTools ?? [])

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

    const settingsManager = pi.SettingsManager.inMemory()

    const instructions = agent.instructions?.trim()
    const resourceLoader = new pi.DefaultResourceLoader({
      cwd: workspacePath,
      agentDir,
      settingsManager,
      // Provider injection re-applies across reloads (plan D1); the approval/policy
      // gate enforces disabledTools/global-install/rtk/approval per turn (plan D4).
      extensionFactories: [
        createPiProviderExtension(injection.providerName, injection.providerConfig),
        createPiApprovalExtension({
          sessionId: this.input.sessionId,
          emit: (chunk) => this.eventQueue.push({ type: 'chunk', chunk }),
          getPermissionMode: () => this.permissionMode,
          isDisabled: (toolName) => this.disabledTools.has(toolName)
        })
      ],
      // Cherry owns the persona: replace pi's discovered system prompt with the
      // agent's instructions when present, else keep pi's base (plan Phase 2).
      ...(instructions ? { systemPromptOverride: () => instructions } : {})
    })
    // Fail-closed project trust for executable workspace resources (plan D9).
    const trustStore = new pi.ProjectTrustStore(agentDir)
    await resourceLoader.reload({
      resolveProjectTrust: async (loadInput: { extensionsResult: LoadExtensionsResult }) => {
        const requiresTrust = pi.hasTrustRequiringProjectResources(workspacePath)
        const decision = trustStore.get(workspacePath) === true
        if (requiresTrust && !decision) {
          logger.info('pi workspace carries trust-requiring resources; leaving them unloaded until trusted', {
            sessionId: this.input.sessionId,
            extensions: loadInput.extensionsResult.extensions.length
          })
        }
        // Executable project resources load only when explicitly trusted; the
        // user-facing prompt that writes the decision lands in Phase 5.
        return decision
      }
    })

    const sessionManager = this.resumeToken
      ? pi.SessionManager.open(this.resumeToken, sessionDir, workspacePath)
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
    // No native steer in v1 (plan D6): the host only calls send() to start a
    // turn. `followUp` is a defensive guard in case a message arrives while a
    // turn is still winding down.
    const options = session.isStreaming ? ({ streamingBehavior: 'followUp' } as const) : undefined
    void session.prompt(content, options).catch((error) => {
      if (this.closed) return
      logger.error('pi prompt failed', error as Error)
      this.eventQueue.push({ type: 'error', error })
    })
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
    this.disabledTools = new Set(update.agent.disabledTools ?? [])
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
    return usage ? this.projectContextUsage(usage) : null
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
      if (event.willRetry) return
      this.maybeEmitResumeToken()
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
      return
    }
    this.eventQueue.push({ type: 'compaction-complete', anchor: buildCompactionAnchor(event.reason, event.result) })
  }

  private emitContextUsage(): void {
    const usage = this.session?.getContextUsage()
    if (!usage) return
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

/** pi triggers `manual` on `compact()`, `threshold`/`overflow` automatically — Cherry's
 *  anchor only distinguishes user-initiated from auto. */
function mapCompactionTrigger(reason: 'manual' | 'threshold' | 'overflow'): AgentSessionCompactionTrigger {
  return reason === 'manual' ? 'manual' : 'auto'
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

function lastErrorMessage(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as { role?: string; errorMessage?: string }
    if (message.role === 'assistant' && typeof message.errorMessage === 'string') return message.errorMessage
  }
  return undefined
}
