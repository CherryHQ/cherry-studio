import { randomUUID } from 'node:crypto'

import type { Usage } from '@earendil-works/pi-ai'

import { application } from '@application'
import type { BehaviorEvent, CallRef, SubagentOrigin } from '@cherrystudio/agent-behavior'
import { runtimeId, type InputState, type Observation, type ObservationPayload } from '@cherrystudio/agent-runtime'
import type { PiDurableRuntime, PiDurableThreadHandle } from '@cherrystudio/agent-runtime-pi-durable'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { ChildThreadProjection } from '@main/ai/agentSession/ChildThreadProjection'
import { prepareDurableRoot } from '@main/ai/agentSession/durableNativeContext'
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
import { PiStreamAdapter } from '../pi/piStreamAdapter'
import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeReconcileResult,
  AgentRuntimeTraceContext,
  AgentRuntimeUserInput
} from '../types'
import { prepareDurableDesktop } from './durableDesktop'

const logger = loggerService.withContext('PiDurableRuntimeConnection')

/** One desktop owner for a Durable SQLite backend and all its child conversations. */
export class PiDurableRuntimeConnection implements AgentRuntimeConnection {
  readonly retainWhileIdle = true
  readonly usageCapture = { owner: 'provider-calls' as const }
  readonly events = new AsyncEventQueue<AgentRuntimeEvent>()
  private runtime?: PiDurableRuntime
  private handle?: PiDurableThreadHandle
  private observation?: Observation
  private context?: ReturnType<typeof contexts.prepareDurableBranch>
  private desktop?: Awaited<ReturnType<typeof prepareDurableDesktop>>
  private closing = false
  private closePromise?: Promise<void>
  private active = false
  private sending = false
  private compacting = false
  private baseline = false
  private autonomous = false
  private failure?: unknown
  private nextOrigin: AutonomousTurnOrigin = { kind: 'background-work' }
  private providerSessionId?: string
  private usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  private reconcileChain: Promise<unknown> = Promise.resolve()
  private readonly steers = new Map<string, AgentRuntimeUserInput>()
  private readonly pendingInputs = new Set<string>()
  private readonly reportedInputs = new Set<string>()
  private readonly childHandles = new Map<string, Promise<PiDurableThreadHandle>>()
  private readonly childProjections = new Map<string, ChildThreadProjection>()
  private readonly childOrigins = new Map<string, { parent: string; origin: SubagentOrigin; toolCallId?: string }>()
  private readonly childStates = new Map<string, AgentTaskEventPartData>()
  private readonly adapter = new PiStreamAdapter(
    { enqueue: (chunk) => this.events.push({ type: 'chunk', chunk }) },
    (name) => this.desktop?.mcp.metadata.get(name)
  )
  private readonly projection = new ThreadProjection(
    (chunk) => this.events.push({ type: 'chunk', chunk }),
    (part) => {
      this.adapter.handleToolStart(part.toolCallId, part.toolName, part.input)
      if (part.state === 'output-available')
        this.adapter.handleToolEnd(part.toolCallId, part.toolName, part.output, false, part.preliminary)
      else if (part.state === 'output-error')
        this.adapter.handleToolEnd(
          part.toolCallId,
          part.toolName,
          part.resultProviderMetadata?.pi?.result ?? part.errorText,
          true
        )
    }
  )

  constructor(private readonly input: AgentRuntimeConnectInput) {}

