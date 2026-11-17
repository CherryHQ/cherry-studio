import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import type { Usage } from '@earendil-works/pi-ai'

import type { BehaviorEvent } from '@cherrystudio/agent-behavior'
import { runtimeId, type InputState, type Observation, type Subagent } from '@cherrystudio/agent-runtime'
import type {
  DurableObservation,
  PiDurableRuntime,
  PiDurableThreadHandle
} from '@cherrystudio/agent-runtime-pi-durable'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { loggerService } from '@logger'
import { ChildThreadProjection } from '@main/ai/agentSession/ChildThreadProjection'
import {
  prepareNativeSubmission,
  lookupNativeInput,
  bindNativeInput,
  applyNativeSubmissionResult,
  nativeOutcomeTerminal
} from '@main/ai/agentSession/nativeSubmission'
import { ThreadProjection } from '@main/ai/agentSession/ThreadProjection'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { t } from '@main/i18n'
import type { AutonomousTurnOrigin } from '@shared/ai/agentSessionTurnOrigin'
import { AsyncEventQueue } from '@shared/utils/async'

import { buildAgentUserContent } from '../agentUserContent'
import { PiChildTasks } from '../pi/PiChildTasks'
import { PiInvalidConnectionSnapshotError } from '../pi/piConnectionSignature'
import { PiMessageMetadata } from '../pi/PiMessageMetadata'
import { PiTurnUsage } from '../pi/PiTurnUsage'
import { PROMPT_SUGGESTION_INSTRUCTION } from '../promptSuggestion'
import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeReconcileResult,
  AgentRuntimeTraceContext,
  AgentRuntimeCommand
} from '../types'
import type { DurableBackend, DurableRoot } from './DurableBackend'
import type { prepareDurableBranch } from './durableContext'
import { saveDurableRequest } from './durableRequest'

const logger = loggerService.withContext('PiDurableRuntimeConnection')

/** Applies one input change the way `ThreadFeed` does: it replaces the same input and moves to the end. */
function withInput(inputs: readonly InputState[], input: InputState): InputState[] {
  return [
    ...inputs.filter(
      (known) =>
        !(input.inputId !== undefined && known.inputId === input.inputId) &&
        !(input.nativeInput !== undefined && known.nativeInput?.id === input.nativeInput.id)
    ),
    input
  ]
}

/** Root access and its observed child projections borrow the backend owner. */
type DurableChildResource = {
  relation: Subagent
  handle: PiDurableThreadHandle
  projection: ChildThreadProjection
  /** Viewers and in-flight commands that keep a finished child loaded. */
  pins: number
  finished: boolean
}

function isCompactCommand(text: string) {
  return /^\/compact(?:\s|$)/.test(text.trim())
}

/** Durable answered the submission; the host already received it as `input-submission`. */
class SubmissionRefused extends Error {}

export class PiDurableRuntimeConnection implements AgentRuntimeConnection {
  get contextId(): string | undefined {
    return this.context?.id
  }

  readonly retainWhileIdle = true
  readonly retainOnStop = true
  readonly usageCapture = { owner: 'provider-calls' as const }
  readonly events = new AsyncEventQueue<AgentRuntimeEvent>()
  private runtime?: PiDurableRuntime
  private handle?: PiDurableThreadHandle
  private observation?: Observation
  private context?: ReturnType<typeof prepareDurableBranch>
  private desktop?: DurableRoot['desktop']
  private access?: { owner: DurableBackend; root: DurableRoot; release(flush: () => Promise<void>): Promise<void> }
  private closing = false
  private readonly closingAccess = new AbortController()
  private closePromise?: Promise<void>
  private active = false
  private sending = false
  private compacting = false
  private autonomous = false
  private failure?: unknown
  private admission: Promise<unknown> = Promise.resolve()
  private runEnded?: PromiseWithResolvers<void>
  private nextOrigin: AutonomousTurnOrigin = { kind: 'background-work' }
  private providerSessionId?: string
  private readonly turnUsage = new PiTurnUsage()
  private reconcileChain: Promise<unknown> = Promise.resolve()
  private readonly steers = new Set<string>()
  /** The last state reported per input; snapshots repeat unchanged ones. */
  private readonly captured = new Map<string, InputState>()
  /** Inputs submitted while native work ran; their placement is announced even with an outcome. */
  private readonly queued = new Set<string>()
  /** Product inputs whose placement was announced; each placement starts its own reply once. */
  private readonly placed = new Set<string>()
  private readonly children = new Map<
    string,
    | { state: 'opening'; pending: Promise<DurableChildResource | undefined> }
    | { state: 'attached' | 'closing'; resource: DurableChildResource }
    | { state: 'releasing'; pending: Promise<void> }
  >()
  /** Origins and context ids of finished children whose native history was released. */
  /** Views held by callers follow a child across release and reopen without keeping it loaded. */
  private readonly childViews = new Map<string, WeakRef<{ projection: ChildThreadProjection }>>()
  private readonly releasedChildren = new Map<string, { id: string; origin: Subagent['origin']; contextId: string }>()
  private readonly childTasks = new PiChildTasks(
    (id) => this.childOrigin(id),
    (event) => this.events.push(event)
  )
  private readonly adapter = new PiMessageMetadata((name) => this.desktop?.mcp.metadata.get(name))
  private projection?: ThreadProjection

