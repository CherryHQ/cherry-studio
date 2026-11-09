import { randomUUID } from 'node:crypto'

import type { ConversationId, AgentChange, Registry } from '@earendil-works/pi-durable'

import { application } from '@application'
import type { HostPorts, BehaviorEvent, CallRef } from '@cherrystudio/agent-behavior'
import { runtimeId, type ThreadId } from '@cherrystudio/agent-runtime'
import type { PiDurableRuntime } from '@cherrystudio/agent-runtime-pi-durable'
import type { AgentSessionContextRow } from '@data/db/schemas/agentSessionContext'
import { agentService } from '@data/services/AgentService'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { prepareDurableRoot } from '@main/ai/agentSession/durableNativeContext'
import { formatGatewayModelId } from '@shared/utils/apiGateway'
import { getRawModelId } from '@shared/utils/model'

import { createPiGatewayModelBinding } from '../pi/gatewayModelBinding'
import { createPiBehaviorHost } from '../pi/piBehaviorHost'
import type { AgentRuntimeConnectInput, AgentRuntimeEvent } from '../types'
import { prepareDurableDesktop } from './durableDesktop'
import { readDurableRequest } from './durableRequest'

type Binding = Awaited<ReturnType<typeof createPiGatewayModelBinding>>
type Behavior = Awaited<ReturnType<typeof createPiBehaviorHost>>
export interface DurableRoot {
  context: AgentSessionContextRow
  input: AgentRuntimeConnectInput
  desktop: Awaited<ReturnType<typeof prepareDurableDesktop>>
  behavior: Behavior
  agent: AgentChange
  ready: Promise<void>
  attached(): void
  sink?: {
    event(event: AgentRuntimeEvent): void
    behavior(event: BehaviorEvent): void
    usage: Parameters<typeof createPiGatewayModelBinding>[3]
    placed(input: string | undefined): void
  }
}
const logger = loggerService.withContext('DurableBackend')

/** One Harness and its host resources for a native store; connections only borrow root accesses. */
export class DurableBackend {
  runtime!: PiDurableRuntime
  private readonly roots = new Map<string, DurableRoot>()
  private readonly nativeRoots = new Map<ThreadId, string>()
  private readonly pendingRoots = new Set<string>()
  private readonly restoring = new Set<string>()
  private readonly retired: DurableRoot[] = []
  private models?: Binding['modelRuntime']
  private shutdownPromise?: Promise<void>

  private constructor(private readonly registry: Registry) {}