  async start(): Promise<this> {
    try {
      this.desktop = await prepareDurableDesktop(this.input, (event) => this.events.push(event))
      const desktop = this.desktop
      this.context = contexts.prepareDurableBranch(this.input.sessionId, this.input.branchHead)
      const binding = await createPiGatewayModelBinding(
        this.input,
        desktop.snapshot.provider,
        desktop.snapshot.model,
        (usage, sessionId) => {
          if (sessionId === this.providerSessionId) this.recordUsage(usage)
        }
      )
      const behavior = await createPiBehaviorHost({
        input: this.input,
        root: runtimeId(this.context.nativeThreadId ?? '0'),
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
            this.childOrigins.set(child.thread.id, { parent: child.parent.id, origin: child.origin })
            return { model: { provider: configured.model.provider, modelId: configured.model.id } }
          }
        },
        onInputPlaced: (state) => {
          const steer = state.inputId && this.steers.get(state.inputId)
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
      const observed = await this.handle.observe((event) => this.onObservation(event))
      if (observed.status !== 'confirmed') throw new Error(observed.error.message)
      this.observation = observed.value
      for (const id of this.childOrigins.keys()) await this.observeChild(id)
      this.events.push({ type: 'resume-token', token: this.handle.thread.id })
      const resumed = await this.runtime.resume()
      if (resumed.status !== 'confirmed') throw new Error(resumed.error.message)
      return this
    } catch (error) {
      await this.close()
      throw error
    }
  }

  async send(input: AgentRuntimeUserInput): Promise<void> {
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
      await this.finishIfIdle()
      return
    }
    try {
      await this.submit(input, input.systemReminder ? wrapSteerReminder(text) : text, 'reject')
    } catch (error) {
      this.sending = false
      throw error
    }
  }

  redirect(input: AgentRuntimeUserInput): boolean {
    if (!this.active || this.closing) return false
    this.steers.set(input.message.id, input)
    void this.submit(input, wrapSteerReminder(buildAgentUserContent(input.message)), 'steer').catch((error) =>
      this.fail(error)
    )
    return true
  }

  private async submit(input: AgentRuntimeUserInput, text: string, whenBusy: 'reject' | 'steer') {
    const draft = messages.prepareSubmission(this.input.sessionId, input.message.id, this.context!.id, whenBusy, text)
    this.pendingInputs.add(input.message.id)
    const result = await this.handle!.input.submit(draft)
    if (result.status !== 'acknowledged') {
      this.pendingInputs.delete(input.message.id)
      this.captureInput({ ...result, facts: [], ...(result.status !== 'unknown' && { outcome: 'failed' }) })
      throw new Error(result.error.message)
    }
    this.captureInput(result)
    if (result.facts.includes('locally-handled')) this.pendingInputs.delete(input.message.id)
    await this.finishIfIdle()
  }

