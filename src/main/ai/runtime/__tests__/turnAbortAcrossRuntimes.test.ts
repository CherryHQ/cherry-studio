import { describe, expect, it, vi } from 'vitest'

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
})
