/* oxlint-disable typescript/no-unnecessary-type-assertion -- cast-heavy driver fakes */
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAgent: vi.fn(() => ({ configuration: { fallback_model_ids: ['backup::model'] } })),
  readRetryPolicy: vi.fn(() => ({ enabled: false, maxAttempts: 3, backoffEnabled: true, fallbackModelIds: [] })),
  getByProviderId: vi.fn((providerId: string) => ({ id: providerId, isEnabled: true })),
  getByKey: vi.fn((providerId: string, modelId: string) => ({ id: modelId, providerId }))
}))

vi.mock('@data/services/AgentService', () => ({ agentService: { getAgent: mocks.getAgent } }))
vi.mock('@data/services/ProviderService', () => ({ providerService: { getByProviderId: mocks.getByProviderId } }))
vi.mock('@data/services/ModelService', () => ({ modelService: { getByKey: mocks.getByKey } }))
vi.mock('../aiSdk', () => ({ readRetryPolicy: mocks.readRetryPolicy }))

import { AgentSessionFallbackConnection, classifyRuntimeFallbackError } from '../AgentSessionFallbackConnection'
import { AsyncEventQueue } from '../AsyncEventQueue'
import type { AgentRuntimeConnection, AgentRuntimeEvent, AgentSessionRuntimeDriver } from '../types'

function fakeConnection(usageCapture = 'capture') {
  const events = new AsyncEventQueue<AgentRuntimeEvent>()
  const close = vi.fn(async () => events.close())
  const send = vi.fn()
  return {
    events,
    close,
    send,
    usageCapture,
    redirect: vi.fn(() => false),
    reconcile: vi.fn(async () => 'current' as const)
  }
}