  constructor(
    private readonly input: AgentRuntimeConnectInput,
    private readonly acquire: () => Promise<{
      owner: DurableBackend
      root: DurableRoot
      release(flush: () => Promise<void>): Promise<void>
    }>
  ) {}

  async start(): Promise<this> {
    try {
      this.access = await this.acquire()
      const { owner, root } = this.access
      this.desktop = root.desktop
      this.context = root.context
      this.runtime = owner.runtime
      root.sink = {
        event: (event) => (event.type === 'error' ? this.fail(event.error) : this.events.push(event)),
        behavior: (event) => this.onBehavior(event),
        usage: (usage, sessionId, responseId) => {
          if (sessionId === this.providerSessionId) {
            if (responseId) this.events.push({ type: 'response-start', responseId })
            this.recordUsage(usage)
          }
        },
        placed: (inputId) => {
          if (inputId && this.steers.has(inputId)) this.input.onSteerInjected?.([inputId])
        }
      }
      const opened = await this.runtime.open({
        backendId: runtimeId(this.context.backendId),
        id: runtimeId(this.context.nativeThreadId!)
      })
      if (opened.status !== 'confirmed') throw new Error(opened.error.message)
      this.handle = opened.value
      this.context = contexts.bindContext(this.context.id, this.handle.thread.id)
      await saveDurableRequest(this.runtime, this.handle.thread.id, this.input)
      await this.handle.durable.configure(root.agent)
      this.providerSessionId = await this.handle.durable.providerSessionId()
      const observed = await this.handle.durable.observe((batch) => this.onObservation(batch))
      if (observed.status !== 'confirmed') throw new Error(observed.error.message)
      this.observation = observed.value
      await this.observation.drain()
      await this.childResources()
      this.events.push({ type: 'resume-token', token: this.handle.thread.id })
      root.attached()
      await owner.resume()
      return this
    } catch (error) {
      await this.close()
      throw error
    }
  }

  async predictPrompt(signal: AbortSignal): Promise<string> {
    if (!this.handle || this.closing) return ''
    return this.handle.durable.predictPrompt(PROMPT_SUGGESTION_INSTRUCTION, signal)
  }

  async send(input: AgentRuntimeCommand): Promise<void> {
    if (!this.handle || !this.context || this.closing) throw new Error('Durable runtime is unavailable')
    const text = buildAgentUserContent(input.message)
    const compact = !input.systemReminder && isCompactCommand(text)
    if (compact && this.sending) throw new Error('Durable cannot compact while native work is running')
    // Compaction is not an input run; the host holds input behind its compaction occupancy.
    if (this.compacting) throw new Error('Durable is compacting')
    // Input that arrives while native work runs waits in Durable's queue and joins the running turn.
    const running = this.sending
    this.sending = true
    // The host turn already owns input that starts new work; only a queued placement needs announcing.
    if (running) this.queued.add(input.message.id)
    else {
      this.placed.add(input.message.id)
      this.failure = undefined
      this.turnUsage.reset()
    }
    if (compact) {
      this.compacting = true
      this.events.push({ type: 'compaction-start', trigger: 'manual' })
      try {
        const compacted = await this.handle.durable.compact(text.trim().slice('/compact'.length).trim() || undefined)
        if (compacted.status !== 'confirmed') throw new Error(compacted.error.message)
        if (!this.closing && !compacted.value.compacted) this.projection?.notice(t('common.agent_compaction_unchanged'))
        if (!this.closing)
          this.events.push({
            type: 'compaction-complete',
            ...(compacted.value.compacted && {
              anchor: {
                status: 'done',
                phase: 'agent-session',
                trigger: 'manual',
                completedAt: new Date().toISOString()
              }
            })
          })
      } catch (error) {
        this.failure = error
      } finally {
        this.compacting = false
      }
      this.finishTurn()
      return
    }
    try {
      await this.submit(input, input.systemReminder ? wrapSteerReminder(text) : text, 'follow-up')
    } catch (error) {
      if (!running) this.sending = false
      throw error
    }
  }

