import type { Cursor, Storage } from '@earendil-works/pi-durable'

import { application } from '@application'
import type { DurableRecoveryWork } from '@cherrystudio/agent-runtime-pi-durable'
import type { AgentRuntimeBackendRow } from '@data/db/schemas/agentRuntimeBackend'
import type { AgentSessionContextRow } from '@data/db/schemas/agentSessionContext'
import { agentService } from '@data/services/AgentService'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { loggerService } from '@logger'
import { openDurableStorage } from '@main/ai/agentSession/durableNativeContext'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { SequencerByKey } from '@shared/utils/async'

import { prepareAgentSessionWorkspaceDirectory } from '../agentSessionWorkspace'
import { AgentSessionForkError, type RuntimeForkInput } from '../fork'
import { type AgentRuntimeConnectInput, type AgentSessionRuntimeDriver, unavailableNativeContext } from '../types'
import { DurableBackend, type DurableRoot } from './DurableBackend'
import { prepareDurableBranch } from './durableContext'
import { forkDurable } from './durableFork'
import { DurableForkCheckpointSchema } from './forkCheckpoint'
import { PiDurableRuntimeConnection } from './PiDurableRuntimeConnection'
import { recoverDurableFollowups } from './recoverDurableReplies'

const logger = loggerService.withContext('PiDurableRuntimeDriver')
type Slot = { owner?: DurableBackend; connections: Map<string, PiDurableRuntimeConnection> }
type Adopt = (root: DurableRoot, connection: PiDurableRuntimeConnection) => void

export class PiDurableRuntimeDriver implements AgentSessionRuntimeDriver {
  readonly type = 'pi-durable'
  private readonly backends = new Map<string, Slot>()

  constructor(
    private readonly adopt: Adopt = (root, connection) =>
      application.get('AgentSessionRuntimeService').adoptDurableConnection(root.input, root.context, connection),
    private readonly recoverReply = (scope: { sessionId: string; runId: string }) =>
      application.get('AgentSessionRuntimeService').recoverPendingReplies(scope)
  ) {}

  private readonly operations = new SequencerByKey<string>()

  private slot(id: string): Slot {
    return this.backends.get(id) ?? { connections: new Map() }
  }

  isForkCheckpoint(value: unknown, binding?: Pick<AgentSessionContextRow, 'backendId' | 'nativeThreadId'>): boolean {
    const parsed = DurableForkCheckpointSchema.safeParse(value)
    return (
      parsed.success &&
      (!binding ||
        (parsed.data.backendId === binding.backendId && parsed.data.conversationId === binding.nativeThreadId))
    )
  }

  async fork(input: RuntimeForkInput) {
    const checkpoint = DurableForkCheckpointSchema.parse(input.checkpoint)
    if (
      input.sourceBackendId !== checkpoint.backendId ||
      !contexts
        .roots(checkpoint.backendId)
        .some((root) => root.sessionId === input.sourceSessionId && root.nativeThreadId === checkpoint.conversationId)
    )
      throw new AgentSessionForkError('unsupported_checkpoint')
    return this.operations.queue(checkpoint.backendId, async () => {
      const slot = this.backends.get(checkpoint.backendId)
      input.signal.throwIfAborted()
      contexts.markRecoveryCheck(checkpoint.backendId, true)
      await input.recordNativePreparation?.(input.targetSessionId)
      if (slot?.owner) return forkDurable(slot.owner.runtime.durable, input)
      const [{ createSession }, { BACKGROUND_CONTEXT }] = await Promise.all([
        import('@earendil-works/pi-durable'),
        import('@earendil-works/chord/context')
      ])
      const session = createSession(await openDurableStorage(contexts.backend(checkpoint.backendId)))
      try {
        return await forkDurable(session, input)
      } finally {
        await session.close(BACKGROUND_CONTEXT)
      }
    })
  }

  async validateSession(session: AgentSessionEntity, opts?: { headless?: boolean }): Promise<void> {
    const agent = session.agentId ? agentService.getAgent(session.agentId) : undefined
    const effectiveModel = opts?.headless ? agent?.model : (session.model ?? agent?.model)
    if (!agent || !session.workspace?.path || !effectiveModel)
      throw new Error('Pi Durable requires an agent, workspace and model')
    await prepareAgentSessionWorkspaceDirectory(session)
  }

  async recoverWork(blockedSessions: ReadonlySet<string> = new Set(), canWrite = () => true): Promise<void> {
    for (const backend of contexts.backendsNeedingRecovery()) {
      if (!canWrite()) return
      try {
        await this.recoverBackend(backend, blockedSessions, canWrite)
      } catch (error) {
        logger.warn('Durable store remains pending recovery', { backendId: backend.id, error })
      }
    }
  }

