import { describe, expect, it, vi } from 'vitest'

import { PiRuntimeConnection } from '../pi/PiRuntimeConnection'

const input = { sessionId: 'session-1', agentId: 'agent-1', modelId: 'provider::model' } as never

function confirmedInterrupt(settle: () => void) {
  return vi.fn(async () => {
    settle()
    return { status: 'confirmed' as const, value: { effect: 'requested' as const } }
  })
}

describe('runtime turn abort without session teardown', () => {
  it('asks Pi to interrupt its active turn and retains the runtime', async () => {
    const connection = new PiRuntimeConnection(input)
    const handle = { interrupt: confirmedInterrupt(() => ((connection as any).active = false)) }
    ;(connection as any).handle = handle
    ;(connection as any).active = true
    ;(connection as any).sending = true

    await expect(connection.abortTurn()).resolves.toBe(true)
    expect(handle.interrupt).toHaveBeenCalledOnce()
    expect((connection as any).handle).toBe(handle)
    expect((connection as any).closing).toBe(false)
  })

  it('resolves a stop on a warm Pi connection whose turn already settled', async () => {
    const connection = new PiRuntimeConnection(input)
    const handle = {
      interrupt: vi.fn(async () => ({ status: 'confirmed' as const, value: { effect: 'requested' as const } }))
    }
    ;(connection as any).handle = handle
    ;(connection as any).active = false

    // A re-dispatched user stop finds the turn already gone: declining here would fall back to
    // the teardown of a runtime a prior stop preserved.
    await expect(connection.abortTurn()).resolves.toBe(true)
    expect(handle.interrupt).not.toHaveBeenCalled()
    expect((connection as any).closing).toBe(false)
  })

  it('cancels an in-flight manual Pi /compact turn instead of reporting a no-op stop', async () => {
    const connection = new PiRuntimeConnection(input)
    // The Pi handle's interrupt aborts both the agent loop and the compaction controller.
    const handle = {
      interrupt: confirmedInterrupt(() => ((connection as any).manualCompactInFlight = false))
    }
    ;(connection as any).handle = handle
    ;(connection as any).active = false
    ;(connection as any).manualCompactInFlight = true

    // A /compact turn is live without an active prompt run: the stop must interrupt the
    // compaction and wait for it to settle, not succeed while compaction keeps running.
    await expect(connection.abortTurn()).resolves.toBe(true)
    expect(handle.interrupt).toHaveBeenCalledOnce()
    expect((connection as any).manualCompactInFlight).toBe(false)
    expect((connection as any).closing).toBe(false)
  })
})