  lookupInput(contextId: string, inputId: string) {
    return lookupNativeInput(this.runtime!, this.input.sessionId, contextId, inputId)
  }

  redirect(input: AgentRuntimeCommand): boolean {
    if (!this.active || this.closing) return false
    this.steers.add(input.message.id)
    void this.submit(input, wrapSteerReminder(buildAgentUserContent(input.message)), 'steer').catch((error) =>
      this.fail(error)
    )
    return true
  }

  followUp(input: AgentRuntimeCommand): boolean {
    const text = buildAgentUserContent(input.message)
    // `/compact` is a host command; it waits in the host queue and runs as compaction.
    if (!this.sending || this.closing || this.compacting || isCompactCommand(text)) return false
    this.queued.add(input.message.id)
    void this.submit(input, wrapSteerReminder(text), 'follow-up').catch((error) => {
      logger.warn('Durable follow-up submission failed', { sessionId: this.input.sessionId, error })
      if (error instanceof SubmissionRefused) return
      // It never reached Durable's queue, so the host queues it instead.
      this.queued.delete(input.message.id)
      this.events.push({ type: 'steer-undelivered', inputIds: [input.message.id] })
    })
    return true
  }

  private async submit(input: AgentRuntimeCommand, text: string, whenBusy: 'follow-up' | 'steer') {
    const draft = prepareNativeSubmission(this.input.sessionId, input.message.id, this.context!.id, whenBusy, {
      text,
      parts: input.message.data.parts
    })
    this.input.onInputPrepared?.(input.message.id, this.context!.id)
    const submitted = this.handle!.input.submit(draft)
    this.admission = submitted.catch(() => undefined)
    const result = await submitted
    this.events.push({ type: 'input-submission', contextId: this.context!.id, result })
    if (result.status !== 'acknowledged') {
      applyNativeSubmissionResult(this.input.sessionId, this.context!.id, result)
      throw new SubmissionRefused(result.error.message)
    }
    this.captureInput(result)
  }

  async getContextUsage() {
    return this.handle
      ? this.handle.contextUsage()
      : {
          status: 'unknown' as const,
          error: { operation: 'contextUsage', code: 'not-connected', message: 'Runtime not connected' }
        }
  }