  private async recoverProjections(
    backend: AgentRuntimeBackendRow,
    storage: Storage,
    isWritable: (sessionId: string) => boolean,
    scope?: Parameters<typeof recoverDurableFollowups>[3]
  ): Promise<void> {
    const { acknowledged, replies } = await recoverDurableFollowups(backend.id, storage, isWritable, scope)
    for (const reply of replies) if (isWritable(reply.sessionId)) await this.recoverReply(reply)
    if (!acknowledged.length) return
    const [{ createSession }, { acknowledgeFollowupProjections }, { BACKGROUND_CONTEXT }] = await Promise.all([
      import('@earendil-works/pi-durable'),
      import('@cherrystudio/agent-runtime-pi-durable'),
      import('@earendil-works/chord/context')
    ])
    const session = createSession(await openDurableStorage(backend))
    try {
      await session.commit((tx) => acknowledgeFollowupProjections(tx, acknowledged), BACKGROUND_CONTEXT)
    } finally {
      await session.close(BACKGROUND_CONTEXT)
    }
  }

  recoverBackend(
    backend: AgentRuntimeBackendRow,
    blockedSessions: ReadonlySet<string>,
    canWrite: () => boolean
  ): Promise<void> {
    return this.operations.queue(backend.id, async () => {
      if (!canWrite() || this.backends.get(backend.id)?.owner || !contexts.backend(backend.id).needsRecoveryCheck)
        return
      const [{ BACKGROUND_CONTEXT }, { readFollowupProjections }] = await Promise.all([
        import('@earendil-works/chord/context'),
        import('@cherrystudio/agent-runtime-pi-durable')
      ])
      const storage = await openDurableStorage(backend, 'ro')
      let work: DurableRecoveryWork
      let root: AgentSessionContextRow
      let request: AgentRuntimeConnectInput
      try {
        await this.recoverProjections(backend, storage, (id) => canWrite() && !blockedSessions.has(id))
        let cursor: Cursor | undefined
        let blockedWithdrawal = false
        do {
          const page = await storage.scanSubmissions({ status: 'unanswered' }, 128, cursor, BACKGROUND_CONTEXT)
          if (!canWrite()) return
          for (const record of page.items) {
            if (
              record.type !== 'input' ||
              record.status !== 'unanswered' ||
              record.reason !== 'aborted' ||
              record.entry !== undefined ||
              !record.requestId
            )
              continue
            const root = contexts.rootForThread(backend.id, String(record.conversationId))
            if (!root || messages.inputBinding(root.sessionId, record.requestId)?.contextId !== root.id) continue
            if (blockedSessions.has(root.sessionId)) {
              blockedWithdrawal = true
            } else if (!messages.replyTo(root.sessionId, record.requestId)) {
              messages.markUserMessageUnsent(root.sessionId, record.requestId, root.id)
            }
          }
          cursor = page.next
        } while (cursor)
        work = await DurableBackend.readWork(backend.id, storage)
        const roots = [...new Set(work.roots.values())].map((id) => contexts.rootForThread(backend.id, id))
        if (!roots.length) {
          if (work.needsInventory && canWrite()) {
            const [{ createSession }, { recoveryIndex }] = await Promise.all([
              import('@earendil-works/pi-durable'),
              import('@cherrystudio/agent-runtime-pi-durable')
            ])
            const session = createSession(await openDurableStorage(backend))
            try {
              await session.commit(async (tx) => {
                ;(await tx.doc(recoveryIndex)).initialized = true
              }, BACKGROUND_CONTEXT)
            } finally {
              await session.close(BACKGROUND_CONTEXT)
            }
          }
          if (!blockedWithdrawal && canWrite() && !(await readFollowupProjections(storage)).length)
            contexts.markRecoveryCheck(backend.id, false)
          return
        }
        if (roots.some((binding) => !binding || blockedSessions.has(binding.sessionId))) return
        root = roots[0]!
        request = await DurableBackend.restoredInput(root, storage)
      } finally {
        await storage.close(BACKGROUND_CONTEXT)
      }
      if (canWrite()) {
        const opened = await this.open(this.slot(backend.id), request, root, work)
        if ('status' in opened) throw new Error(opened.reason)
      }
    })
  }

