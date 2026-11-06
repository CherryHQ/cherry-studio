import { randomUUID } from 'node:crypto'

import type { Usage } from '@earendil-works/pi-ai'

import type { BehaviorEvent, CallRef } from '@cherrystudio/agent-behavior'
import { runtimeId, type InputState, type Observation, type Subagent } from '@cherrystudio/agent-runtime'
import type {
  DurableObservation,
  PiDurableRuntime,
  PiDurableThreadHandle
} from '@cherrystudio/agent-runtime-pi-durable'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { ChildThreadProjection } from '@main/ai/agentSession/ChildThreadProjection'
import { prepareDurableRoot } from '@main/ai/agentSession/durableNativeContext'
import {
  prepareNativeSubmission,
  lookupNativeInput,
  bindNativeInput,
  applyNativeSubmissionResult
} from '@main/ai/agentSession/nativeSubmission'
import { ThreadProjection } from '@main/ai/agentSession/ThreadProjection'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { t } from '@main/i18n'
import type { AutonomousTurnOrigin } from '@shared/ai/agentSessionTurnOrigin'
import type { AgentTaskEventPartData } from '@shared/data/types/uiParts'
import { AsyncEventQueue } from '@shared/utils/async'

import { buildAgentUserContent } from '../agentUserContent'
import { createPiGatewayModelBinding } from '../pi/gatewayModelBinding'
import { createPiBehaviorHost } from '../pi/piBehaviorHost'
import { PiInvalidConnectionSnapshotError } from '../pi/piConnectionSignature'
import { PiMessageMetadata } from '../pi/PiMessageMetadata'
import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeReconcileResult,
  AgentRuntimeTraceContext,
  AgentRuntimeCommand
} from '../types'
import { prepareDurableBranch } from './durableContext'
import { prepareDurableDesktop } from './durableDesktop'

const logger = loggerService.withContext('PiDurableRuntimeConnection')

/** One desktop owner for a Durable SQLite backend and all its child conversations. */
type DurableChildResource = {
  relation: Subagent
  handle: PiDurableThreadHandle
  projection: ChildThreadProjection
}

export class PiDurableRuntimeConnection implements AgentRuntimeConnection {
  get contextId(): string | undefined {
    return this.context?.id
  }

  readonly retainWhileIdle = true
  readonly usageCapture = { owner: 'provider-calls' as const }
  readonly events = new AsyncEventQueue<AgentRuntimeEvent>()
  private runtime?: PiDurableRuntime
  private handle?: PiDurableThreadHandle
  private observation?: Observation
  private context?: ReturnType<typeof prepareDurableBranch>
  private desktop?: Awaited<ReturnType<typeof prepareDurableDesktop>>
  private closing = false
  private readonly closingAccess = new AbortController()
  private closePromise?: Promise<void>
  private active = false
  private sending = false
  private compacting = false
  private autonomous = false
  private failure?: unknown
  private nextOrigin: AutonomousTurnOrigin = { kind: 'background-work' }
  private providerSessionId?: string
  private usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  private reconcileChain: Promise<unknown> = Promise.resolve()
  private readonly steers = new Set<string>()
  private readonly children = new Map<
    string,
    | { state: 'opening'; pending: Promise<DurableChildResource | undefined> }
    | { state: 'attached' | 'closing'; resource: DurableChildResource }
  >()
  private readonly childStates = new Map<string, AgentTaskEventPartData>()
  private readonly adapter = new PiMessageMetadata((name) => this.desktop?.mcp.metadata.get(name))
  private projection?: ThreadProjection

  constructor(private readonly input: AgentRuntimeConnectInput) {}