  private async onObservation(event: ObservationPayload): Promise<void> {
    if (this.closing) return
    try {
      if (event.type === 'snapshot') {
        const initial = !this.baseline
        const aliases = this.handle!.durable.aliases()
        const content = event.messages.map((message) => ({ ...message, id: aliases[message.id] ?? message.id }))
        const nowActive = event.activity.state === 'active'
        if (nowActive && !this.sending) this.beginAutonomous()
        if (!this.baseline) {
          this.projection.accept({
            ...event,
            messages: content.filter((message) => message.metadata?.completeness === 'complete')
          })
          this.baseline = true
        }
        for (const message of content) this.projection.accept({ type: 'message.upsert', message })
        this.active = nowActive
        for (const input of event.inputs) {
          if (initial && input.inputId && !input.outcome) this.pendingInputs.add(input.inputId)
          this.captureInput(input, !initial)
        }
        for (const relation of event.subagents ?? [])
          if (relation.child) void this.observeChild(relation.child.id).catch((error) => this.fail(error))
        await this.finishIfIdle()
      } else if (event.type === 'input.changed') {
        this.captureInput(event.input)
        await this.finishIfIdle()
      } else if (event.type === 'subagent.upsert' && event.subagent.child) {
        void this.observeChild(event.subagent.child.id).catch((error) => this.fail(error))
      } else if (event.type === 'gap' || event.type === 'diagnostic') {
        throw new Error(event.type === 'gap' ? `Durable observation gap: ${event.reason}` : event.error.message)
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

  private captureInput(input: InputState, publishResponse = true) {
    if (!input.inputId || !messages.hasSubmission(this.input.sessionId, input.inputId)) return
    application
      .get('DbService')
      .withWriteTx((tx) => messages.mergeSubmissionTx(tx, this.input.sessionId, input.inputId!, input))
    if (input.facts.includes('placed')) {
      const steer = this.steers.get(input.inputId)
      if (steer) {
        this.steers.delete(input.inputId)
        this.events.push({ type: 'steer-boundary', inputs: [steer] })
      }
    }
    if (input.response && !this.reportedInputs.has(input.inputId)) {
      this.reportedInputs.add(input.inputId)
      if (publishResponse) this.events.push({ type: 'input-response', input })
    }
    if (input.outcome) {
      const pending = this.pendingInputs.delete(input.inputId)
      if (pending && input.outcome !== 'completed') this.failure ??= new Error(input.error?.message ?? input.outcome)
    }
  }

  private async refreshInputs() {
    for (const id of this.pendingInputs) {
      const { submission, thread } = messages.readSubmission(this.input.sessionId, id)
      if (!submission.nativeInputId) continue
      const found = await this.handle!.lookupInput({
        by: 'native-ref',
        ref: { session: thread, id: runtimeId(submission.nativeInputId) }
      })
      if (found.status === 'confirmed' && found.value.found) this.captureInput(found.value.input)
    }
  }

  private async finishIfIdle() {
    if (!this.sending || this.active || this.compacting || this.closing || !this.handle) return
    await this.refreshInputs()
    if (this.pendingInputs.size || this.active || this.compacting || this.closing || !this.sending) return
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
            toolCallId: this.childOrigins.get(view.sessionId)?.toolCallId
          }))
        })
        this.events.push({ type: 'background-work-state', active: running.length > 0, awaitingReply: false })
      }
    } else if (!this.handle || event.thread === this.handle.thread.id) {
      if (event.type === 'goal-round') this.nextOrigin = { kind: 'goal-round', round: event.round.round }
      if (event.type === 'goal-notice') {
        const id = randomUUID()
        this.events.push({ type: 'chunk', chunk: { type: 'text-start', id } })
        this.events.push({ type: 'chunk', chunk: { type: 'text-delta', id, delta: event.notice.text } })
        this.events.push({ type: 'chunk', chunk: { type: 'text-end', id } })
      }
    }
  }

  private publishChild(id: string, status: AgentTaskEventPartData['status'], background: boolean) {
    const origin = this.childOrigins.get(id)
    if (!origin?.toolCallId) return
    const previous = this.childStates.get(id)
    if (previous && previous.status === status && previous.isBackgrounded === background) return
    const data: AgentTaskEventPartData = {
      event: !previous ? 'started' : status === 'in_progress' ? 'updated' : 'notification',
      taskId: id,
      toolUseId: origin.toolCallId,
      taskType: 'subagent',
      title: origin.origin.description,
      status,
      isBackgrounded: background
    }
    this.childStates.set(id, data)
    this.events.push({ type: 'background-task-event', data })
    this.events.push({
      type: 'background-flow-chunk',
      rootToolCallId: origin.toolCallId,
      chunk: { type: 'data-agent-task-event', id: `task-${id}`, data }
    })
  }

  private observeChild(id: string): Promise<PiDurableThreadHandle> {
    const existing = this.childHandles.get(id)
    if (existing) return existing
    const opening = this.attachChild(id)
    this.childHandles.set(id, opening)
    return opening
  }

  private async attachChild(id: string) {
    const opened = await this.runtime!.open({ backendId: runtimeId(this.context!.backendId), id: runtimeId(id) })
    if (opened.status !== 'confirmed') throw new Error(opened.error.message)
    const handle = opened.value
    const facts = await handle.durable.facts()
    if (facts.lineage.kind !== 'subagent') throw new Error('Durable child has no behavior origin')
    const { parent, origin } = facts.lineage
    if (parent !== this.handle?.thread.id) await this.observeChild(parent)
    const parentContext = parent === this.handle?.thread.id ? this.context! : this.childProjections.get(parent)!.context
    const toolCallId = await this.behaviorToolCallId({
      thread: parent,
      key: (await import('@cherrystudio/agent-behavior')).callKeyOf(origin.parentToolCallId)
    })
    this.childOrigins.set(id, { parent, origin, toolCallId })
    const childContext = contexts.child(parentContext.id, id, id, toolCallId, origin.description)
    const projection = new ChildThreadProjection(
      childContext,
      {
        ...handle,
        observe: (sink) =>
          handle.observe(async (event) => {
            await sink(event)
            if (event.type === 'subagent.upsert' && event.subagent.child)
              void this.observeChild(event.subagent.child.id).catch((error) => this.fail(error))
            if (event.type === 'snapshot') {
              const child = await handle.durable.facts()
              this.publishChild(
                id,
                child.live.idle
                  ? child.live.runEnd?.outcome === 'completed'
                    ? 'completed'
                    : child.live.runEnd?.outcome === 'aborted'
                      ? 'stopped'
                      : 'error'
                  : 'in_progress',
                this.childStates.get(id)?.isBackgrounded ?? false
              )
            }
          })
      },
      async () => {
        const archive = await handle.archive()
        if (archive.status !== 'confirmed') throw new Error(archive.error.message)
        return archive.value
      }
    )
    this.childProjections.set(id, projection)
    await projection.attach()
    for (const child of facts.children.keys()) void this.observeChild(child).catch((error) => this.fail(error))
    return handle
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
    const id = [...this.childOrigins].find(([, value]) => value.toolCallId === toolCallId)?.[0]
    if (!id) return undefined
    await this.observeChild(id)
    const projection = this.childProjections.get(id)!
    return { snapshot: projection.snapshot.bind(projection), subscribe: projection.subscribe.bind(projection) }
  }

  async messageChild(contextId: string, text: string): Promise<void> {
    const projection = [...this.childProjections.values()].find((value) => value.context.id === contextId)
    const handle = projection && (await this.childHandles.get(projection.thread.id))
    if (!handle || this.closing) throw new Error('Child native owner is unavailable')
    const { sessionId } = projection.context
    const id = randomUUID()
    messages.saveMessage({ sessionId, message: { id, role: 'user', data: { parts: [{ type: 'text', text }] } } })
    const draft = messages.prepareSubmission(sessionId, id, contextId, 'steer')
    await projection.refresh()
    const result = await handle.input.submit(draft)
    application.get('DbService').withWriteTx((tx) =>
      messages.mergeSubmissionTx(tx, sessionId, id, {
        ...result,
        facts: result.status === 'acknowledged' ? result.facts : [],
        ...(result.status === 'rejected' || result.status === 'unsupported' ? { outcome: 'failed' as const } : {})
      })
    )
    await projection.refresh()
    if (result.status !== 'acknowledged') throw new Error(result.error.message)
  }

  async stopTask(taskId: string): Promise<boolean> {
    const child = await this.childHandles.get(taskId)
    if (!child?.interrupt) return false
    const result = await child.interrupt()
    if (result.status !== 'confirmed') throw new Error(result.error.message)
    return true
  }

  async interrupt(): Promise<void> {
    const result = await this.handle?.interrupt?.()
    if (result && result.status !== 'confirmed') throw new Error(result.error.message)
    await this.refreshInputs()
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

  close(): Promise<void> {
    this.closing = true
    return (this.closePromise ??= this.finishClose())
  }

  private async finishClose() {
    const result = await this.runtime?.shutdown()
    if (result && result.status !== 'confirmed') throw new Error(result.error.message)
    toolApprovalRegistry.abort(this.input.sessionId, 'durable-owner-closed')
    await Promise.all([...this.childHandles.values()].map((handle) => handle.catch(() => undefined)))
    await Promise.all([...this.childProjections.values()].map((projection) => projection.stop()))
    await this.observation?.stop()
    await this.handle?.release()
    for (const handle of this.childHandles.values()) await (await handle.catch(() => undefined))?.release()
    await this.desktop?.close()
    this.events.close()
  }
}