  async connect(input: AgentRuntimeConnectInput) {
    const context = prepareDurableBranch(input.sessionId, input.branchHead)
    const opened = await this.connectBranch(input, context)
    if (!('status' in opened)) return opened
    // An idle reopen may be waiting for an already-admitted delivery to resume.
    if (input.headless === undefined) throw new Error(opened.reason)
    logger.warn('Rebuilding a missing Durable context from session messages', {
      sessionId: input.sessionId,
      contextId: context.id,
      reason: opened.reason
    })
    const replacement = prepareDurableBranch(input.sessionId, input.branchHead, context.id)
    const rebuilt = await this.connectBranch(input, replacement)
    if ('status' in rebuilt) throw new Error(rebuilt.reason)
    return rebuilt
  }

  private connectBranch(input: AgentRuntimeConnectInput, context: AgentSessionContextRow) {
    return this.operations.queue(context.backendId, () => this.open(this.slot(context.backendId), input, context))
  }

  private async open(
    slot: Slot,
    input: AgentRuntimeConnectInput,
    context: AgentSessionContextRow,
    recovery?: DurableRecoveryWork
  ) {
    const existing = slot.connections.get(context.id)
    if (existing) return existing
    const current = contexts.context(context.id)
    if (!current.anchorMessageId) return unavailableNativeContext(context, 'Durable branch binding was replaced')
    if (!slot.owner && !recovery) {
      const inputIds: string[] = []
      for (const { contextId, messageId } of messages.stagedFollowups(current.sessionId)) {
        if (!contextId) messages.markUserMessageUnsent(current.sessionId, messageId, null)
        else if (contextId === current.id) inputIds.push(messageId)
      }
      if (current.nativeThreadId && inputIds.length) {
        const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context')
        const backend = contexts.backend(current.backendId)
        const storage = await openDurableStorage(backend, 'ro').catch(() => undefined)
        if (storage) {
          try {
            await this.recoverProjections(backend, storage, () => true, { context: current, inputIds })
          } finally {
            await storage.close(BACKGROUND_CONTEXT)
          }
        }
      }
    }
    contexts.markRecoveryCheck(context.backendId, true)
    const created = slot.owner ? undefined : await DurableBackend.open(input, current, recovery)
    if (created && 'status' in created) return created
    const owner = (slot.owner ??= created!.owner)
    this.backends.set(context.backendId, slot)
    const root = created?.root ?? (await owner.prepare(input, current))
    const preparing: PiDurableRuntimeConnection[] = []
    let inPreparation = true
    const attach = async (host: DurableRoot) => {
      const id = host.context.id
      const connection = new PiDurableRuntimeConnection(host.input, {
        owner,
        root: host,
        release: (flush) => {
          const release = async () => {
            if (slot.connections.get(id) !== connection) return
            if (slot.connections.size === 1) await owner.shutdown()
            await flush()
            slot.connections.delete(id)
            if (!slot.connections.size) {
              slot.owner = undefined
              this.backends.delete(context.backendId)
              if (!inPreparation) await this.clearIfSettled(context.backendId)
            }
          }
          return inPreparation ? release() : this.operations.queue(context.backendId, release)
        }
      })
      slot.connections.set(id, connection)
      preparing.push(connection)
      const children = created?.recovery.roots
      const opened = await connection.start(
        children
          ? [...children]
              .filter(([child, parent]) => child !== parent && parent === host.context.nativeThreadId)
              .map(([child]) => child)
          : []
      )
      if ('status' in opened) await connection.close()
      return opened
    }
    try {
      const requested = await attach(root)
      if ('status' in requested) return requested
      for (const host of created?.pending ?? []) {
        if (host.context.id === context.id) continue
        const attached = await attach(host)
        if ('status' in attached) throw new Error(attached.reason)
        this.adopt(host, attached)
      }
      if (recovery) this.adopt(root, requested)
      if (created) {
        const result = await owner.runtime.resume()
        if (result.status !== 'confirmed') throw new Error(result.error.message)
      }
      return requested
    } catch (error) {
      for (const connection of preparing) await connection.close()
      throw error
    } finally {
      inPreparation = false
    }
  }

  private async clearIfSettled(backendId: string): Promise<void> {
    const [{ BACKGROUND_CONTEXT }, { readFollowupProjections }] = await Promise.all([
      import('@earendil-works/chord/context'),
      import('@cherrystudio/agent-runtime-pi-durable')
    ])
    const storage = await openDurableStorage(contexts.backend(backendId), 'ro')
    try {
      if (
        !(await readFollowupProjections(storage)).length &&
        !(await DurableBackend.readWork(backendId, storage)).roots.size
      )
        contexts.markRecoveryCheck(backendId, false)
    } finally {
      await storage.close(BACKGROUND_CONTEXT)
    }
  }
}