  static async open(input: AgentRuntimeConnectInput, context: AgentSessionContextRow): Promise<DurableBackend> {
    const [{ BACKGROUND_CONTEXT }, { createRegistry }, { createPiDurableRuntime }] = await Promise.all([
      import('@earendil-works/chord/context'),
      import('@earendil-works/pi-durable'),
      import('@cherrystudio/agent-runtime-pi-durable')
    ])
    const owner = new DurableBackend(createRegistry())
    const root = await prepareDurableRoot(context.id)
    let storageOwned = true
    try {
      for (const binding of contexts.roots(context.backendId)) {
        const session = agentSessionService.getById(binding.sessionId)
        const agent = session.agentId ? agentService.getAgent(session.agentId) : undefined
        if (!agent?.model && binding.id !== context.id) continue
        const saved = binding.nativeThreadId && (await readDurableRequest(root.storage, binding.nativeThreadId))
        await owner.prepare(
          binding.id === context.id
            ? input
            : {
                sessionId: binding.sessionId,
                agentId: agent!.id,
                modelId: agent!.model!,
                ...saved
              },
          binding
        )
      }
      const records = new Map<number, Awaited<ReturnType<typeof root.storage.scanConversations>>['items'][number]>()
      let cursor: Parameters<typeof root.storage.scanConversations>[2]
      do {
        const page = await root.storage.scanConversations({}, 256, cursor, BACKGROUND_CONTEXT)
        for (const record of page.items) records.set(record.id, record)
        cursor = page.next
      } while (cursor)
      const resolve = (id: number): string | undefined => {
        const thread = runtimeId<'thread'>(String(id))
        const known = owner.nativeRoots.get(thread)
        if (known) return known
        const parent = records.get(id)?.owner?.conversationId
        const contextId = parent === undefined ? undefined : resolve(parent)
        if (contextId) owner.nativeRoots.set(thread, contextId)
        return contextId
      }
      for (const id of records.keys()) resolve(id)
      let taskCursor: Parameters<typeof root.storage.scanTasks>[2]
      do {
        const page = await root.storage.scanTasks({}, 256, taskCursor, BACKGROUND_CONTEXT)
        for (const task of page.items) {
          const rootId = owner.nativeRoots.get(runtimeId(String(task.conversationId)))
          if (task.state.status === 'terminal') continue
          if (!rootId && records.has(task.conversationId))
            throw new Error('Unfinished Durable conversation has no product host')
          if (rootId) owner.pendingRoots.add(rootId)
        }
        taskCursor = page.next
      } while (taskCursor)
      storageOwned = false
      const created = await createPiDurableRuntime({
        backendId: runtimeId(context.backendId),
        openStorage: async () => root.storage,
        harness: {
          models: owner.models!,
          registry: owner.registry,
          env: (target) => owner.forThread(runtimeId(String(target.conversationId))).desktop.environment,
          conversationCreated: (_tx, record) => {
            const parent = record.owner && owner.nativeRoots.get(runtimeId(String(record.owner.conversationId)))
            if (parent) owner.nativeRoots.set(runtimeId(String(record.id)), parent)
          }
        },
        behavior: {
          host: owner.host(),
          owns: (thread) => owner.nativeRoots.has(thread),
          configureRoot: (thread) => owner.forThread(thread).agent,
          configureChild: async ({ thread, parent, modelKey }) => {
            const host = owner.forThread(parent.id)
            owner.nativeRoots.set(thread.id, host.context.id)
            const binding = await host.behavior.configureChild({ thread, modelKey })
            return {
              ...host.desktop.agentConfig,
              model: { provider: binding.model.provider, modelId: binding.model.id }
            }
          }
        },
        onInputPlaced: (id, thread) => owner.forThread(thread).sink?.placed(id),
        onError: (error) => {
          logger.error('Durable backend failed', { backendId: context.backendId, error })
          for (const host of owner.roots.values()) host.sink?.event({ type: 'error', error })
        }
      })
      if (created.status !== 'confirmed') throw new Error(created.error.message)
      owner.runtime = created.value
      const host = owner.roots.get(context.id)!
      const opened = root.nativeId
        ? await owner.runtime.open({ backendId: runtimeId(context.backendId), id: runtimeId(root.nativeId) })
        : await owner.runtime.create({
            ownership: { kind: 'ownerless' },
            agent: host.agent,
            init: async (tx, id) => {
              await root.init(tx, id)
              owner.nativeRoots.set(runtimeId(String(id)), host.context.id)
            }
          })
      if (opened.status !== 'confirmed') throw new Error(opened.error.message)
      owner.bind(host, Number(opened.value.thread.id) as ConversationId)
      await opened.value.release()
      return owner
    } catch (error) {
      if (storageOwned) await root.storage.close(BACKGROUND_CONTEXT)
      if (owner.runtime) await owner.runtime.shutdown()
      await owner.closeHosts()
      throw error
    }
  }

  private bind(root: DurableRoot, id: ConversationId) {
    root.context = contexts.bindContext(root.context.id, String(id))
    this.nativeRoots.set(runtimeId(String(id)), root.context.id)
  }

  async prepare(input: AgentRuntimeConnectInput, context: AgentSessionContextRow): Promise<DurableRoot> {
    const previous = this.roots.get(context.id)
    if (previous && this.restoring.has(context.id)) {
      const saved = previous.input
      Object.assign(input, {
        modelId: saved.modelId,
        reasoningEffort: saved.reasoningEffort,
        serviceTier: saved.serviceTier,
        fastMode: saved.fastMode,
        knowledgeBaseIds: saved.knowledgeBaseIds
      })
    }
    if (previous?.input === input) return previous
    const desktop = await prepareDurableDesktop(
      input,
      (event) => this.roots.get(context.id)?.sink?.event(event),
      randomUUID()
    )
    try {
      const binding = await createPiGatewayModelBinding(
        input,
        desktop.snapshot.provider,
        desktop.snapshot.model,
        (...args) => host.sink?.usage?.(...args),
        this.models
      )
      this.models = binding.modelRuntime
      const rootThread = runtimeId<'thread'>(context.nativeThreadId ?? '0')
      const behavior = await createPiBehaviorHost({
        input,
        root: rootThread,
        binding,
        model: desktop.snapshot.model,
        rootModelKey: `${desktop.snapshot.model.providerId}/${formatGatewayModelId(desktop.snapshot.model.providerId, getRawModelId(desktop.snapshot.model))}`,
        approval: desktop.approval,
        bindModel: (model) =>
          createPiGatewayModelBinding(
            input,
            providerService.getByProviderId(model.providerId),
            model,
            (...args) => host.sink?.usage?.(...args),
            this.models
          ),
        emit: (event) => host.sink?.event(event),
        observe: (event) => host.sink?.behavior(event),
        usageSessionId: (thread) => this.usageSessionId(thread),
        toolCallId: (call) => this.toolCallId(context.backendId, call)
      })
      let attached!: () => void
      const ready = new Promise<void>((resolve) => {
        attached = resolve
      })
      const host: DurableRoot = {
        ready,
        attached,
        context,
        input,
        desktop,
        behavior,
        agent: {
          ...desktop.agentConfig,
          model: { provider: binding.model.provider, modelId: binding.model.id }
        }
      }
      if (previous) {
        void ready.then(previous.attached)
        this.retired.push(previous)
      }
      this.roots.set(context.id, host)
      if (context.nativeThreadId) this.nativeRoots.set(runtimeId(context.nativeThreadId), context.id)
      for (const extension of desktop.registry.snapshot().installed()) this.registry.install(extension)
      return host
    } catch (error) {
      await desktop.close()
      throw error
    }
  }