  private async onObservation(batch: DurableObservation): Promise<void> {
    const placements: string[] = []
    try {
      for (const event of batch.events) {
        if (event.type === 'context.changed') this.events.push({ type: 'context-usage', result: event.result })
        if (event.type === 'snapshot' && event.contextUsage)
          this.events.push({ type: 'context-usage', result: event.contextUsage })
        if (event.type === 'snapshot') {
          const nowActive = event.activity.state === 'active'
          if (nowActive && !this.sending && !this.closing) {
            // After reopen, Durable resumes a placed input that has no outcome yet; the started event names it.
            const pending = event.inputs.findLast((input) => !input.outcome && input.facts.includes('placed'))
            const recoveredInputId = pending && bindNativeInput(this.input.sessionId, this.context!.id, pending)
            if (recoveredInputId) this.placed.add(recoveredInputId)
            this.beginAutonomous(
              batch.backgroundResults.status === 'confirmed' ? batch.backgroundResults.value.notification : undefined,
              recoveredInputId
            )
          }
          for (const input of event.inputs) this.captureInput(input, placements)
          this.active = nowActive
          for (const relation of event.subagents ?? [])
            if (relation.child && !this.releasedChildren.has(this.childKey(relation.child.id)))
              this.attachChild(relation.child.id)
        } else if (event.type === 'activity.changed') this.active = event.activity.state === 'active'
        else if (event.type === 'input.changed') this.captureInput(event.input, placements)
        else if (event.type === 'subagent.upsert' && event.subagent.child) this.attachChild(event.subagent.child.id)
        // Durable follows each gap with a recovery snapshot; neither a gap nor a diagnostic ends native work.
        else if (event.type === 'diagnostic' || (event.type === 'gap' && event.reason === 'disconnected'))
          logger.warn('Durable observation fault', { sessionId: this.input.sessionId, event })
        else if (event.type === 'closed' && event.reason !== 'shutdown' && !this.closing)
          throw new Error(`Durable observation ended: ${event.reason}`)
      }
      this.projection ??= new ThreadProjection(
        this.handle!.thread,
        this.context!.id,
        (projection) => this.events.push({ type: 'message-projection', projection }),
        (message) => this.adapter.decorate(message)
      )
      await this.projection.accept(batch)
      // The answer before a placed input arrives in the same batch, so the boundary follows its projection.
      if (placements.length) this.events.push({ type: 'steer-boundary', inputIds: placements, followUp: true })
      const results = batch.backgroundResults
      this.events.push({
        type: 'background-results',
        result: results.status === 'confirmed' ? { status: 'confirmed', value: results.value.pending } : results
      })
      this.events.push({
        type: 'background-work-state',
        active: results.status !== 'confirmed' || results.value.active
      })
      if (batch.completion && !this.compacting && !this.closing && this.sending) {
        const { inputs } = batch.completion
        const failed = inputs.map(nativeOutcomeTerminal).find((terminal) => terminal?.status === 'error')
        if (failed?.status === 'error') this.failure ??= failed.error
        const aborted = inputs.some((input) => input.outcome === 'aborted')
        this.finishTurn(aborted ? undefined : batch.completion.entryId, aborted)
      }
    } catch (error) {
      this.fail(error)
    }
  }

  private beginAutonomous(sourceToolCallIds?: readonly string[], recoveredInputId?: string) {
    this.sending = true
    this.autonomous = true
    this.failure = undefined
    this.turnUsage.reset()
    this.events.push({
      type: 'autonomous-turn-state',
      state: 'started',
      origin: this.nextOrigin,
      sourceToolCallIds,
      recoveredInputId
    })
    this.nextOrigin = { kind: 'background-work' }
  }

  private captureInput(input: InputState, placements?: string[]) {
    // Snapshots repeat every input; only a changed one is reported and bound again.
    const key = input.nativeInput?.id ?? input.inputId
    if (key !== undefined && isDeepStrictEqual(this.captured.get(key), input)) return
    if (key !== undefined) this.captured.set(key, input)
    this.events.push({ type: 'input-state', contextId: this.context!.id, input })
    const messageId = bindNativeInput(this.input.sessionId, this.context!.id, input)
    if (!messageId) return
    if (input.facts.includes('placed')) this.announcePlacement(messageId, input, placements)
    // Durable never places an input again once it has an outcome.
    if (input.outcome) {
      this.queued.delete(messageId)
      this.placed.delete(messageId)
    }
  }

  private announcePlacement(messageId: string, input: InputState, placements?: string[]) {
    if (this.steers.delete(messageId)) {
      this.placed.add(messageId)
      this.events.push({ type: 'steer-boundary', inputIds: [messageId] })
      return
    }
    if (!placements || this.placed.has(messageId)) return
    // Without the outcome check, reopening would announce every historical input.
    if (!this.queued.delete(messageId) && input.outcome) return
    this.placed.add(messageId)
    placements.push(messageId)
  }

  private finishTurn(entryId?: string, aborted = false) {
    if (this.closing || !this.sending) return
    this.sending = false
    this.events.push(
      this.failure
        ? { type: 'error', error: this.failure }
        : {
            type: 'turn-complete',
            ...(aborted && { status: 'paused' as const }),
            ...(entryId && {
              forkAnchor: {
                checkpoint: {
                  runtime: 'pi-durable',
                  backendId: this.context!.backendId,
                  conversationId: this.handle!.thread.id,
                  entryId
                }
              }
            })
          }
    )
    if (this.autonomous) {
      this.autonomous = false
      this.events.push({ type: 'autonomous-turn-state', state: 'finished' })
    }
    this.runEnded?.resolve()
    this.runEnded = undefined
  }

