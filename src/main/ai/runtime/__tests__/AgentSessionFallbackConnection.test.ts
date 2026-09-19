/* oxlint-disable typescript/no-unnecessary-type-assertion -- cast-heavy driver fakes */
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAgent: vi.fn(() => ({ configuration: { fallback_model_ids: ['backup::model'] } })),
  readRetryPolicy: vi.fn(() => ({ enabled: false, maxAttempts: 3, backoffEnabled: true, fallbackModelIds: [] }))
}))

vi.mock('@data/services/AgentService', () => ({ agentService: { getAgent: mocks.getAgent } }))
vi.mock('../aiSdk', () => ({ readRetryPolicy: mocks.readRetryPolicy }))

import { AgentSessionFallbackConnection, classifyRuntimeFallbackError } from '../AgentSessionFallbackConnection'
import { AsyncEventQueue } from '../AsyncEventQueue'
import type { AgentRuntimeConnection, AgentRuntimeEvent, AgentSessionRuntimeDriver } from '../types'

function fakeConnection() {
  const events = new AsyncEventQueue<AgentRuntimeEvent>()
  const close = vi.fn(async () => events.close())
  const send = vi.fn()
  return { events, close, send, reconcile: vi.fn(async () => 'current' as const) }
}

describe('Pi/DSH connection fallback', () => {
  it('classifies retryable provider failures without swallowing ordinary errors', () => {
    expect(classifyRuntimeFallbackError(new Error('HTTP 429 rate limit'))).toBe('http 429')
    expect(classifyRuntimeFallbackError(new Error('invalid workspace'))).toBeUndefined()
  })

  it('rebuilds once on the agent fallback model and replays the same turn', async () => {
    const primary = fakeConnection()
    const fallback = fakeConnection()
    const driver = { connect: vi.fn(async () => fallback) }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
      primary as unknown as AgentRuntimeConnection
    )
    const userInput = { message: { id: 'u1' } } as never
    await wrapper.send(userInput)
    primary.events.push({ type: 'error', error: new Error('HTTP 429 rate limit') })

    const iterator = wrapper.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({
      value: {
        type: 'chunk',
        chunk: { type: 'data-model-fallback', data: { from: 'primary::model', to: 'backup::model' } }
      }
    })
    expect(driver.connect).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'backup::model' }))
    expect(fallback.send).toHaveBeenCalledWith(userInput)
    fallback.events.push({ type: 'turn-complete' })
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'turn-complete' } })
    await wrapper.close()
  })

  it("does not replay a completed turn's input when a later driver-driven failure fires", async () => {
    const primary = fakeConnection()
    const driver = { connect: vi.fn() }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
      primary as unknown as AgentRuntimeConnection
    )
    await wrapper.send({ message: { id: 'u1' } } as never)
    primary.events.push({ type: 'turn-complete' })
    primary.events.push({ type: 'error', error: new Error('HTTP 429 rate limit') })

    const iterator = wrapper.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'turn-complete' } })
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'error' } })
    expect(driver.connect).not.toHaveBeenCalled()
    await wrapper.close()
  })

  it('does not replay a queued host input when autonomous generation fails before turn completion', async () => {
    const primary = fakeConnection()
    const driver = { connect: vi.fn() }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
      primary as unknown as AgentRuntimeConnection
    )
    await wrapper.send({ message: { id: 'queued-user-input' } } as never)
    primary.events.push({ type: 'autonomous-turn-state', state: 'started', origin: { kind: 'goal-round', round: 1 } })
    primary.events.push({ type: 'error', error: new Error('HTTP 429 rate limit') })

    const iterator = wrapper.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'autonomous-turn-state', state: 'started' } })
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'error' } })
    expect(driver.connect).not.toHaveBeenCalled()
    await wrapper.close()
  })

  it('keeps a connection with live background work instead of tearing it down for fallback', async () => {
    const primary = fakeConnection()
    const driver = { connect: vi.fn() }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
      primary as unknown as AgentRuntimeConnection
    )
    await wrapper.send({ message: { id: 'u1' } } as never)
    primary.events.push({ type: 'background-work-state', active: true })
    primary.events.push({ type: 'error', error: new Error('HTTP 429') })
    const iterator = wrapper.events[Symbol.asyncIterator]()
    await iterator.next()
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'error' } })
    expect(driver.connect).not.toHaveBeenCalled()
    await wrapper.close()
  })
})
