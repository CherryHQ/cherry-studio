import { BaseService } from '@main/core/lifecycle/BaseService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentConnectionManager } from '../AgentConnectionManager'
import { createAgentConnectionResourceState } from '../agentConnectionResourceState'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

type ManagerInternals = {
  entries: Map<string, { resources: ReturnType<typeof createAgentConnectionResourceState> }>
  connectionStarts: Map<string, { id: string; promise: Promise<boolean> }>
  sessionTeardowns: Map<string, { id: string; promise: Promise<void>; phase: 'closing' }>
  inFlightBackgroundFlowFlushes: Map<Promise<void>, string>
}

function internals(manager: AgentConnectionManager): ManagerInternals {
  return manager as unknown as ManagerInternals
}

describe('AgentConnectionManager pause / drainInFlight', () => {
  beforeEach(() => BaseService.resetInstances())

  it('suppresses a new connection launch before it can read or create resources', async () => {
    const manager = new AgentConnectionManager()
    const hold = manager.pause('restore')

    await manager.primeConnection('session-1')

    expect(internals(manager).entries).toEqual(new Map())
    expect(internals(manager).connectionStarts).toEqual(new Map())
    hold.dispose()
  })

  it.each(['queued-turn', 'steer-continuation', 'receive-only', 'deferred-turn'])(
    'does not represent Conversation-owned %s work in the resource registry',
    (target) => {
      const manager = new AgentConnectionManager()
      const state = createAgentConnectionResourceState()
      internals(manager).entries.set('session-1', { resources: state })
      const hold = manager.pause(target)

      expect('queue' in state).toBe(false)
      expect('launch' in state).toBe(false)
      expect('deferredTurn' in state).toBe(false)

      hold.dispose()
    }
  )

  it('releases nested pause holds without launching Conversation-owned successor work', () => {
    const manager = new AgentConnectionManager()
    const first = manager.pause('first')
    const last = manager.pause('last')
    const prime = vi.spyOn(manager, 'primeConnection')

    first.dispose()
    first.dispose()
    expect(manager.isWriteQuiesced).toBe(true)
    expect(prime).not.toHaveBeenCalled()

    last.dispose()
    expect(manager.isWriteQuiesced).toBe(false)
    expect(prime).not.toHaveBeenCalled()
  })

  it.each(['connection-start', 'connection-close', 'background-flow'] as const)(
    'drainInFlight observes a running %s operation and its exact owner id',
    async (kind) => {
      const manager = new AgentConnectionManager()
      const gate = deferred<void>()
      const state = internals(manager)
      if (kind === 'connection-start') {
        state.connectionStarts.set('session-1', {
          id: 'start-1',
          promise: gate.promise.then(() => true)
        })
      } else if (kind === 'connection-close') {
        state.sessionTeardowns.set('session-1', { id: 'close-1', promise: gate.promise, phase: 'closing' })
      } else {
        state.inFlightBackgroundFlowFlushes.set(gate.promise, 'session-1:flow-1')
      }
      const hold = manager.pause('restore')

      const early = await manager.drainInFlight({ timeoutMs: 0 })
      expect(early.stragglerIds).toEqual([
        kind === 'connection-start'
          ? 'connection-start:session-1:start-1'
          : kind === 'connection-close'
            ? 'connection-close:session-1:close-1'
            : 'background-flow:session-1:flow-1'
      ])

      gate.resolve()
      await expect(manager.drainInFlight({ timeoutMs: 100 })).resolves.toEqual({ stragglerIds: [] })
      hold.dispose()
    }
  )

  it('registers a connection launch synchronously and reports a non-aborted straggler on timeout', async () => {
    const manager = new AgentConnectionManager()
    const gate = deferred<boolean>()
    internals(manager).connectionStarts.set('session-1', { id: 'start-1', promise: gate.promise })
    const hold = manager.pause('restore')

    await expect(manager.drainInFlight({ timeoutMs: 0 })).resolves.toEqual({
      stragglerIds: ['connection-start:session-1:start-1']
    })
    expect(internals(manager).connectionStarts.has('session-1')).toBe(true)

    gate.resolve(true)
    internals(manager).connectionStarts.delete('session-1')
    await expect(manager.drainInFlight({ timeoutMs: 100 })).resolves.toEqual({ stragglerIds: [] })
    hold.dispose()
  })

  it('drains a detached-flow finalizer after its runtime entry closes', async () => {
    const manager = new AgentConnectionManager()
    const gate = deferred<void>()
    internals(manager).inFlightBackgroundFlowFlushes.set(gate.promise, 'session-1:flow-1')
    const hold = manager.pause('restore')

    const draining = manager.drainInFlight({ timeoutMs: 5_000 })
    let settled = false
    void draining.then(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)

    gate.resolve()
    await expect(draining).resolves.toEqual({ stragglerIds: [] })
    hold.dispose()
  })

  it('drops idle connection work for a session closed while paused', async () => {
    const manager = new AgentConnectionManager()
    internals(manager).entries.set('session-1', { resources: createAgentConnectionResourceState() })
    const close = vi.spyOn(manager, 'closeSession').mockImplementation(async (sessionId) => {
      internals(manager).entries.delete(sessionId)
    })

    const hold = manager.pause('restore')
    await vi.waitFor(() => expect(close).toHaveBeenCalledWith('session-1'))
    hold.dispose()

    expect(internals(manager).entries.has('session-1')).toBe(false)
  })

  it('lists connection state-machine work without treating an idle session as active', () => {
    const manager = new AgentConnectionManager()
    internals(manager).entries.set('idle', { resources: createAgentConnectionResourceState() })
    internals(manager).entries.set('live', {
      resources: createAgentConnectionResourceState({ turnId: 'turn-1' } as never)
    })

    expect(manager.listActiveWork()).toEqual([
      expect.objectContaining({ id: 'live', summary: expect.stringContaining('generation=turn') })
    ])
  })
})
