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

describe('AgentConnectionManager backup quiescence', () => {
  beforeEach(() => BaseService.resetInstances())

  it('closes idle warm connections when the first pause barrier opens', () => {
    const manager = new AgentConnectionManager()
    const internals = manager as unknown as {
      entries: Map<string, { resources: ReturnType<typeof createAgentConnectionResourceState> }>
    }
    internals.entries.set('session-1', { resources: createAgentConnectionResourceState() })
    const close = vi.spyOn(manager, 'closeSession').mockResolvedValue()

    const hold = manager.pause('backup')

    expect(close).toHaveBeenCalledWith('session-1')
    hold.dispose()
  })

  it('drains connection descendants to a fixed point with stable operation ids', async () => {
    const manager = new AgentConnectionManager()
    const start = deferred<boolean>()
    const close = deferred<void>()
    const internals = manager as unknown as {
      connectionStarts: Map<string, { id: string; promise: Promise<boolean> }>
      connectionCloses: Map<string, { sessionId: string; promise: Promise<void> }>
    }
    internals.connectionStarts.set('session-1', { id: 'start-1', promise: start.promise })
    const hold = manager.pause('backup')
    const draining = manager.drainInFlight({ timeoutMs: 5_000 })
    let drained = false
    void draining.then(() => {
      drained = true
    })

    internals.connectionCloses.set('close-1', { sessionId: 'session-1', promise: close.promise })
    start.resolve(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(drained).toBe(false)

    close.resolve()
    await expect(draining).resolves.toEqual({ stragglerIds: [] })
    hold.dispose()
  })

  it('reports the exact connection operation when drain times out', async () => {
    const manager = new AgentConnectionManager()
    const close = deferred<void>()
    const internals = manager as unknown as {
      connectionCloses: Map<string, { sessionId: string; promise: Promise<void> }>
    }
    internals.connectionCloses.set('close-1', { sessionId: 'session-1', promise: close.promise })
    const hold = manager.pause('backup')

    await expect(manager.drainInFlight({ timeoutMs: 0 })).resolves.toEqual({
      stragglerIds: ['connection-close:session-1:close-1']
    })

    close.resolve()
    hold.dispose()
  })
})