  private onBehavior(event: BehaviorEvent) {
    if (event.type === 'subagents') {
      this.childTasks.showSubagents(event.views, !this.handle || event.thread === this.handle.thread.id)
    } else if (!this.handle || event.thread === this.handle.thread.id) {
      if (event.type === 'goal-round') this.nextOrigin = { kind: 'goal-round', round: event.round.round }
      if (event.type === 'goal-notice') {
        this.projection?.notice(event.notice.text)
      }
    }
  }

  /** A failed child attachment is retried by the next snapshot that lists the child. */
  private attachChild(id: string) {
    void this.observeChild(id).catch((error) => logger.warn('Failed to observe Durable child', { id, error }))
  }

  private childKey(id: string): string {
    return JSON.stringify([this.context!.backendId, id])
  }

  private childOrigin(id: string) {
    const key = this.childKey(id)
    const child = this.children.get(key)
    return child && 'resource' in child ? child.resource.relation.origin : this.releasedChildren.get(key)?.origin
  }

  /** Releases a finished, unwatched child so its history stops occupying memory; it reopens on demand. */
  private releaseFinishedChild(key: string): void {
    const child = this.children.get(key)
    if (this.closing || child?.state !== 'attached') return
    const { resource } = child
    if (!resource.finished || resource.pins > 0) return
    const pending = (async () => {
      try {
        await resource.projection.stop()
        await resource.handle.release()
        this.releasedChildren.set(key, {
          id: resource.relation.child!.id,
          origin: resource.relation.origin,
          contextId: resource.projection.context.id
        })
        this.children.delete(key)
      } catch (error) {
        // Keep the unflushed child for the close and reopen retries.
        this.children.set(key, { state: 'closing', resource })
        logger.error('Failed to release finished Durable child', { key, error })
      }
    })()
    this.children.set(key, { state: 'releasing', pending })
  }

  private pinChild(resource: DurableChildResource): () => void {
    resource.pins++
    let pinned = true
    return () => {
      if (!pinned) return
      pinned = false
      resource.pins--
      this.releaseFinishedChild(this.childKey(resource.relation.child!.id))
    }
  }

  private async childResource(id: string): Promise<DurableChildResource | undefined> {
    const child = this.children.get(this.childKey(id))
    if (child?.state === 'releasing') return undefined
    return child?.state === 'opening' ? child.pending : child?.resource
  }

  private async childResources(): Promise<DurableChildResource[]> {
    const resources: DurableChildResource[] = []
    for (const child of this.children.values()) {
      if (child.state === 'releasing') continue
      const resource = child.state === 'opening' ? await child.pending : child.resource
      if (resource) resources.push(resource)
    }
    return resources
  }