  async resume(): Promise<void> {
    for (const id of this.pendingRoots) {
      const root = this.roots.get(id)!
      if (root.sink) {
        await root.ready
        continue
      }
      this.restoring.add(id)
      try {
        const connecting = application.get('AgentSessionRuntimeService').primeConnection(root.context.sessionId)
        await Promise.race([
          root.ready,
          connecting.then(() => {
            const attached = this.roots.get(id)!
            if (!attached.sink) throw new Error('Durable recovery requires its product connection')
            return attached.ready
          })
        ])
      } finally {
        this.restoring.delete(id)
      }
    }
    const result = await this.runtime.resume()
    if (result.status !== 'confirmed') throw new Error(result.error.message)
    this.pendingRoots.clear()
  }

  private forThread(thread: ThreadId): DurableRoot {
    const id = this.nativeRoots.get(thread)
    const root = id && this.roots.get(id)
    if (!root) throw new Error(`Durable conversation ${thread} has no product host`)
    return root
  }

  private async usageSessionId(thread: ThreadId): Promise<string> {
    const root = this.forThread(thread)
    const find = async (id: ThreadId): Promise<AgentSessionContextRow> => {
      if (id === root.context.nativeThreadId) return root.context
      const opened = await this.runtime.open({ backendId: runtimeId(root.context.backendId), id })
      if (opened.status !== 'confirmed') throw new Error(opened.error.message)
      try {
        const relation = await opened.value.durable.relation()
        if (!relation?.origin) throw new Error('Durable child origin is unavailable')
        const parent = await find(relation.parent.id)
        return contexts.child(parent.id, id, relation.origin.toolCallId, relation.origin.description ?? id)
      } finally {
        await opened.value.release()
      }
    }
    return (await find(thread)).sessionId
  }

  private async toolCallId(backendId: string, call: CallRef): Promise<string> {
    const opened = await this.runtime.open({ backendId: runtimeId(backendId), id: call.thread })
    if (opened.status !== 'confirmed') throw new Error(opened.error.message)
    try {
      const id = await opened.value.durable.behaviorToolCallId(call)
      if (!id) throw new Error('Durable behavior call has no native identity')
      return id
    } finally {
      await opened.value.release()
    }
  }

  private host(): HostPorts {
    const host = (thread: ThreadId) => this.forThread(thread).behavior.host
    const global = () => this.roots.values().next().value!.behavior.host
    return {
      approvals: {
        facts: (call, tool) => host(call.thread).approvals.facts(call, tool),
        ask: (request, signal) => host(request.call.thread).approvals.ask(request, signal),
        outcomes: (thread, calls) => host(thread).approvals.outcomes(thread, calls)
      },
      questions: { ask: (request, signal) => host(request.call.thread).questions.ask(request, signal) },
      models: {
        find: (query, thread) => host(thread).models.find(query, thread),
        current: (thread) => host(thread).models.current(thread)
      },
      verifier: { verify: (request, signal) => host(request.thread).verifier.verify(request, signal) },
      summarizer: { summarize: (request, signal) => host(request.thread).summarizer.summarize(request, signal) },
      outputStore: { save: (file) => global().outputStore.save(file) },
      observation: { emit: (event) => host(event.thread).observation.emit(event) },
      settings: {
        permissionMode: (thread) => host(thread).settings.permissionMode(thread),
        attendance: (thread) => host(thread).settings.attendance(thread),
        goalDefaults: () => global().settings.goalDefaults(),
        autonomy: () => global().settings.autonomy(),
        maxBackground: () => global().settings.maxBackground(),
        offloadThreshold: () => global().settings.offloadThreshold()
      }
    }
  }

  shutdown(): Promise<void> {
    return (this.shutdownPromise ??= this.stop().catch((error) => {
      this.shutdownPromise = undefined
      throw error
    }))
  }
  private async stop(): Promise<void> {
    const result = await this.runtime.shutdown()
    if (result.status !== 'confirmed') throw new Error(result.error.message)
    await this.closeHosts()
  }
  private async closeHosts() {
    for (const root of [...this.roots.values(), ...this.retired]) await root.desktop.close()
  }
}
