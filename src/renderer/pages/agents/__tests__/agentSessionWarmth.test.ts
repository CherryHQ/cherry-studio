import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ipcRequest = vi.hoisted(() =>
  vi.fn<(channel: string, payload?: unknown) => Promise<undefined>>(() => Promise.resolve(undefined))
)

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcRequest }
}))

import { retainAgentSessionWarmth } from '../agentSessionWarmth'

describe('retainAgentSessionWarmth', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    // Drain any pending delayed closes so state does not leak across tests.
    vi.runAllTimers()
    vi.useRealTimers()
    ipcRequest.mockClear()
  })

  it('prewarms on first retain and closes only after the grace period', () => {
    const release = retainAgentSessionWarmth('s1')
    expect(ipcRequest).toHaveBeenCalledWith('ai.agent.session.prewarm', { sessionId: 's1' })

    release()
    expect(ipcRequest).not.toHaveBeenCalledWith('ai.agent.session.close_warm', { sessionId: 's1' })

    vi.runAllTimers()
    expect(ipcRequest).toHaveBeenCalledWith('ai.agent.session.close_warm', { sessionId: 's1' })
  })

  it('does not thrash IPC across a release/re-retain cycle (Activity tab switch)', () => {
    const release = retainAgentSessionWarmth('s1')
    ipcRequest.mockClear()

    release()
    const rerelease = retainAgentSessionWarmth('s1')
    vi.runAllTimers()

    expect(ipcRequest).not.toHaveBeenCalled()
    rerelease()
    vi.runAllTimers()
    expect(ipcRequest).toHaveBeenCalledWith('ai.agent.session.close_warm', { sessionId: 's1' })
  })

  it('keeps the session warm while any retainer remains', () => {
    const releaseA = retainAgentSessionWarmth('s1')
    const releaseB = retainAgentSessionWarmth('s1')
    expect(ipcRequest).toHaveBeenCalledTimes(1)

    releaseA()
    vi.runAllTimers()
    expect(ipcRequest).not.toHaveBeenCalledWith('ai.agent.session.close_warm', { sessionId: 's1' })

    releaseB()
    vi.runAllTimers()
    expect(ipcRequest).toHaveBeenCalledWith('ai.agent.session.close_warm', { sessionId: 's1' })
  })

  it('release is idempotent', () => {
    const release = retainAgentSessionWarmth('s1')
    release()
    release()
    vi.runAllTimers()

    const closeCalls = ipcRequest.mock.calls.filter(([channel]) => channel === 'ai.agent.session.close_warm')
    expect(closeCalls).toHaveLength(1)
  })

  it('tracks sessions independently', () => {
    const releaseA = retainAgentSessionWarmth('s1')
    retainAgentSessionWarmth('s2')
    expect(ipcRequest).toHaveBeenCalledWith('ai.agent.session.prewarm', { sessionId: 's1' })
    expect(ipcRequest).toHaveBeenCalledWith('ai.agent.session.prewarm', { sessionId: 's2' })

    releaseA()
    vi.runAllTimers()
    expect(ipcRequest).toHaveBeenCalledWith('ai.agent.session.close_warm', { sessionId: 's1' })
    expect(ipcRequest).not.toHaveBeenCalledWith('ai.agent.session.close_warm', { sessionId: 's2' })
  })
})