  async start(): Promise<this> {
    try {
      this.desktop = await prepareDurableDesktop(this.input, (event) => this.events.push(event))
      const desktop = this.desktop
      this.context = prepareDurableBranch(this.input.sessionId, this.input.branchHead)
      const binding = await createPiGatewayModelBinding(
        this.input,
        desktop.snapshot.provider,
        desktop.snapshot.model,
        (usage, sessionId, responseId) => {
          if (sessionId === this.providerSessionId) {
            if (responseId) this.events.push({ type: 'response-start', responseId })
            this.recordUsage(usage)
          }
        }
      )
      const behaviorRoot = runtimeId<'thread'>(this.context.nativeThreadId ?? '0')
      const behavior = await createPiBehaviorHost({
        input: this.input,
        root: behaviorRoot,
        binding,
        model: desktop.snapshot.model,
        approval: desktop.approval,
        bindModel: (model) =>
          createPiGatewayModelBinding(
            this.input,
            providerService.getByProviderId(model.providerId),
            model,
            undefined,
            binding.modelRuntime
          ),
        emit: (event) => this.events.push(event),
        observe: (event) => this.onBehavior(event),
        usageSessionId: async (thread) => {
          if (thread === this.handle?.thread.id || thread === behaviorRoot) return this.input.sessionId
          const child = await this.observeChild(thread)
          if (!child) throw new Error('Native child usage context is unavailable')
          return child.projection.context.sessionId
        },
        toolCallId: (call) => this.behaviorToolCallId(call)
      })
      const root = await prepareDurableRoot(this.context.id)
      const { createPiDurableRuntime } = await import('@cherrystudio/agent-runtime-pi-durable')
      const created = await createPiDurableRuntime({
        backendId: runtimeId(this.context.backendId),
        openStorage: async () => root.storage,
        harness: { models: binding.modelRuntime, registry: desktop.registry, env: () => desktop.environment },
        behavior: {
          host: behavior.host,
          configureChild: async (child) => {
            const configured = await behavior.configureChild(child)
            return { model: { provider: configured.model.provider, modelId: configured.model.id } }
          }
        },
        onInputPlaced: (state) => {
          const steer = state.inputId && this.steers.has(state.inputId) ? state.inputId : undefined
          if (steer) this.input.onSteerInjected?.([steer])
        },
        onError: (error) => {
          logger.error('Durable native operation failed', { error })
          this.failure ??= error
        }
      })
      if (created.status !== 'confirmed') throw new Error(created.error.message)
      this.runtime = created.value
      const agent = { ...desktop.agentConfig, model: { provider: binding.model.provider, modelId: binding.model.id } }
      const opened = root.nativeId
        ? await this.runtime.open({ backendId: runtimeId(this.context.backendId), id: runtimeId(root.nativeId) })
        : await this.runtime.create({ ownership: { kind: 'ownerless' }, agent, init: root.init })
      if (opened.status !== 'confirmed') throw new Error(opened.error.message)
      this.handle = opened.value
      this.context = contexts.bindContext(this.context.id, this.handle.thread.id)
      await this.handle.durable.configure(agent)
      this.providerSessionId = await this.handle.durable.providerSessionId()
      const observed = await this.handle.durable.observe((batch) => this.onObservation(batch))
      if (observed.status !== 'confirmed') throw new Error(observed.error.message)
      this.observation = observed.value
      await this.observation.drain()
      await this.childResources()
      this.events.push({ type: 'resume-token', token: this.handle.thread.id })
      const resumed = await this.runtime.resume()
      if (resumed.status !== 'confirmed') throw new Error(resumed.error.message)
      return this
    } catch (error) {
      await this.close()
      throw error
    }
  }

