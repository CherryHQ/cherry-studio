import { randomUUID } from 'node:crypto'

import { loggerService } from '@logger'
import type { UniqueModelId } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'

import { AsyncEventQueue } from './AsyncEventQueue'
import { resolveAgentFallbackPolicy, selectFallbackModelId } from './modelFallback'
import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimePromptPolicy,
  AgentRuntimeReconcileResult,
  AgentRuntimeTraceContext,
  AgentRuntimeUserInput,
  AgentSessionRuntimeDriver
} from './types'

const logger = loggerService.withContext('AgentSessionFallbackConnection')

/** Provider statuses that justify leaving the primary model for this turn. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 529])
/** The dsh-llm `LlmFailure.code` taxonomy, which routes on the code and never on `message`. */
const RETRYABLE_CODE = new Set([
  'RATE_LIMIT',
  'RATE_LIMITED',
  'SERVER',
  'TIMEOUT',
  'TRANSPORT',
  'QUOTA',
  'EMPTY_RESPONSE'
])
const HTTP_FAILURE_CODE = /^HTTP[_-]?(\d{3})$/
/** The harness sentinel for "no machine class": it names nothing, so it decides nothing. */
const UNKNOWN_FAILURE_CODE = 'UNKNOWN'

interface ProviderFailureFacts {
  status?: number
  code?: string
}

/** The structured provider facts an error carries, or undefined when none of them decides. */
function readProviderFailureFacts(error: object): ProviderFailureFacts | undefined {
  const candidate = error as {
    status?: unknown
    statusCode?: unknown
    code?: unknown
    failure?: { status?: unknown; code?: unknown }
  }
  const status = [candidate.status, candidate.statusCode, candidate.failure?.status].find(
    (value): value is number => typeof value === 'number'
  )
  const code = [candidate.code, candidate.failure?.code].find(
    (value): value is string => typeof value === 'string' && value.length > 0
  )
  return status !== undefined || (code !== undefined && code !== UNKNOWN_FAILURE_CODE) ? { status, code } : undefined
}

function classifyProviderFailure(facts: ProviderFailureFacts): string | undefined {
  if (facts.status !== undefined) return RETRYABLE_STATUS.has(facts.status) ? `http ${facts.status}` : undefined
  const code = facts.code
  if (code === undefined) return undefined
  const httpStatus = code.match(HTTP_FAILURE_CODE)?.[1]
  if (httpStatus !== undefined) return RETRYABLE_STATUS.has(Number(httpStatus)) ? `http ${httpStatus}` : undefined
  return RETRYABLE_CODE.has(code.toUpperCase()) ? code.toLowerCase() : undefined
}

