import { createHash, randomUUID } from 'node:crypto'

import type {
  ConversationId,
  EntryId,
  AgentChange,
  ModelRef,
  Registry,
  Storage,
  TaskId
} from '@earendil-works/pi-durable'

import { application } from '@application'
import type { HostPorts, BehaviorEvent, CallRef } from '@cherrystudio/agent-behavior'
import { runtimeId, type Thread, type ThreadId } from '@cherrystudio/agent-runtime'
import type { DurableFollowup, DurableRecoveryWork, PiDurableRuntime } from '@cherrystudio/agent-runtime-pi-durable'
import type { AgentSessionContextRow } from '@data/db/schemas/agentSessionContext'
import { agentService } from '@data/services/AgentService'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { openDurableStorage, prepareDurableRoot } from '@main/ai/agentSession/durableNativeContext'
import { createPiTelemetry } from '@main/ai/observability'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'
import { formatGatewayModelId } from '@shared/utils/apiGateway'
import { Sequencer } from '@shared/utils/async'
import { createLocalError } from '@shared/utils/localError'
import { getRawModelId } from '@shared/utils/model'

import { createPiGatewayModelBinding } from '../pi/gatewayModelBinding'
import { createPiBehaviorHost } from '../pi/piBehaviorHost'
import { type AgentRuntimeConnectInput, type AgentRuntimeEvent, unavailableNativeContext } from '../types'
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
  sink?: {
    event(event: AgentRuntimeEvent): void
    behavior(event: BehaviorEvent): void
    usage: Parameters<typeof createPiGatewayModelBinding>[3]
    retry: Parameters<typeof createPiGatewayModelBinding>[5]
    placed(input: string | undefined): void
    followups(queue: readonly DurableFollowup[]): void
  }
}
const logger = loggerService.withContext('DurableBackend')

/** One Harness and its host resources for a native store; connections only borrow root accesses. */
export class DurableBackend {
  runtime!: PiDurableRuntime
  private readonly roots = new Map<string, DurableRoot>()
  private readonly preparedRoots = new Map<string, { root: DurableRoot; attaching: boolean }>()
  private readonly nativeRoots = new Map<ThreadId, string>()

  private readonly retired = new Set<DurableRoot>()
  private readonly deferredReclaims = new Map<string, TaskId>()
  private readonly hostOperations = new Sequencer()
  private models?: Binding['modelRuntime']
  private shutdownPromise?: Promise<void>
  private stopping = false
  private nativeStopped = false

  private constructor(private readonly registry: Registry) {}

  static async restoredInput(context: AgentSessionContextRow, storage: Storage): Promise<AgentRuntimeConnectInput> {
    const session = agentSessionService.getById(context.sessionId)
    const agent = session.agentId ? agentService.getAgent(session.agentId) : undefined
    const saved = context.nativeThreadId && (await readDurableRequest(storage, context.nativeThreadId))
    const modelId = (saved && saved.modelId) || session.model || agent?.model
    if (!agent || !modelId) throw new Error('Durable root has no executable product configuration')
    return {
      sessionId: session.id,
      branchHead: context.anchorMessageId ?? undefined,
      agentId: agent.id,
      modelId,
      ...saved
    }
  }

  static async readWork(backendId: string, storage: Storage) {
    const { readDurableWork } = await import('@cherrystudio/agent-runtime-pi-durable')
    return readDurableWork(storage, (root) => !!contexts.rootForThread(backendId, root))
  }

