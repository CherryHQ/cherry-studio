import type { AgentSessionContextRow } from '@data/db/schemas/agentSessionContext'
import { agentService } from '@data/services/AgentService'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { openDurableStorage } from '@main/ai/agentSession/durableNativeContext'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { Sequencer } from '@shared/utils/async'

import { prepareAgentSessionWorkspaceDirectory } from '../agentSessionWorkspace'
import { AgentSessionForkError, type RuntimeForkInput } from '../fork'
import type { AgentRuntimeConnectInput, AgentSessionRuntimeDriver } from '../types'
import { DurableBackend } from './DurableBackend'
import { prepareDurableBranch } from './durableContext'
import { forkDurable } from './durableFork'
import { DurableForkCheckpointSchema } from './forkCheckpoint'
import { PiDurableRuntimeConnection } from './PiDurableRuntimeConnection'

export class PiDurableRuntimeDriver implements AgentSessionRuntimeDriver {
  readonly type = 'pi-durable'
  private readonly backends = new Map<string, { queue: Sequencer; owner?: DurableBackend; users: number }>()

  private slot(id: string) {
    let slot = this.backends.get(id)
    if (!slot) {
      slot = { queue: new Sequencer(), users: 0 }
      this.backends.set(id, slot)
    }
    return slot
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
    const slot = this.slot(checkpoint.backendId)
    return slot.queue.queue(async () => {
      input.signal.throwIfAborted()
      await input.recordNativePreparation?.(input.targetSessionId)
      if (slot.owner) return forkDurable(slot.owner.runtime.durable, input)
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

  connect(input: AgentRuntimeConnectInput) {
    input = { ...input }
    const context = prepareDurableBranch(input.sessionId, input.branchHead)
    const slot = this.slot(context.backendId)
    return new PiDurableRuntimeConnection(input, async () =>
      slot.queue.queue(async () => {
        slot.owner ??= await DurableBackend.open(input, context)
        const owner = slot.owner
        const root = await owner.prepare(input, contexts.context(context.id))
        slot.users += 1
        let released = false
        return {
          owner,
          root,
          release: (flush: () => Promise<void>) =>
            slot.queue.queue(async () => {
              if (released) return
              if (slot.users === 1) {
                await owner.shutdown()
              }
              await flush()
              if (slot.users === 1) slot.owner = undefined
              slot.users -= 1
              released = true
            })
        }
      })
    ).start()
  }
}