  private async observeChild(id: string, granted?: PiDurableThreadHandle): Promise<DurableChildResource | undefined> {
    const key = this.childKey(id)
    const existing = this.children.get(key)
    if (existing) {
      await granted?.release()
      if (existing.state === 'releasing') {
        await existing.pending
        return this.observeChild(id)
      }
      if (existing.state === 'closing') {
        await existing.resource.projection.stop()
        await existing.resource.handle.release()
        this.children.delete(key)
        return this.observeChild(id)
      }
      return existing.state === 'opening' ? existing.pending : existing.resource
    }
    if (!this.runtime) {
      await granted?.release()
      return undefined
    }
    let handle: PiDurableThreadHandle | undefined
    let resource: DurableChildResource | undefined
    const pending = Promise.resolve()
      .then(async () => {
        if (granted) handle = granted
        else {
          const opened = await this.runtime!.open({ backendId: runtimeId(this.context!.backendId), id: runtimeId(id) })
          if (opened.status !== 'confirmed') throw new Error(opened.error.message)
          handle = opened.value
        }
        const relation = await handle.durable.relation()
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
            observe: (sink) => {
              let inputs: readonly InputState[] = []
              return access.observe(async (event) => {
                try {
                  await sink(event)
                  if (event.type === 'subagent.upsert' && event.subagent.child)
                    void this.observeChild(event.subagent.child.id)
                  if (event.type === 'snapshot') {
                    inputs = event.inputs
                    for (const child of event.subagents ?? [])
                      if (child.child && !this.releasedChildren.has(this.childKey(child.child.id)))
                        void this.observeChild(child.child.id)
                  } else if (event.type === 'input.changed') inputs = withInput(inputs, event.input)
                  // Run state and input outcomes change only with these events; streamed content does not.
                  if (
                    event.type === 'snapshot' ||
                    event.type === 'activity.changed' ||
                    event.type === 'input.changed'
                  ) {
                    if (this.closing) return
                    const facts = await access.durable.facts()
                    this.childTasks.publish(
                      id,
                      facts.live.idle
                        ? facts.live.runEnd?.outcome === 'completed'
                          ? 'completed'
                          : facts.live.runEnd?.outcome === 'aborted'
                            ? 'stopped'
                            : 'error'
                        : 'in_progress'
                    )
                    if (resource) {
                      // An input without an outcome means more work is coming even while the run is idle.
                      resource.finished =
                        facts.live.idle && facts.live.runEnd !== undefined && inputs.every((input) => input.outcome)
                      this.releaseFinishedChild(key)
                    }
                  }
                } catch (error) {
                  // Rethrowing would reach the backend error hook and close every root on it.
                  logger.warn('Durable child observation failed; resynchronizing', { id, error })
                  if (!this.closing)
                    void projection
                      .attach()
                      .catch((cause) => logger.warn('Durable child resync failed', { id, error: cause }))
                }
              })
            }
          },
          async () => {
            const archive = await access.archive()
            if (archive.status !== 'confirmed') throw new Error(archive.error.message)
            return archive.value
          },
          (message) => this.adapter.decorate(message),
          (responseId, messageId) => this.events.push({ type: 'response-start', responseId, messageId })
        )
        resource = { relation, handle: access, projection, pins: 0, finished: false }
        const view = this.childViews.get(key)?.deref()
        if (view) view.projection = projection
        await projection.attach()
        this.releasedChildren.delete(key)
        this.children.set(key, { state: 'attached', resource })
        // Callers pin in their continuation; check afterwards so a reopened finished child is not released under them.
        setImmediate(() => this.releaseFinishedChild(key))
        this.childTasks.publish(id, this.childTasks.status(id) ?? 'in_progress')
        return resource
      })
      .catch(async (error) => {
        logger.error('Failed to observe Durable child', { id, error })
        if (resource) {
          try {
            await resource.projection.stop()
          } catch (flushError) {
            this.children.set(key, { state: 'closing', resource })
            logger.error('Failed to flush Durable child attachment', { id, error: flushError })
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
    if (known[0]) return this.watchChild(known[0])
    if (this.closing || !this.handle) return undefined
    const opened = await this.handle.durable.openChild(toolCallId, this.closingAccess.signal)
    if (opened.status !== 'confirmed') return undefined
    const child = await this.observeChild(opened.value.relation.child.id, opened.value.handle)
    return child && this.watchChild(child)
  }

  /** A subscribed viewer pins the child; the last unsubscribe lets a finished child release. */
  private async watchChild(child: DurableChildResource) {
    const unpin = this.pinChild(child)
    try {
      await child.projection.attach()
    } finally {
      // Callers subscribe in their continuation; keep a finished child loaded until then.
      setImmediate(unpin)
    }
    const key = this.childKey(child.relation.child!.id)
    let view = this.childViews.get(key)?.deref()
    if (!view) this.childViews.set(key, new WeakRef((view = { projection: child.projection })))
    const current = view
    return {
      snapshot: () => current.projection.snapshot(),
      subscribe: (listener: Parameters<ChildThreadProjection['subscribe']>[0]) => {
        const unpin = this.pinChild(child)
        const unsubscribe = child.projection.subscribe(listener)
        return () => {
          unsubscribe()
          unpin()
        }
      }
    }
  }

  async messageChild(contextId: string, text: string): Promise<void> {
    for (const child of [...this.children.values()]) if (child.state === 'releasing') await child.pending
    const released = [...this.releasedChildren.values()].find((child) => child.contextId === contextId)
    const child =
      (await this.childResources()).find((child) => child.projection.context.id === contextId) ??
      (released && (await this.observeChild(released.id)))
    const projection = child?.projection
    const handle = child?.handle
    if (!child || !handle || !projection || this.closing) throw new Error('Child native owner is unavailable')
    const unpin = this.pinChild(child)
    try {
      await this.submitChild(projection, handle, contextId, text)
    } finally {
      // The next run or input change decides again; a status read before this input must not release the child.
      child.finished = false
      unpin()
    }
  }

  private async submitChild(
    projection: ChildThreadProjection,
    handle: PiDurableThreadHandle,
    contextId: string,
    text: string
  ): Promise<void> {
    await projection.flush()
    const { sessionId } = projection.context
    const id = randomUUID()
    messages.saveMessage({ sessionId, message: { id, role: 'user', data: { parts: [{ type: 'text', text }] } } })
    const draft = prepareNativeSubmission(sessionId, id, contextId, 'steer')
    await projection.refresh()
    const result = await handle.input.submit(draft)
    applyNativeSubmissionResult(sessionId, contextId, result)
    await projection.refresh()
    if (result.status !== 'acknowledged') throw new Error(result.error.message)
  }

  async stopTask(taskId: string): Promise<boolean> {
    const child = (await this.childResource(taskId))?.handle
    if (!child?.interrupt) return false
    const result = await child.interrupt()
    if (result.status !== 'confirmed') throw new Error(result.error.message)
    return true
  }

  async interrupt(): Promise<void> {
    // The stop must name the turn of a submission that is still being admitted.
    await this.admission
    const ended = this.sending ? (this.runEnded ??= Promise.withResolvers<void>()).promise : undefined
    const requested = this.requestStop()
    void Promise.all([requested, ended]).then(
      () => this.events.push({ type: 'stop-confirmed' }),
      () => {}
    )
    await requested
  }

  private async requestStop(): Promise<void> {
    const result = await this.handle?.interrupt?.()
    if (result && result.status !== 'confirmed') throw new Error(result.error.message)
    // Native user stop leaves background children running; product Stop ends them too.
    for (const id of this.childTasks.running()) await this.stopTask(id)
  }

  refreshTraceContext(context: AgentRuntimeTraceContext) {
    this.input.trace = context
  }

  reconcile(input: Parameters<AgentRuntimeConnection['reconcile']>[0]): Promise<AgentRuntimeReconcileResult> {
    const work = this.reconcileChain.then(async (): Promise<AgentRuntimeReconcileResult> => {
      try {
        const next = await this.desktop!.reconcile({ ...this.input, ...input }, this.active)
        if (next.permissionChanged) await this.handle!.durable.permissionModeChanged()
        if (
          this.failure ||
          next.signature !== this.desktop!.snapshot.signature ||
          input.reasoningEffort !== this.input.reasoningEffort ||
          input.serviceTier !== this.input.serviceTier ||
          Boolean(input.fastMode) !== Boolean(this.input.fastMode)
        )
          return 'rebuild'
        return next.permissionChanged ? 'patched' : 'current'
      } catch (error) {
        if (error instanceof PiInvalidConnectionSnapshotError) return 'invalid'
        throw error
      }
    })
    this.reconcileChain = work.catch(() => undefined)
    return work
  }

  private recordUsage(usage: Usage) {
    this.events.push({
      type: 'chunk',
      chunk: { type: 'message-metadata', messageMetadata: this.turnUsage.record(usage) }
    })
  }

  private fail(error: unknown) {
    this.failure = error
    this.events.push({ type: 'error', error })
    void this.close().catch((cause) => logger.error('Durable shutdown failed', { error: cause }))
  }

  async drainChildWrites(): Promise<void> {
    await this.runtime?.settled()
    await this.observation?.drain()
    if (this.closing) {
      await this.closePromise
      return
    }
    for (const child of await this.childResources()) await child.projection.drain()
  }

  close(): Promise<void> {
    this.closing = true
    this.closingAccess.abort()
    return (this.closePromise ??= this.finishClose().catch((error) => {
      this.closePromise = undefined
      throw error
    }))
  }

  private async finishClose() {
    if (!this.access) {
      this.events.close()
      return
    }
    await this.access.release(async () => {
      toolApprovalRegistry.abort(this.input.sessionId, 'durable-access-closed')
      await this.observation?.drain()
      for (const [key, entry] of this.children) {
        if (entry.state === 'releasing') await entry.pending
        // A release whose flush failed leaves the child closing for this loop to retry.
        const child = this.children.get(key)
        if (!child || child.state === 'releasing') continue
        const resource = child.state === 'opening' ? await child.pending : child.resource
        if (!resource) continue
        this.children.set(key, { state: 'closing', resource })
        await resource.projection.stop()
        await resource.handle.release()
        this.children.delete(key)
      }
      await this.observation?.stop()
      this.observation = undefined
      await this.projection?.close()
      this.projection = undefined
      await this.handle?.release()
      this.handle = undefined
      this.access!.root.sink = undefined
    })
    this.access = undefined
    this.runtime = undefined
    this.desktop = undefined
    this.events.close()
  }
}