/** Compatibility prose matching only: a retryable status has to be named as one. */
const MESSAGE_HTTP_STATUS =
  /\b(?:http|status(?:[\s_-]?code)?|code|api[\s_-]?error)\b[\s:#=()/-]{0,8}(429|500|502|503|529)\b/i
/** Provider vocabulary: it is what makes a bare status or an `overload` credible as provider prose. */
const MESSAGE_PROVIDER_FRAME =
  /\b(?:api|provider|upstream|servers?|services?|models?|llm|completions?|https?|status)\b/i
const MESSAGE_STATUS = /\b(429|500|502|503|529)\b/
const MESSAGE_PROVIDER_REASON =
  /\brate[\s_-]?limit|too many requests|resource_exhausted|insufficient_quota|quota_exceeded/i
/** Also names local alarms ("worker overload"), so it counts only inside a provider frame. */
const MESSAGE_OVERLOAD = /\boverload/i

function classifyMessageFailure(message: string): string | undefined {
  const inProviderFrame = MESSAGE_PROVIDER_FRAME.test(message)
  const status =
    MESSAGE_HTTP_STATUS.exec(message)?.[1] ?? (inProviderFrame ? MESSAGE_STATUS.exec(message)?.[1] : undefined)
  if (status !== undefined) return `http ${status}`
  if (MESSAGE_PROVIDER_REASON.test(message)) return message.slice(0, 80)
  return inProviderFrame && MESSAGE_OVERLOAD.test(message) ? message.slice(0, 80) : undefined
}

/**
 * Pi and DSH surface ordinary turn errors, rather than Claude's structured result error. Structured
 * provider facts decide; their prose qualifies only where the runtime reported nothing to route on.
 */
export function classifyRuntimeFallbackError(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const facts = readProviderFailureFacts(error)
  // A reported status or failure class is the runtime's own verdict and outranks the prose with it.
  if (facts) return classifyProviderFailure(facts)
  const message = (error as { message?: unknown }).message
  return classifyMessageFailure(typeof message === 'string' ? message : '')
}

/**
 * Chunk types that carry no user-visible payload (usage totals, step bookkeeping). A turn that
 * emitted only these has shown the user nothing, so replaying its input on the fallback model
 * cannot duplicate an answer — they must not mark the stream active and suppress the fallback.
 */
const NON_CONTENT_CHUNK_TYPES = new Set([
  'start',
  'start-step',
  'finish-step',
  'finish',
  'message-metadata',
  'abort',
  // Pi emits block starts separately from their deltas, so an empty boundary shows nothing yet.
  'text-start',
  'reasoning-start'
])

/**
 * Rebuilds a Pi/DSH connection once when a provider fails before producing turn content. It owns
 * one stable event stream, so the host keeps its existing turn, persistence listener, and renderer
 * stream while the runtime's provider/model injection is rebuilt for the fallback model.
 */
export class AgentSessionFallbackConnection implements AgentRuntimeConnection {
  private readonly queue = new AsyncEventQueue<AgentRuntimeEvent>()
  readonly events = this.queue
  private current: AgentRuntimeConnection
  private currentModelId: UniqueModelId
  private lastInput?: AgentRuntimeUserInput
  private resumeToken?: string
  private hasActivity = false
  private backgroundTasksRunning = false
  private backgroundWorkActive = false
  private attempted = false
  private closed = false
  /** The memoized whole-close operation; every caller shares its pending or rejected outcome. */
  private closePromise?: Promise<void>
  private pendingConnection?: AgentRuntimeConnection
  /** Settles when an in-flight rebuild connect does, so close() cannot outrun a rebuild it cannot see. */
  private pendingConnect?: Promise<void>
  /** Teardown of a replacement discard() is closing; close() joins it so the host's closing barrier
   *  releases only after the replacement's own shutdown settles — inheriting a rejection as one. */
  private pendingTeardown?: Promise<void>
  private trace?: AgentRuntimeTraceContext
  /** True while a fallback replacement is starting up: the host still reconciles the connection it
   *  holds (the old one), so policy updates landing in that window are retained for the replacement. */
  private replacementInFlight = false
  /** The latest reconcile the replacement has not seen yet; re-applied before its replay is admitted. */
  private retainedReconcile?: Parameters<AgentRuntimeConnection['reconcile']>[0]
  /** Set once the replacement's replay is submitted, until the swap publishes it as `current`.
   *  Pi and DSH can begin executing that prompt immediately, so saves landing in this window must
   *  reach it at once — retaining them for the post-swap re-apply would let a newly disabled tool
   *  run for the whole time send() is in flight. */
  private handoff?: AgentRuntimeConnection
  /** The model the in-flight replacement serves, so a handoff reconcile names it like the swap's. */
  private pendingModelId?: UniqueModelId
  /** Set when a reconcile the replacement owned could not be applied: it may still be enforcing the
   *  turn's OLD permission policy, so the swap must never publish it. */
  private replacementPolicyFailed = false
  /** Replacement reconciles whose verdict still decides whether the swap may publish it. */
  private readonly pendingReplacementReconciles = new Set<Promise<unknown>>()
  /** Every restriction the startup window's saves applied to the live turn, unioned as each lands:
   *  the old connection's final policy misses earlier ones when a later save re-enables them, and
   *  the replacement re-derives only that final row. */
  private readonly retainedDisabledTools = new Set<string>()
  /** Serializes the window's forwarded saves so each capture reads the state its own save left —
   *  a later re-enable would otherwise erase the restriction recorded before it. */
  private replacementReconcileChain: Promise<unknown> = Promise.resolve()
  /** The prompt the live turn was admitted with; a replay re-materializes it, never a later save. */
  private turnPrompt?: AgentRuntimePromptPolicy

  constructor(
    private readonly driver: AgentSessionRuntimeDriver,
    private readonly input: AgentRuntimeConnectInput,
    connection: AgentRuntimeConnection
  ) {
    this.current = connection
    this.currentModelId = input.modelId
    this.resumeToken = input.resumeToken
    this.trace = input.trace
    void this.pump()
  }

  get usageCapture() {
    return this.current.usageCapture
  }

  async send(input: AgentRuntimeUserInput): Promise<void> {
    this.lastInput = input
    // Captured at admission: a later save must reach the NEXT fresh turn, not this turn's replay.
    this.turnPrompt = this.current.getPromptPolicy?.()
    this.hasActivity = false
    this.attempted = false
    try {
      await this.current.send(input)
    } catch {
      // Submission failures already surface as an error event (and may fail over in pump()); the
      // rejection exists for fallback admission checks, so the host must not see a second channel.
    }
  }

  redirect(input: AgentRuntimeUserInput): boolean {
    const stashed = this.current.redirect?.(input) ?? false
    // A stashed steer moves the live turn onto the steered continuation, so the stored prompt is no
    // longer replayable: a fallback would resend the turn without the steer the host already folded in.
    if (stashed) this.lastInput = undefined
    return stashed
  }

  refreshTraceContext(context: Parameters<NonNullable<AgentRuntimeConnection['refreshTraceContext']>>[0]) {
    // Retained: a fallback rebuild re-reads this, and replaying the constructor's frozen context
    // would re-attribute the fallback turn to an earlier or empty turnId.
    this.trace = context
    return this.current.refreshTraceContext?.(context)
  }

  reconcile(input: Parameters<AgentRuntimeConnection['reconcile']>[0]) {
    // A replacement startup is invisible to the host: it reconciles the connection it still holds,
    // so a policy save landing in that window (e.g. disabling a tool) is retained and re-applied to
    // the replacement before its replay is admitted — otherwise the replay would run the turn
    // under a policy the user has already tightened. Once the replace is live on the replay, though,
    // it IS the connection this session's work runs on: hand the save to it directly, naming the
    // model it serves, rather than retaining it behind a submission that may not settle until after
    // the model has already started executing the prompt. Either way the old connection still gets
    // the save it can act on — retaining never suppresses that forward.
    if (this.handoff) {
      void this.trackReplacementReconcile(
        this.handoff.reconcile({ ...input, modelId: this.pendingModelId ?? input.modelId })
      )
    } else if (this.replacementInFlight) {
      this.retainedReconcile = input
      const forwarded = this.replacementReconcileChain.then(async () => {
        const verdict = await this.current.reconcile(input)
        this.rememberAppliedRestrictions()
        return verdict
      })
      this.replacementReconcileChain = forwarded.then(
        () => undefined,
        () => undefined
      )
      return forwarded
    }
    return this.current.reconcile(input)
  }

  getContextUsage() {
    return this.current.getContextUsage?.() ?? Promise.resolve(null)
  }

  getSupportedCommands() {
    return this.current.getSupportedCommands?.() ?? Promise.resolve(null)
  }

  stopTask(taskId: string) {
    return this.current.stopTask?.(taskId) ?? Promise.resolve(false)
  }

  abortTurn() {
    const current = this.current as AgentRuntimeConnection & { abortTurn?: () => Promise<boolean> }
    return current.abortTurn?.() ?? Promise.resolve(false)
  }

  async close(): Promise<void> {
    // Memoized as one operation: a retry while the shutdown is still settling (the host's 20-second
    // close barrier expired) or after it rejected joins the original outcome — reporting a fresh
    // success would clear failedClosures and archive the workspace with teardown unconfirmed.
    this.closePromise ??= this.closeOnce()
    return this.closePromise
  }

  private async closeOnce(): Promise<void> {
    this.closed = true
    // A rebuild is invisible until connect() hands it to `pendingConnection`, and it runs this
    // session's work from then on — wait for the handoff so it cannot outlive the close.
    await this.pendingConnect
    const pending = this.pendingConnection
    this.pendingConnection = undefined
    try {
      // A discard() raced by this close is still tearing its replacement down; joining that teardown
      // keeps the host's closing barrier up until the replacement's shutdown settles — and a
      // shutdown that rejects must reject this close too, or the host archives with the replacement
      // teardown unconfirmed.
      const legs = [
        Promise.resolve(this.current.close()),
        Promise.resolve(pending?.close()),
        Promise.resolve(this.pendingTeardown)
      ]
      const outcomes = await Promise.allSettled(legs)
      const failed = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
      if (failed) throw failed.reason
    } finally {
      this.queue.close()
    }
  }

  /** Closes a rebuilt connection that the swap never took over. */
  private async discard(connection: AgentRuntimeConnection): Promise<void> {
    if (this.pendingConnection !== connection) return
    this.pendingConnection = undefined
    // Retain the raw shutdown for close(): a close that raced the connect wakes on the very
    // microtask this discard clears `pendingConnection` on, and must join — and observe the failure
    // of — the replacement's shutdown. The detached catch defuses the rejection when no close comes.
    const teardown = Promise.resolve(connection.close())
    this.pendingTeardown ??= teardown
    teardown.catch(() => undefined)
    await teardown.catch(() => undefined)
  }

  private async pump(): Promise<void> {
    try {
      while (!this.closed) {
        let restarted = false
        for await (const event of this.current.events) {
          if (this.closed) return
          if (event.type === 'resume-token') this.resumeToken = event.token
          // An autonomous generation can start before the host turn's terminal event.
          // Its failure does not belong to the stored send(), even if that prompt is queued.
          if (event.type === 'turn-complete' || (event.type === 'autonomous-turn-state' && event.state === 'started')) {
            this.lastInput = undefined
          }
          if (event.type === 'background-tasks') this.backgroundTasksRunning = event.tasks.length > 0
          if (event.type === 'background-work-state') this.backgroundWorkActive = event.active
          if (event.type === 'chunk' && !NON_CONTENT_CHUNK_TYPES.has(event.chunk.type)) this.hasActivity = true
          if (event.type === 'error' && (await this.tryFallback(event.error))) {
            restarted = true
            break
          }
          this.queue.push(event)
        }
        if (!restarted) break
      }
    } catch (error) {
      if (!this.closed) this.queue.push({ type: 'error', error })
    } finally {
      this.queue.close()
    }
  }

  private async tryFallback(error: unknown): Promise<boolean> {
    if (
      this.closed ||
      this.attempted ||
      this.hasActivity ||
      this.backgroundTasksRunning ||
      this.backgroundWorkActive ||
      !this.lastInput
    )
      return false
    const reason = classifyRuntimeFallbackError(error)
    if (!reason) return false
    const fallbackModelId = selectFallbackModelId(resolveAgentFallbackPolicy(this.input.agentId), this.currentModelId)
    if (!fallbackModelId) return false
    // The replay must keep the turn's live policy: a save during the backoff (e.g. switching to
    // bypassPermissions) would otherwise re-admit the replayed turn under a mode that mid-turn
    // reconciliation itself defers. A policy that cannot be read cannot be preserved — decline.
    const turnPolicy = this.current.getPermissionPolicy?.()
    if (!turnPolicy) {
      logger.warn('Declining the fallback replay: the live turn policy cannot be read', {
        sessionId: this.input.sessionId,
        fallbackModelId
      })
      return false
    }
    this.attempted = true
    this.replacementInFlight = true
    let connection: AgentRuntimeConnection | undefined
    try {
      await this.current.close()
      if (this.closed) return false
      const created = Promise.withResolvers<void>()
      this.pendingConnect = created.promise
      try {
        connection = await this.driver.connect({
          ...this.input,
          modelId: fallbackModelId,
          resumeToken: this.resumeToken,
          permissionPolicy: turnPolicy,
          // Same turn, same prompt: only the model transport is rebuilt. A System Prompt saved
          // while the failed request was backing off takes effect on the next fresh turn.
          promptPolicy: this.turnPrompt,
          // The fallback connection's spans must name the model that will actually run, while keeping
          // the container ids of the latest refreshed context — the turnId the host is tracing.
          ...(this.trace ? { trace: { ...this.trace, modelName: parseUniqueModelId(fallbackModelId).modelId } } : {})
        })
      } finally {
        // Publish the rebuild before close() stops waiting on it, or a close that raced the connect
        // would find nothing to tear down and let it outlive the session.
        if (connection) this.pendingConnection = connection
        this.pendingConnect = undefined
        created.resolve()
      }
      if (this.closed) {
        await this.discard(connection)
        return false
      }
      this.hasActivity = false
      // Policy saves that landed while the replacement was starting must reach it before the replay
      // is admitted: the replacement keeps the turn's frozen mode and only tightens disabled tools.
      await this.applyRetainedReconcile(connection, fallbackModelId)
      // A Stop that landed during reconciliation owns this connection's teardown: submitting the
      // replay would start a prompt on the closing connection and discard its output.
      if (this.closed) return false
      // A retained restriction it could not apply leaves the replacement on the turn's OLD policy;
      // the replay would then execute the very tool the user just disabled.
      if (this.replacementPolicyFailed) throw new Error('fallback replay rejected: stale tool permissions')
      // From here until the swap publishes `current`, the replacement is the connection that will
      // serve this session's work: it owns the replay the moment it is submitted, so a save must
      // reach it in the same turn rather than wait behind that submission.
      this.handoff = connection
      this.pendingModelId = fallbackModelId
      // The swap is real only once the replay is admitted: a rejected send must leave no persisted
      // marker — and no live connection — claiming a swap that never happened. The new connection's
      // events are not pumped until this returns, so the marker still precedes them.
      await connection.send(this.lastInput)
      // A close() landing during that slow submission owns the teardown: it must not be handed a
      // live connection, nor a notice of one, after the session is already gone.
      if (this.closed) {
        await this.discard(connection)
        return false
      }
      // A save that raced the submission's own tail still lands before the swap publishes the
      // replacement as the connection the host reconciles.
      await this.applyRetainedReconcile(connection, fallbackModelId)
      // A handoff reconcile can still be in flight past the drain: it names a verdict that decides
      // adoption, so it must settle before the swap — and a failure it reported must veto it.
      await this.awaitPendingReplacementReconciles()
      if (this.replacementPolicyFailed) throw new Error('fallback replay rejected: stale tool permissions')
      const previousModelId = this.currentModelId
      this.current = connection
      this.handoff = undefined
      this.pendingModelId = undefined
      this.pendingConnection = undefined
      this.currentModelId = fallbackModelId
      this.queue.push({
        type: 'chunk',
        chunk: {
          type: 'data-model-fallback',
          id: randomUUID(),
          data: { from: previousModelId, to: fallbackModelId, reason }
        }
      })
      return true
    } catch (cause) {
      logger.warn('Pi/DSH fallback connection failed', { sessionId: this.input.sessionId, fallbackModelId, cause })
      if (connection) await this.discard(connection)
      return false
    } finally {
      // A handoff reconcile can still be in flight on the paths that return early; its verdict must
      // land before this attempt's flag resets, or it would veto a later attempt's adoption.
      await this.awaitPendingReplacementReconciles()
      this.replacementInFlight = false
      this.handoff = undefined
      this.pendingModelId = undefined
      this.retainedReconcile = undefined
      this.retainedDisabledTools.clear()
      this.replacementPolicyFailed = false
    }
  }

  /**
   * Re-apply the reconciles the replacement could not see, naming the model it now serves and
   * carrying every restriction the window applied: the replacement re-derives the agent's current
   * row, so a restriction a later save re-enabled survives only in this accumulated union. Drained
   * to exhaustion: a save can land while an earlier one is still being applied (that apply awaits
   * skill discovery), and the replay must not be admitted under a restriction already saved.
   */
  private async applyRetainedReconcile(connection: AgentRuntimeConnection, modelId: UniqueModelId): Promise<void> {
    while (this.retainedReconcile) {
      // A save still being captured has not finished recording what it applied; wait it out so the
      // carried union is complete before the replay is admitted under it.
      await this.replacementReconcileChain
      const retained = this.retainedReconcile
      this.retainedReconcile = undefined
      const verdict = await connection.reconcile({
        ...retained,
        modelId,
        ...(this.retainedDisabledTools.size > 0 ? { carriedDisabledTools: [...this.retainedDisabledTools] } : {})
      })
      this.recordReplacementVerdict(verdict)
    }
  }

  /** Folds what the window's save left applied on the old connection into the carried union. */
  private rememberAppliedRestrictions(): void {
    if (!this.replacementInFlight) return
    for (const tool of this.current.getPermissionPolicy?.()?.disabledTools ?? []) {
      this.retainedDisabledTools.add(tool)
    }
  }

  /**
   * A replacement reconcile the host fired directly must have its verdict awaited before adoption:
   * `failed` / `invalid` mean the replacement may still be enforcing the policy the user revoked.
   * The tracking also keeps an in-flight one from settling after the attempt's state is reset.
   */
  private async trackReplacementReconcile(pending: Promise<AgentRuntimeReconcileResult>): Promise<void> {
    const tracked = pending.then(
      (verdict) => {
        this.recordReplacementVerdict(verdict)
      },
      () => {
        // A thrown reconcile reports no verdict at all, so the replacement's policy is unknown.
        this.replacementPolicyFailed = true
      }
    )
    this.pendingReplacementReconciles.add(tracked)
    try {
      await tracked
    } finally {
      this.pendingReplacementReconciles.delete(tracked)
    }
  }

  /**
   * `failed` means a live patch did not land (the old, looser policy may still be enforced) and
   * `invalid` means the desired policy can no longer be derived; `rebuild` is the host's business
   * and stays non-blocking — a spawn-frozen drift never loosens the turn's policy.
   */
  private recordReplacementVerdict(verdict: AgentRuntimeReconcileResult): void {
    if (verdict === 'failed' || verdict === 'invalid') {
      logger.warn('Declining the fallback replay: the replacement could not enforce the saved policy', { verdict })
      this.replacementPolicyFailed = true
    }
  }

  private async awaitPendingReplacementReconciles(): Promise<void> {
    while (this.pendingReplacementReconciles.size > 0) {
      await Promise.allSettled([...this.pendingReplacementReconciles])
    }
  }
}