describe('fallback error classification', () => {
  it('routes on structured provider facts rather than the prose beside them', () => {
    expect(classifyRuntimeFallbackError({ message: 'disk quota exceeded', status: 429 })).toBe('http 429')
    expect(classifyRuntimeFallbackError({ message: 'rate limit exceeded', status: 400 })).toBeUndefined()
    expect(classifyRuntimeFallbackError({ message: 'quota exceeded', code: 'AUTH' })).toBeUndefined()
    expect(classifyRuntimeFallbackError({ code: 'RATE_LIMITED' })).toBe('rate_limited')
    expect(classifyRuntimeFallbackError({ code: 'QUOTA' })).toBe('quota')
    expect(classifyRuntimeFallbackError({ code: 'HTTP_503' })).toBe('http 503')
    expect(classifyRuntimeFallbackError({ code: 'HTTP_404' })).toBeUndefined()
  })

  it('reads the serializable facts an LlmError keeps beside itself', () => {
    expect(classifyRuntimeFallbackError({ failure: { message: 'provider failed', code: 'SERVER', status: 529 } })).toBe(
      'http 529'
    )
    expect(classifyRuntimeFallbackError({ failure: { message: 'provider failed', code: 'TRANSPORT' } })).toBe(
      'transport'
    )
  })

  it('names a provider outcome in prose before treating it as one', () => {
    // Pi reports a provider failure as prose only, so its messages must still qualify.
    expect(classifyRuntimeFallbackError(new Error('API Error: 429 {"type":"rate_limit_error"}'))).toBe('http 429')
    expect(classifyRuntimeFallbackError(new Error('429 Too Many Requests'))).toBe('429 Too Many Requests')
    expect(classifyRuntimeFallbackError(new Error('500 Internal Server Error'))).toBe('http 500')
    expect(classifyRuntimeFallbackError({ message: 'HTTP 503 service overloaded', code: 'UNKNOWN' })).toBe('http 503')
    expect(classifyRuntimeFallbackError(new Error('rate limit exceeded for gpt-x'))).toBe(
      'rate limit exceeded for gpt-x'
    )
    // The same vocabulary also describes runtime, gateway, and local failures; failing over there
    // would replay the whole turn on another model for a problem no provider caused.
    expect(classifyRuntimeFallbackError(new Error('EDQUOT: disk quota exceeded'))).toBeUndefined()
    expect(classifyRuntimeFallbackError(new Error('listen EADDRINUSE: address already in use :::500'))).toBeUndefined()
    expect(classifyRuntimeFallbackError(new Error('gateway returned 502 while proxying the request'))).toBeUndefined()
    expect(classifyRuntimeFallbackError(new Error('worker overload protection triggered'))).toBeUndefined()
  })
})

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

  it('does not replay the turn on another model for a local runtime failure', async () => {
    const primary = fakeConnection()
    const driver = { connect: vi.fn() }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
      primary as unknown as AgentRuntimeConnection
    )
    await wrapper.send({ message: { id: 'u1' } } as never)
    primary.events.push({ type: 'error', error: new Error('listen EADDRINUSE: address already in use :::500') })

    const iterator = wrapper.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'error' } })
    // Replaying on another model is the harm here: a local bind failure is not the provider's.
    expect(driver.connect).not.toHaveBeenCalled()
    await wrapper.close()
  })

  it('reconnects the fallback with trace metadata naming the fallback model', async () => {
    const primary = fakeConnection()
    const fallback = fakeConnection()
    const driver = { connect: vi.fn(async () => fallback) }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      {
        sessionId: 's1',
        agentId: 'a1',
        modelId: 'primary::model',
        trace: {
          topicId: 'agent-session:s1',
          traceId: 'trace-1',
          rootSpanId: 'root-1',
          sessionId: 's1',
          turnId: 'turn-1',
          modelName: 'primary-model'
        }
      } as never,
      primary as unknown as AgentRuntimeConnection
    )
    const userInput = { message: { id: 'u1' } } as never
    await wrapper.send(userInput)
    primary.events.push({ type: 'error', error: new Error('HTTP 429 rate limit') })

    const iterator = wrapper.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'chunk' } })

    // The fallback's spans must attribute to the model that will actually run, not the primary
    // whose trace container it inherits; the container ids stay stable within the turn.
    expect(driver.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'backup::model',
        trace: expect.objectContaining({ modelName: 'model', traceId: 'trace-1', turnId: 'turn-1' })
      })
    )
    await wrapper.close()
  })

  it('does not announce a fallback whose replay is rejected', async () => {
    const primary = fakeConnection()
    const fallback = fakeConnection()
    // DSH reports a rejected submission in-stream and throws it; both must reach the wrapper.
    fallback.send.mockImplementationOnce(async () => {
      fallback.events.push({ type: 'error', error: new Error('replay admission failed') })
      throw new Error('replay admission failed')
    })
    const driver = { connect: vi.fn(async () => fallback) }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
      primary as unknown as AgentRuntimeConnection
    )
    await wrapper.send({ message: { id: 'u1' } } as never)
    primary.events.push({ type: 'error', error: new Error('HTTP 429 rate limit') })

    const seen: AgentRuntimeEvent[] = []
    for await (const event of wrapper.events) seen.push(event)

    expect(seen).not.toContainEqual(
      expect.objectContaining({ type: 'chunk', chunk: expect.objectContaining({ type: 'data-model-fallback' }) })
    )
    expect(seen).toContainEqual(expect.objectContaining({ type: 'error' }))
    // A rejected replay owns no slot in the wrapper: it must not outlive the failed attempt.
    expect(fallback.close).toHaveBeenCalled()
    await wrapper.close()
  })

  it('does not report the session closed while a rebuild is still being created', async () => {
    const primary = fakeConnection()
    const fallback = fakeConnection()
    let releaseConnect!: () => void
    const driver = {
      connect: vi.fn(
        () =>
          new Promise<AgentRuntimeConnection>((resolve) => {
            releaseConnect = () => resolve(fallback as unknown as AgentRuntimeConnection)
          })
      )
    }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
      primary as unknown as AgentRuntimeConnection
    )
    await wrapper.send({ message: { id: 'u1' } } as never)
    primary.events.push({ type: 'error', error: new Error('HTTP 429 rate limit') })
    await vi.waitFor(() => expect(driver.connect).toHaveBeenCalled())

    let closed = false
    const closing = wrapper.close().then(() => {
      closed = true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    // The rebuild is not even created yet: reporting completion here hands the host a session whose
    // replacement runtime is still starting, and it holds resources that close() was asked to release.
    expect(closed).toBe(false)

    releaseConnect()
    await closing
    expect(fallback.close).toHaveBeenCalled()
  })

  it('does not report the session closed while the replacement teardown is still running', async () => {
    const primary = fakeConnection()
    const fallback = fakeConnection()
    let releaseConnect!: () => void
    const driver = {
      connect: vi.fn(
        () =>
          new Promise<AgentRuntimeConnection>((resolve) => {
            releaseConnect = () => resolve(fallback as unknown as AgentRuntimeConnection)
          })
      )
    }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
      primary as unknown as AgentRuntimeConnection
    )
    await wrapper.send({ message: { id: 'u1' } } as never)
    primary.events.push({ type: 'error', error: new Error('HTTP 429 rate limit') })
    await vi.waitFor(() => expect(driver.connect).toHaveBeenCalled())

    let releaseReplacementClose!: () => void
    fallback.close.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseReplacementClose = resolve
        })
    )

    let closed = false
    const closing = wrapper.close().then(() => {
      closed = true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    releaseConnect()
    await vi.waitFor(() => expect(fallback.close).toHaveBeenCalled())

    // The Stop raced the rebuild into discard(): the replacement's own shutdown (DSH cancellation,
    // client and bridge teardown) is still running, so resolving here would release the host's
    // closing barrier and let a new connection start mid-cleanup.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(closed).toBe(false)

    releaseReplacementClose()
    await closing
    // The teardown ran once inside discard(); close() must join it, not duplicate it.
    expect(fallback.close).toHaveBeenCalledTimes(1)
  })

  it('rebuilds the fallback on the refreshed trace context, not the constructor frozen one', async () => {
    const primary = fakeConnection()
    const fallback = fakeConnection()
    const driver = { connect: vi.fn(async () => fallback) }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      {
        sessionId: 's1',
        agentId: 'a1',
        modelId: 'primary::model',
        trace: {
          topicId: 'agent-session:s1',
          traceId: 'trace-1',
          rootSpanId: 'root-1',
          sessionId: 's1',
          turnId: '',
          modelName: 'primary-model'
        }
      } as never,
      primary as unknown as AgentRuntimeConnection
    )
    // Idle priming built the wrapper with no live turn; the host refreshes tracing on turn
    // admission, and the fallback must inherit that refresh — replaying the frozen context would
    // file the fallback spans under an empty turnId.
    void wrapper.refreshTraceContext({
      topicId: 'agent-session:s1',
      traceId: 'trace-1',
      rootSpanId: 'root-1',
      sessionId: 's1',
      turnId: 'turn-9',
      modelName: 'primary-model'
    })
    await wrapper.send({ message: { id: 'u1' } } as never)
    primary.events.push({ type: 'error', error: new Error('HTTP 429 rate limit') })

    const iterator = wrapper.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'chunk' } })

    expect(driver.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        trace: expect.objectContaining({ turnId: 'turn-9', modelName: 'model' })
      })
    )
    await wrapper.close()
  })

  it('tears down the rebuilt connection when the session closes during its slow replay submission', async () => {
    const primary = fakeConnection('primary capture')
    const fallback = fakeConnection('fallback capture')
    let releaseSend!: () => void
    fallback.send.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseSend = resolve
      })
    })
    const driver = { connect: vi.fn(async () => fallback) }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
      primary as unknown as AgentRuntimeConnection
    )
    await wrapper.send({ message: { id: 'u1' } } as never)
    primary.events.push({ type: 'error', error: new Error('HTTP 429 rate limit') })
    await vi.waitFor(() => expect(fallback.send).toHaveBeenCalled())

    await wrapper.close()

    // The rebuilt connection is already doing this session's work but is not `current` yet, so a
    // close that only tears down `current` would leak it — and a late swap would revive it.
    expect(fallback.close).toHaveBeenCalled()
    expect(wrapper.usageCapture).toBe('primary capture')
    releaseSend()

    const seen: AgentRuntimeEvent[] = []
    for await (const event of wrapper.events) seen.push(event)
    expect(seen).not.toContainEqual(
      expect.objectContaining({ type: 'chunk', chunk: expect.objectContaining({ type: 'data-model-fallback' }) })
    )
    expect(wrapper.usageCapture).toBe('primary capture')
  })

  it('reports a rejected submission in-stream instead of rejecting the host send', async () => {
    const primary = fakeConnection()
    primary.send.mockImplementationOnce(async () => {
      primary.events.push({ type: 'error', error: new Error('HTTP 429 rate limit') })
      throw new Error('HTTP 429 rate limit')
    })
    mocks.getAgent.mockReturnValueOnce({ configuration: {} } as never)
    const driver = { connect: vi.fn() }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
      primary as unknown as AgentRuntimeConnection
    )

    // The error event is the host's single failure channel; a rejecting send would double-report.
    await expect(wrapper.send({ message: { id: 'u1' } } as never)).resolves.toBeUndefined()
    const iterator = wrapper.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'error' } })
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

  it('still falls back when the failed turn emitted only usage metadata', async () => {
    const primary = fakeConnection()
    const fallback = fakeConnection()
    const driver = { connect: vi.fn(async () => fallback) }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
      primary as unknown as AgentRuntimeConnection
    )
    await wrapper.send({ message: { id: 'u1' } } as never)
    // Pi projects `turn_end` usage as a `message-metadata` chunk; a provider turn can emit that
    // (tokens were consumed) and still fail before streaming anything user-visible.
    primary.events.push({
      type: 'chunk',
      chunk: { type: 'message-metadata', messageMetadata: { totalTokens: 12 } }
    } as never)
    primary.events.push({ type: 'error', error: new Error('HTTP 429 rate limit') })

    const iterator = wrapper.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'chunk', chunk: { type: 'message-metadata' } }
    })
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'chunk', chunk: { type: 'data-model-fallback' } }
    })
    expect(driver.connect).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'backup::model' }))
    await wrapper.close()
  })

  it('does not replay the original prompt once a steer has moved the turn into a continuation', async () => {
    const primary = fakeConnection()
    primary.redirect.mockReturnValue(true)
    const driver = { connect: vi.fn() }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
      primary as unknown as AgentRuntimeConnection
    )
    await wrapper.send({ message: { id: 'u1' } } as never)
    wrapper.redirect({ message: { id: 'u2' } } as never)
    primary.events.push({ type: 'error', error: new Error('HTTP 429 rate limit') })

    const iterator = wrapper.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'error' } })
    expect(driver.connect).not.toHaveBeenCalled()
    await wrapper.close()
  })

  it('suppresses fallback when user-visible content already streamed', async () => {
    const primary = fakeConnection()
    const driver = { connect: vi.fn() }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
      primary as unknown as AgentRuntimeConnection
    )
    await wrapper.send({ message: { id: 'u1' } } as never)
    primary.events.push({ type: 'chunk', chunk: { type: 'text-delta', id: 't1', delta: 'partial' } } as never)
    primary.events.push({ type: 'error', error: new Error('HTTP 429 rate limit') })

    const iterator = wrapper.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'chunk', chunk: { type: 'text-delta' } } })
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'error' } })
    expect(driver.connect).not.toHaveBeenCalled()
    await wrapper.close()
  })
})