  async send(input: AgentRuntimeCommand): Promise<void> {
    if (!this.handle || !this.context || this.closing) throw new Error('Durable runtime is unavailable')
    if (this.sending) throw new Error('Durable already has an active submission')
    this.sending = true
    this.failure = undefined
    this.usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    const text = buildAgentUserContent(input.message)
    if (!input.systemReminder && /^\/compact(?:\s|$)/.test(text.trim())) {
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
      await this.submit(input, input.systemReminder ? wrapSteerReminder(text) : text, 'reject')
    } catch (error) {
      this.sending = false
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

  private async submit(input: AgentRuntimeCommand, text: string, whenBusy: 'reject' | 'steer') {
    const draft = prepareNativeSubmission(this.input.sessionId, input.message.id, this.context!.id, whenBusy, {
      text,
      parts: input.message.data.parts
    })
    this.input.onInputPrepared?.(input.message.id, this.context!.id)
    const result = await this.handle!.input.submit(draft)
    this.events.push({ type: 'input-submission', contextId: this.context!.id, result })
    if (result.status !== 'acknowledged') {
      applyNativeSubmissionResult(this.input.sessionId, this.context!.id, result)
      throw new Error(result.error.message)
    }
    this.captureInput(result)
  }

  private async onObservation(batch: DurableObservation): Promise<void> {
    try {
      for (const event of batch.events) {
        if (event.type === 'snapshot') {
          const nowActive = event.activity.state === 'active'
          if (nowActive && !this.sending && !this.closing) this.beginAutonomous()
          for (const input of event.inputs) this.captureInput(input)
          this.active = nowActive
          for (const relation of event.subagents ?? [])
            if (relation.child) void this.observeChild(relation.child.id).catch((error) => this.fail(error))
        } else if (event.type === 'input.changed') this.captureInput(event.input)
        else if (event.type === 'subagent.upsert' && event.subagent.child)
          void this.observeChild(event.subagent.child.id).catch((error) => this.fail(error))
        else if (
          event.type === 'diagnostic' ||
          (event.type === 'gap' && !['overflow', 'mapping-reset'].includes(event.reason))
        )
          throw new Error(event.type === 'gap' ? `Durable observation gap: ${event.reason}` : event.error.message)
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
      if (batch.completion && !this.compacting && !this.closing && this.sending) {
        const failed = batch.completion.inputs.find((input) => input.outcome && input.outcome !== 'completed')
        if (failed) this.failure ??= new Error(failed.error?.message ?? failed.outcome)
        this.finishTurn()
      }
    } catch (error) {
      this.fail(error)
    }
  }

  private beginAutonomous() {
    this.sending = true
    this.autonomous = true
    this.failure = undefined
    this.usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    this.events.push({ type: 'autonomous-turn-state', state: 'started', origin: this.nextOrigin })
    this.nextOrigin = { kind: 'background-work' }
  }

  private captureInput(input: InputState) {
    this.events.push({ type: 'input-state', contextId: this.context!.id, input })
    const messageId = bindNativeInput(this.input.sessionId, this.context!.id, input)
    if (messageId && input.facts.includes('placed')) {
      const steer = this.steers.has(messageId) ? messageId : undefined
      if (steer) {
        this.steers.delete(messageId)
        this.events.push({ type: 'steer-boundary', inputIds: [steer] })
      }
    }
  }

  private finishTurn() {
    if (this.closing || !this.sending) return
    this.sending = false
    this.events.push(this.failure ? { type: 'error', error: this.failure } : { type: 'turn-complete' })
    if (this.autonomous) {
      this.autonomous = false
      this.events.push({ type: 'autonomous-turn-state', state: 'finished' })
    }
  }

  private onBehavior(event: BehaviorEvent) {
    if (event.type === 'subagents') {
      for (const view of event.views)
        this.publishChild(
          view.sessionId,
          view.status === 'finished'
            ? view.outcome === 'completed'
              ? 'completed'
              : view.outcome === 'stopped' || view.outcome === 'aborted'
                ? 'stopped'
                : 'error'
            : 'in_progress',
          true
        )
      if (!this.handle || event.thread === this.handle.thread.id) {
        const running = event.views.filter((view) => view.status !== 'finished')
        this.events.push({
          type: 'background-tasks',
          tasks: running.map((view) => ({
            id: view.sessionId,
            type: 'subagent',
            description: view.description,
            toolCallId: this.childOrigin(view.sessionId)?.toolCallId
          }))
        })
        this.events.push({ type: 'background-work-state', active: running.length > 0, awaitingReply: false })
      }
    } else if (!this.handle || event.thread === this.handle.thread.id) {
      if (event.type === 'goal-round') this.nextOrigin = { kind: 'goal-round', round: event.round.round }
      if (event.type === 'goal-notice') {
        this.projection?.notice(event.notice.text)
      }
    }
  }

  private publishChild(id: string, status: AgentTaskEventPartData['status'], background: boolean) {
    const origin = this.childOrigin(id)
    const previous = this.childStates.get(id)
    if (
      previous &&
      previous.status === status &&
      previous.isBackgrounded === background &&
      previous.toolUseId === origin?.toolCallId
    )
      return
    const data: AgentTaskEventPartData = {
      event: !previous ? 'started' : status === 'in_progress' ? 'updated' : 'notification',
      taskId: id,
      toolUseId: origin?.toolCallId,
      taskType: 'subagent',
      title: origin?.description ?? previous?.title,
      status,
      isBackgrounded: background
    }
    this.childStates.set(id, data)
    this.events.push({ type: 'background-task-event', data })
  }

  private childKey(id: string): string {
    return JSON.stringify([this.context!.backendId, id])
  }

  private childOrigin(id: string) {
    const child = this.children.get(this.childKey(id))
    return child && child.state !== 'opening' ? child.resource.relation.origin : undefined
  }

  private async childResource(id: string): Promise<DurableChildResource | undefined> {
    const child = this.children.get(this.childKey(id))
    return child?.state === 'opening' ? child.pending : child?.resource
  }

  private async childResources(): Promise<DurableChildResource[]> {
    const resources: DurableChildResource[] = []
    for (const child of this.children.values()) {
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
            observe: (sink) =>
              access.observe(async (event) => {
                await sink(event)
                if (event.type === 'subagent.upsert' && event.subagent.child)
                  void this.observeChild(event.subagent.child.id)
                if (event.type === 'snapshot') {
                  for (const child of event.subagents ?? []) if (child.child) void this.observeChild(child.child.id)
                  if (this.closing) return
                  const facts = await access.durable.facts()
                  this.publishChild(
                    id,
                    facts.live.idle
                      ? facts.live.runEnd?.outcome === 'completed'
                        ? 'completed'
                        : facts.live.runEnd?.outcome === 'aborted'
                          ? 'stopped'
                          : 'error'
                      : 'in_progress',
                    this.childStates.get(id)?.isBackgrounded ?? false
                  )
                }
              })
          },
          async () => {
            const archive = await access.archive()
            if (archive.status !== 'confirmed') throw new Error(archive.error.message)
            return archive.value
          },
          (message) => this.adapter.decorate(message),
          (responseId, messageId) =>
            this.events.push({ type: 'response-start', responseId, messageId, sessionId: context.sessionId })
        )
        resource = { relation, handle: access, projection }
        await projection.attach()
        this.children.set(key, { state: 'attached', resource })
        const previous = this.childStates.get(id)
        this.publishChild(id, previous?.status ?? 'in_progress', previous?.isBackgrounded ?? false)
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

  private async behaviorToolCallId(call: CallRef) {
    const opened = await this.runtime!.open({ backendId: runtimeId(this.context!.backendId), id: call.thread })
    if (opened.status !== 'confirmed') throw new Error(opened.error.message)
    try {
      const id = await opened.value.durable.behaviorToolCallId(call)
      if (!id) throw new Error('Durable behavior call has no native identity')
      return id
    } finally {
      await opened.value.release()
    }
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
    const opened = await this.handle.durable.openChild(toolCallId, this.closingAccess.signal)
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
    const result = await this.handle?.interrupt?.()
    if (result && result.status !== 'confirmed') throw new Error(result.error.message)
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
    this.usage.inputTokens += usage.input + usage.cacheRead + usage.cacheWrite
    this.usage.outputTokens += usage.output
    this.usage.totalTokens += usage.totalTokens
    this.events.push({
      type: 'chunk',
      chunk: {
        type: 'message-metadata',
        messageMetadata: { totalTokens: this.usage.totalTokens, stats: { ...this.usage } }
      }
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
    if (this.runtime) {
      await this.observation?.drain()
      await this.childResources()
      const result = await this.runtime.shutdown()
      if (result.status !== 'confirmed') throw new Error(result.error.message)
      this.runtime = undefined
    }
    toolApprovalRegistry.abort(this.input.sessionId, 'durable-owner-closed')
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
    this.observation = undefined
    await this.projection?.close()
    this.projection = undefined
    await this.handle?.release()
    this.handle = undefined
    await this.desktop?.close()
    this.desktop = undefined
    this.events.close()
  }
}
