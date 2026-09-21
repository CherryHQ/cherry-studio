import { describe, expect, it, vi } from 'vitest'

import { DshRuntimeConnection } from '../dsh/DshRuntimeConnection'
import { PiRuntimeConnection } from '../pi/PiRuntimeConnection'

const input = { sessionId: 'session-1', agentId: 'agent-1', modelId: 'provider::model' } as never

describe('runtime turn abort without session teardown', () => {
  it('asks Pi to abort its prompt and retains the session', async () => {
    const connection = new PiRuntimeConnection(input)
    const session = {
      abort: vi.fn(async () => {
        ;(connection as any).promptRunActive = false
      })
    }
    ;(connection as any).session = session
    ;(connection as any).promptRunActive = true

    await expect(connection.abortTurn()).resolves.toBe(true)
    expect(session.abort).toHaveBeenCalledOnce()
    expect((connection as any).session).toBe(session)
    expect((connection as any).closed).toBe(false)
  })

  it('resolves a stop on a warm Pi connection whose turn already settled', async () => {
    const connection = new PiRuntimeConnection(input)
    const session = { abort: vi.fn(async () => {}) }
    ;(connection as any).session = session
    ;(connection as any).promptRunActive = false

    // A re-dispatched user stop finds the turn already gone: declining here would fall back to
    // the teardown of a runtime a prior stop preserved.
    await expect(connection.abortTurn()).resolves.toBe(true)
    expect(session.abort).not.toHaveBeenCalled()
    expect((connection as any).closed).toBe(false)
  })

  it('cancels an in-flight manual Pi /compact turn instead of reporting a no-op stop', async () => {
    const connection = new PiRuntimeConnection(input)
    const session = {
      // Faithful to pi 0.80.3: `abort()` only aborts the agent loop and never touches the
      // compaction controller; only `abortCompaction()` settles it (aborted compaction_end,
      // which clears the in-flight flag).
      abort: vi.fn(async () => {}),
      abortCompaction: vi.fn(() => {
        ;(connection as any).manualCompactInFlight = false
      })
    }
    ;(connection as any).session = session
    ;(connection as any).promptRunActive = false
    ;(connection as any).manualCompactInFlight = true

    // A /compact turn is live without an active prompt run: the stop must target pi's
    // compaction controller and wait for the compaction to settle, not succeed while
    // compaction keeps running.
    await expect(connection.abortTurn()).resolves.toBe(true)
    expect(session.abortCompaction).toHaveBeenCalledOnce()
    expect(session.abort).not.toHaveBeenCalled()
    expect((connection as any).manualCompactInFlight).toBe(false)
    expect((connection as any).closed).toBe(false)
  })

  it('cancels only DSH main session and retains its bridge', async () => {
    const connection = new DshRuntimeConnection(input)
    const bridge = {
      request: vi.fn(async () => {
        ;(connection as any).turnActive = false
      })
    }
    ;(connection as any).bridge = bridge
    ;(connection as any).turnActive = true

    await expect(connection.abortTurn()).resolves.toBe(true)
    expect(bridge.request).toHaveBeenCalledWith('session/cancel', { sessionId: 'session-1' }, { timeoutMs: 5_000 })
    expect((connection as any).bridge).toBe(bridge)
    expect((connection as any).closed).toBe(false)
  })
})
