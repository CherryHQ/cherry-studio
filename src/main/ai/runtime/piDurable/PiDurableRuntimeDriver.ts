import { application } from '@application'
import type { DurableRecoveryWork } from '@cherrystudio/agent-runtime-pi-durable'
import type { AgentRuntimeBackendRow } from '@data/db/schemas/agentRuntimeBackend'
import type { AgentSessionContextRow } from '@data/db/schemas/agentSessionContext'
import { agentService } from '@data/services/AgentService'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { loggerService } from '@logger'
import { openDurableStorage } from '@main/ai/agentSession/durableNativeContext'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { SequencerByKey } from '@shared/utils/async'

import { prepareAgentSessionWorkspaceDirectory } from '../agentSessionWorkspace'
import { AgentSessionForkError, type RuntimeForkInput } from '../fork'
import type { AgentRuntimeConnectInput, AgentSessionRuntimeDriver } from '../types'
import { DurableBackend, type DurableRoot } from './DurableBackend'
import { prepareDurableBranch } from './durableContext'
import { forkDurable } from './durableFork'
import { DurableForkCheckpointSchema } from './forkCheckpoint'
import { PiDurableRuntimeConnection } from './PiDurableRuntimeConnection'

const logger = loggerService.withContext('PiDurableRuntimeDriver')
type Slot = { owner?: DurableBackend; connections: Map<string, PiDurableRuntimeConnection> }
type Adopt = (root: DurableRoot, connection: PiDurableRuntimeConnection) => void

export class PiDurableRuntimeDriver implements AgentSessionRuntimeDriver {
  readonly type = 'pi-durable'
  private readonly backends = new Map<string, Slot>()

  constructor(
    private readonly adopt: Adopt = (root, connection) =>
      application.get('AgentSessionRuntimeService').adoptDurableConnection(root.input, root.context, connection)
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

  recoverBackend(
    backend: AgentRuntimeBackendRow,
    blockedSessions: ReadonlySet<string>,
    canWrite: () => boolean
  ): Promise<void> {
    return this.operations.queue(backend.id, async () => {
      if (!canWrite() || this.backends.get(backend.id)?.owner || !contexts.backend(backend.id).needsRecoveryCheck)
        return
      const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context')
      const storage = await openDurableStorage(backend, 'ro')
      let work: DurableRecoveryWork
      let root: AgentSessionContextRow
      let request: AgentRuntimeConnectInput
      try {
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
          if (canWrite()) contexts.markRecoveryCheck(backend.id, false)
          return
        }
        if (roots.some((binding) => !binding || blockedSessions.has(binding.sessionId))) return
        root = roots[0]!
        request = await DurableBackend.restoredInput(root, storage)
      } finally {
        await storage.close(BACKGROUND_CONTEXT)
      }
      if (canWrite()) await this.open(this.slot(backend.id), request, root, work)
    })
  }

  connect(input: AgentRuntimeConnectInput) {
    const context = prepareDurableBranch(input.sessionId, input.branchHead)
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
    contexts.markRecoveryCheck(context.backendId, true)
    const created = slot.owner ? undefined : await DurableBackend.open(input, context, recovery)
    const owner = (slot.owner ??= created!.owner)
    this.backends.set(context.backendId, slot)
    const root = created?.root ?? (await owner.prepare(input, context))
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
      await connection.start(
        children
          ? [...children]
              .filter(([child, parent]) => child !== parent && parent === host.context.nativeThreadId)
              .map(([child]) => child)
          : []
      )

      return connection
    }
    try {
      const requested = await attach(root)
      for (const host of created?.pending ?? []) {
        if (host.context.id !== context.id) this.adopt(host, await attach(host))
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
    const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context')
    const storage = await openDurableStorage(contexts.backend(backendId), 'ro')
    try {
      if (!(await DurableBackend.readWork(backendId, storage)).roots.size) contexts.markRecoveryCheck(backendId, false)
    } finally {
      await storage.close(BACKGROUND_CONTEXT)
    }
  }
}