  static async open(
    input: AgentRuntimeConnectInput,
    context: AgentSessionContextRow,
    discovered?: DurableRecoveryWork
  ) {
    const [{ BACKGROUND_CONTEXT }, { createRegistry }, { createPiDurableRuntime }] = await Promise.all([
      import('@earendil-works/chord/context'),
      import('@earendil-works/pi-durable'),
      import('@cherrystudio/agent-runtime-pi-durable')
    ])
    const owner = new DurableBackend(createRegistry())
    const root = await prepareDurableRoot(context.id)
    if ('status' in root) return root
    let storageOwned = true
    try {
      const recovery = discovered ?? (await DurableBackend.readWork(context.backendId, root.storage))
      const pending: DurableRoot[] = []
      const rootContexts = new Map<ThreadId, string>()
      for (const nativeId of new Set(recovery.roots.values())) {
        const binding = contexts.rootForThread(context.backendId, nativeId)
        if (!binding) throw new Error('Unfinished Durable conversation has no product host')
        const request =
          binding.id === context.id && !recovery.executingRoots.has(nativeId)
            ? input
            : await DurableBackend.restoredInput(binding, root.storage)
        const prepared = await owner.prepare(request, binding, recovery.modelRefs.get(nativeId))
        rootContexts.set(nativeId, binding.id)
        pending.push(prepared)
      }
      if (!pending.some((host) => host.context.id === context.id)) await owner.prepare(input, context)
      for (const [thread, nativeId] of recovery.roots) owner.nativeRoots.set(thread, rootContexts.get(nativeId)!)
      storageOwned = false
      const created = await createPiDurableRuntime({
        backendId: runtimeId(context.backendId),
        openStorage: async () => root.storage,
        harness: {
          settings: { retry: { enabled: false, resumeInterrupted: true } },
          telemetry: createPiTelemetry({
            isEnabled: () => application.get('PreferenceService').get('app.developer_mode.enabled'),
            getParent: (attributes) => {
              const id = attributes['conversation.id']
              const rootId = typeof id === 'number' && owner.nativeRoots.get(runtimeId(String(id)))
              return rootId ? owner.roots.get(rootId)?.input.trace : undefined
            }
          }),
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
          recovery,
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
        onFollowupsChanged: (thread, queue) => {
          const root = owner.forThread(thread)
          if (root.context.nativeThreadId !== thread) return
          for (const { inputId, textPart } of queue)
            if (textPart !== undefined) projectFollowupEdit(root.context, inputId, textPart)
          root.sink?.followups(queue)
        },
        onFollowupEdit: (thread, inputId, textPart) => {
          const root = owner.forThread(thread)
          if (root.context.nativeThreadId === thread) projectFollowupEdit(root.context, inputId, textPart)
        },
        // A diagnostic only: Durable keeps its work and records a real failure as the input's outcome.
        onError: (error) => logger.error('Durable backend failed', { backendId: context.backendId, error })
      })
      if (created.status !== 'confirmed') {
        const { operation, code, message } = created.error
        const failure = createLocalError(message)
        if (!failure.message) failure.message = `Pi Durable ${operation}: ${code}`
        failure.name = 'PiDurableInitializationError'
        throw failure
      }
      const runtime = created.value
      owner.runtime = { ...runtime, open: (ref) => owner.openThread(runtime, ref) }
      owner.runtime.durable.observeCommits({
        advance({ changes }) {
          for (const [contextId, blocker] of owner.deferredReclaims) {
            if (
              !changes.some(
                (change) =>
                  change.type === 'task' && change.value.id === blocker && change.value.state.status === 'terminal'
              )
            )
              continue
            owner.deferredReclaims.delete(contextId)
            owner.retryReclaim(contextId)
          }
        },
        end() {
          owner.nativeStopped = true
          owner.deferredReclaims.clear()
        }
      })
      for (const refs of recovery.modelRefs.values())
        for (const ref of refs)
          if (!owner.models!.getModel(ref.provider, ref.modelId))
            throw new Error('Durable checkpoint model binding is unavailable')
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
      if (opened.status === 'rejected' && opened.error.code === 'not-found')
        return owner.shutdown().then(() => unavailableNativeContext(context, opened.error.message))
      if (opened.status !== 'confirmed') throw new Error(opened.error.message)
      owner.bind(host, Number(opened.value.thread.id) as ConversationId)
      await opened.value.release()
      return { owner, pending, root: host, recovery }
    } catch (error) {
      if (storageOwned) await root.storage.close(BACKGROUND_CONTEXT)
      if (owner.runtime) await owner.shutdown()
      else await owner.closeHosts()
      throw error
    }
  }

  private bind(root: DurableRoot, id: ConversationId) {
    root.context = contexts.bindContext(root.context.id, String(id))
    this.nativeRoots.set(runtimeId(String(id)), root.context.id)
  }

  prepare(
    input: AgentRuntimeConnectInput,
    context: AgentSessionContextRow,
    checkpoints: readonly ModelRef[] = []
  ): Promise<DurableRoot> {
    return this.hostOperations.queue(() => this.prepareHost(input, context, checkpoints))
  }

  private async prepareHost(
    input: AgentRuntimeConnectInput,
    context: AgentSessionContextRow,
    checkpoints: readonly ModelRef[]
  ): Promise<DurableRoot> {
    if (this.stopping) throw new Error('Durable backend is closing')
    const previous = this.roots.get(context.id)
    if (previous?.input === input) return previous
    const desktop = await prepareDurableDesktop(input, (event) => this.roots.get(context.id)?.sink?.event(event), {
      contextId: context.id,
      namespace: randomUUID()
    })
    try {
      const bindModel = (model: Model, provider = providerService.getByProviderId(model.providerId)) => {
        const modelId = formatGatewayModelId(model.providerId, getRawModelId(model))
        const frozen = JSON.stringify([
          context.id,
          model.id,
          input.reasoningEffort ?? 'default',
          input.serviceTier ?? 'standard',
          input.fastMode === true
        ])
        const name = `cherry-gateway/${createHash('sha256').update(frozen).digest('hex')}`
        const aliases = checkpoints.filter((ref) => ref.modelId === modelId).map((ref) => ref.provider)
        return createPiGatewayModelBinding(
          input,
          provider,
          model,
          (...args) => host.sink?.usage?.(...args),
          this.models,
          (...args) => host.sink?.retry?.(...args),
          [name, ...aliases]
        )
      }
      const binding = await bindModel(desktop.snapshot.model, desktop.snapshot.provider)
      this.models = binding.modelRuntime
      const behavior = await createPiBehaviorHost({
        contextId: context.id,
        input,
        root: () => runtimeId(this.roots.get(context.id)?.context.nativeThreadId ?? context.nativeThreadId ?? '0'),
        binding,
        model: desktop.snapshot.model,
        rootModelKey: `${desktop.snapshot.model.providerId}/${formatGatewayModelId(desktop.snapshot.model.providerId, getRawModelId(desktop.snapshot.model))}`,
        approval: desktop.approval,
        bindModel,
        emit: (event) => host.sink?.event(event),
        observe: (event) => host.sink?.behavior(event),
        usageSessionId: (thread) => this.usageSessionId(thread),
        toolCallIdentity: (call) => this.toolCallIdentity(context.backendId, call)
      })
      const host: DurableRoot = {
        context,
        input,
        desktop,
        behavior,
        agent: {
          ...desktop.agentConfig,
          model: { provider: binding.model.provider, modelId: binding.model.id }
        }
      }
      for (const extension of desktop.registry.snapshot().installed()) this.registry.install(extension)
      if (previous) {
        const abandoned = this.preparedRoots.get(context.id)
        if (abandoned) this.retirePrepared(abandoned.root)
        this.preparedRoots.set(context.id, { root: host, attaching: false })
      } else {
        this.roots.set(context.id, host)
      }
      if (context.nativeThreadId) this.nativeRoots.set(runtimeId(context.nativeThreadId), context.id)
      return host
    } catch (error) {
      await desktop.close()
      throw error
    }
  }

  private async openThread(runtime: PiDurableRuntime, ref: Thread) {
    const contextId = this.nativeRoots.get(ref.id)
    const prepared = contextId && this.preparedRoots.get(contextId)
    // The connection installs its sink immediately before opening the root. Other opens borrow the native handle.
    if (
      !prepared ||
      prepared.attaching ||
      !prepared.root.sink ||
      prepared.root.context.nativeThreadId !== ref.id ||
      prepared.root.context.backendId !== ref.backendId
    ) {
      return runtime.open(ref)
    }
    prepared.attaching = true
    const host = prepared.root
    const opened = await runtime.open(ref)
    if (opened.status !== 'confirmed') {
      await this.hostOperations.queue(() => this.retirePrepared(host))
      return opened
    }

    const handle = opened.value
    return {
      ...opened,
      value: {
        ...handle,
        durable: {
          ...handle.durable,
          configure: (change: AgentChange) => {
            if (change !== host.agent) return handle.durable.configure(change)
            return this.hostOperations.queue(async () => {
              const id = host.context.id
              if (this.stopping || this.preparedRoots.get(id) !== prepared)
                throw new Error('Durable root is unavailable')
              try {
                await handle.durable.configure(change)
              } catch (error) {
                this.retirePrepared(host)
                throw error
              }
              this.preparedRoots.delete(id)
              this.retired.add(this.roots.get(id)!)
              this.roots.set(id, host)
            })
          }
        },
        release: async () => {
          try {
            await handle.release()
          } finally {
            const id = host.context.id
            if (this.preparedRoots.get(id) === prepared) {
              await this.hostOperations.queue(() => this.retirePrepared(host))
            } else if (
              this.roots.get(id) === host &&
              !this.stopping &&
              !this.deferredReclaims.has(id) &&
              [...this.retired].some((item) => item.context.id === id)
            ) {
              try {
                await this.hostOperations.queue(() => this.reclaimRetiredHost(host))
              } catch (error) {
                logger.warn('Failed to reclaim retired durable desktop on handle release', { contextId: id, error })
              }
            }
          }
        }
      }
    }
  }

  private retirePrepared(host: DurableRoot) {
    const id = host.context.id
    if (this.preparedRoots.get(id)?.root !== host) return
    this.preparedRoots.delete(id)
    this.retired.add(host)
    if (!this.deferredReclaims.has(id)) this.retryReclaim(id)
  }

  registerChild(thread: ThreadId, rootContextId: string): void {
    this.nativeRoots.set(thread, rootContextId)
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

  private async toolCallIdentity(backendId: string, call: CallRef) {
    const opened = await this.runtime.open({ backendId: runtimeId(backendId), id: call.thread })
    if (opened.status !== 'confirmed') throw new Error(opened.error.message)
    try {
      const id = await opened.value.durable.behaviorToolCallId(call)
      if (!id) throw new Error('Durable behavior call has no native identity')
      return { toolCallId: id, parentToolCallId: (await opened.value.durable.relation())?.origin?.toolCallId }
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
        ask: (request, signal) => host(request.call.thread).approvals.ask(request, signal)
      },
      questions: { ask: (request, signal) => host(request.call.thread).questions.ask(request, signal) },
      models: {
        find: (query, thread) => host(thread).models.find(query, thread),
        current: (thread) => host(thread).models.current(thread)
      },
      verifier: { verify: (request, signal) => host(request.thread).verifier.verify(request, signal) },
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

  async acknowledgeChild(backendId: string, thread: ThreadId, through: EntryId): Promise<void> {
    const [{ acknowledgeChildArchive }, { BACKGROUND_CONTEXT }, { createSession }] = await Promise.all([
      import('@cherrystudio/agent-runtime-pi-durable'),
      import('@earendil-works/chord/context'),
      import('@earendil-works/pi-durable')
    ])
    const closed = this.shutdownPromise
    if (closed) await closed
    const reopened = closed ? createSession(await openDurableStorage(contexts.backend(backendId))) : undefined
    const session = reopened ?? this.runtime.durable
    try {
      await session.commit(
        (tx) => acknowledgeChildArchive(tx, Number(thread) as ConversationId, through),
        BACKGROUND_CONTEXT
      )
    } finally {
      await reopened?.close(BACKGROUND_CONTEXT)
    }
  }

  reclaimRetired(root: DurableRoot): Promise<void> {
    return this.hostOperations.queue(() => this.reclaimRetiredHost(root))
  }

  private retryReclaim(contextId: string) {
    void this.hostOperations
      .queue(async () => {
        const root = this.roots.get(contextId)
        if (root) await this.reclaimRetiredHost(root)
      })
      .catch((error) => logger.warn('Failed to retry retired durable desktop reclamation', { contextId, error }))
  }

  private async reclaimRetiredHost(root: DurableRoot): Promise<void> {
    if (this.stopping || this.roots.get(root.context.id) !== root) return
    const candidates = [...this.retired].filter((item) => item.context.id === root.context.id)
    if (candidates.length === 0) return
    const rootThreadId = root.context.nativeThreadId ?? contexts.context(root.context.id)?.nativeThreadId
    if (!rootThreadId) return

    const [{ AgentDoc }, { BACKGROUND_CONTEXT }, { nonterminalTaskStates }] = await Promise.all([
      import('@earendil-works/pi-durable'),
      import('@earendil-works/chord/context'),
      import('@cherrystudio/agent-runtime-pi-durable')
    ])

    const retiredExtensionNames = new Set(
      candidates.flatMap((candidate) =>
        candidate.desktop.registry
          .snapshot()
          .installed()
          .map((extension) => extension.name)
      )
    )
    const currentExtensionNames = root.desktop.registry
      .snapshot()
      .installed()
      .map((extension) => extension.name)
    const rootConversationId = Number(rootThreadId) as ConversationId

    const reclaimed = await this.runtime.durable.commit(async (tx) => {
      this.deferredReclaims.delete(root.context.id)
      const subtree: ConversationId[] = [rootConversationId]
      const seen = new Set<ConversationId>([rootConversationId])
      for (let index = 0; index < subtree.length; index++) {
        const ownerConversationId = subtree[index]
        let cursor: Parameters<typeof tx.scanConversations>[2]
        do {
          const page = await tx.scanConversations({ ownerConversationId }, 256, cursor)
          for (const child of page.items) {
            if (seen.has(child.id)) continue
            seen.add(child.id)
            subtree.push(child.id)
          }
          cursor = page.next
        } while (cursor)
      }

      for (const conversationId of subtree) {
        for (const status of nonterminalTaskStates) {
          const {
            items: [blocker]
          } = await tx.scanTasks({ conversationId, status }, 1)
          if (blocker) {
            // Record the blocker on the mutation line before its terminal commit can publish.
            this.deferredReclaims.set(root.context.id, blocker.id)
            return false
          }
        }
      }

      for (const conversationId of subtree) {
        if (conversationId === rootConversationId) continue
        const doc = await tx.doc(AgentDoc, conversationId)
        const updated = rewriteRetiredExtensions(doc.extensions, retiredExtensionNames, currentExtensionNames)
        if (updated !== undefined) doc.extensions = updated
      }
      return true
    }, BACKGROUND_CONTEXT)

    if (!reclaimed) return

    for (const candidate of candidates) {
      for (const extension of candidate.desktop.registry.snapshot().installed()) {
        this.registry.uninstall(extension)
      }
    }
    for (const candidate of candidates) {
      try {
        await candidate.desktop.close()
        this.retired.delete(candidate)
      } catch (error) {
        logger.warn('Failed to close retired durable desktop; retaining for retry', {
          contextId: candidate.context.id,
          error
        })
      }
    }
  }

  shutdown(): Promise<void> {
    return (this.shutdownPromise ??= this.hostOperations
      .queue(() => this.stop())
      .catch((error) => {
        this.shutdownPromise = undefined
        throw error
      }))
  }
  private async stop(): Promise<void> {
    this.stopping = true
    this.deferredReclaims.clear()
    const result = await this.runtime.shutdown()
    if (result.status !== 'confirmed') {
      if (!this.nativeStopped) throw new Error(result.error.message)
      logger.warn('Durable runtime shutdown did not confirm after the native scheduler stopped', {
        error: result.error
      })
    }
    await this.closeHosts()
  }
  private async closeHosts() {
    const errors: unknown[] = []
    const prepared = [...this.preparedRoots.values()].map(({ root }) => root)
    for (const root of [...this.roots.values(), ...prepared, ...this.retired]) {
      try {
        await root.desktop.close()
        if (this.roots.get(root.context.id) === root) this.roots.delete(root.context.id)
        if (this.preparedRoots.get(root.context.id)?.root === root) this.preparedRoots.delete(root.context.id)
        this.retired.delete(root)
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length) throw errors[0]
  }
}

function replaceExtensionList(
  names: readonly string[],
  retired: ReadonlySet<string>,
  replacement: readonly string[]
): string[] | undefined {
  let matched = false
  let inserted = false
  const result: string[] = []
  const seen = new Set<string>()
  const pushUnique = (name: string) => {
    if (seen.has(name)) return
    seen.add(name)
    result.push(name)
  }
  for (const name of names) {
    if (!retired.has(name)) {
      pushUnique(name)
      continue
    }
    matched = true
    if (!inserted) {
      inserted = true
      for (const nextName of replacement) pushUnique(nextName)
    }
  }
  return matched ? result : undefined
}

function rewriteRetiredExtensions(
  extensions: readonly string[] | { readonly add?: readonly string[]; readonly remove?: readonly string[] } | undefined,
  retired: ReadonlySet<string>,
  replacement: readonly string[]
): string[] | { add?: string[]; remove?: string[] } | undefined {
  if (Array.isArray(extensions)) return replaceExtensionList(extensions, retired, replacement)
  if (!extensions || typeof extensions !== 'object') return undefined
  const patch = extensions as { readonly add?: readonly string[]; readonly remove?: readonly string[] }
  const nextAdd = patch.add ? replaceExtensionList(patch.add, retired, replacement) : undefined
  const nextRemove = patch.remove?.some((name) => retired.has(name))
    ? patch.remove.filter((name) => !retired.has(name))
    : undefined
  if (!nextAdd && !nextRemove) return undefined
  return {
    ...(nextAdd !== undefined ? { add: nextAdd } : patch.add !== undefined ? { add: [...patch.add] } : {}),
    ...(nextRemove !== undefined
      ? { remove: nextRemove }
      : patch.remove !== undefined
        ? { remove: [...patch.remove] }
        : {})
  }
}

function projectFollowupEdit(context: AgentSessionContextRow, messageId: string, serialized: string): void {
  const part = JSON.parse(serialized) as Extract<CherryMessagePart, { type: 'text' }>
  if (part?.type !== 'text' || typeof part.text !== 'string') throw new Error('Invalid Durable follow-up text part')
  agentSessionMessageService.applyNativeFollowupEdit(context.sessionId, context.id, messageId, part)
}
