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

import { AsyncEventQueue } from '@shared/utils/async'

import { AgentSessionFallbackConnection, classifyRuntimeFallbackError } from '../AgentSessionFallbackConnection'
import type {
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimePermissionPolicy,
  AgentRuntimePromptPolicy,
  AgentRuntimeReconcileResult,
  AgentSessionRuntimeDriver
} from '../types'

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
    reconcile: vi.fn(async (): Promise<AgentRuntimeReconcileResult> => 'current'),
    getPermissionPolicy: vi.fn(
      (): AgentRuntimePermissionPolicy => ({
        permissionMode: 'default',
        disabledTools: []
      })
    ),
    getPromptPolicy: vi.fn((): AgentRuntimePromptPolicy => ({ instructions: null }))
  }
}

/**
 * The events a wrapper emits up to its next quiescent moment. A declined swap never closes the
 * stream (the primary's queue is still live), so a `for await` over it would hang instead of failing.
 */
async function collectEvents(wrapper: AgentSessionFallbackConnection): Promise<AgentRuntimeEvent[]> {
  const seen: AgentRuntimeEvent[] = []
  const iterator = wrapper.events[Symbol.asyncIterator]()
  while (true) {
    const next = await Promise.race([iterator.next(), new Promise<'quiet'>((r) => setTimeout(() => r('quiet'), 50))])
    if (next === 'quiet') return seen
    if (next.done) return seen
    seen.push(next.value)
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
    // `429 Too Many Requests` is the wire's status line, so it names the status itself.
    expect(classifyRuntimeFallbackError(new Error('429 Too Many Requests'))).toBe('http 429')
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

  it('recognises the bare status line Pi 1.0.0 forwards for an ordinary HTTP failure', () => {
    // Pi emits `502 Bad Gateway` verbatim — no envelope, no provider vocabulary — yet the leading
    // status with its reason phrase is the provider's own verdict, and content-free failure must
    // still reach the backup.
    expect(classifyRuntimeFallbackError(new Error('502 Bad Gateway'))).toBe('http 502')
    expect(classifyRuntimeFallbackError(new Error('503 Service Unavailable'))).toBe('http 503')
    expect(classifyRuntimeFallbackError(new Error('429 Too Many Requests'))).toBe('http 429')
    // A status that merely appears beside other prose is not the line itself.
    expect(classifyRuntimeFallbackError(new Error('gateway returned 502 while proxying the request'))).toBeUndefined()
    expect(classifyRuntimeFallbackError(new Error('500 items failed validation'))).toBeUndefined()
  })

  it('recognises the provider envelope Pi’s Anthropic adapter stringifies', () => {
    // The pinned Pi adapter rejects with an ordinary Error whose message is the provider body.
    expect(
      classifyRuntimeFallbackError(
        new Error('529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}')
      )
    ).toBe('http 529')
    expect(classifyRuntimeFallbackError(new Error('503 {"type":"error","error":{"type":"overloaded_error"}}'))).toBe(
      'http 503'
    )
    // The envelope is the provider's own verdict: a non-retryable one must not fall through.
    expect(
      classifyRuntimeFallbackError(new Error('400 {"type":"error","error":{"type":"invalid_request_error"}}'))
    ).toBeUndefined()
  })

  it('recognises the provider envelope even without a status prefix', () => {
    // The streaming adapter can stringify the body alone; its error type is still the verdict.
    expect(
      classifyRuntimeFallbackError(
        new Error('{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}')
      )
    ).toBe('overloaded_error')
    expect(classifyRuntimeFallbackError(new Error('{"type":"error","error":{"type":"rate_limit_error"}}'))).toBe(
      'rate_limit_error'
    )
    // A non-retryable provider type must not fall through to the prose beside it.
    expect(
      classifyRuntimeFallbackError(
        new Error('{"type":"error","error":{"type":"invalid_request_error","message":"429"}}')
      )
    ).toBeUndefined()
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

  it('falls back when an empty text block closes before the provider failure', async () => {
    const primary = fakeConnection()
    const fallback = fakeConnection()
    const driver = { connect: vi.fn(async () => fallback) }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
      primary as unknown as AgentRuntimeConnection
    )
    await wrapper.send({ message: { id: 'u1' } } as never)
    // Pi opens and closes a block before the terminal failure with no delta between them: that
    // boundary shows the user nothing, so the replay cannot duplicate an answer.
    primary.events.push({ type: 'chunk', chunk: { type: 'text-start', id: 't1' } } as never)
    primary.events.push({ type: 'chunk', chunk: { type: 'text-end', id: 't1' } } as never)
    primary.events.push({ type: 'chunk', chunk: { type: 'reasoning-start', id: 'r1' } } as never)
    primary.events.push({ type: 'chunk', chunk: { type: 'reasoning-end', id: 'r1' } } as never)
    primary.events.push({ type: 'error', error: new Error('HTTP 529 overloaded') })

    await vi.waitFor(() => expect(driver.connect).toHaveBeenCalled())
    expect(driver.connect).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'backup::model' }))
    expect(fallback.send).toHaveBeenCalledWith(expect.objectContaining({ message: { id: 'u1' } }))
    await wrapper.close()
  })

  it('replays the turn under the live connection policy, not the re-read agent row', async () => {
    const primary = fakeConnection()
    primary.getPermissionPolicy.mockReturnValue({ permissionMode: 'default', disabledTools: ['bash'] })
    const fallback = fakeConnection()
    const driver = { connect: vi.fn(async () => fallback) }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
      primary as unknown as AgentRuntimeConnection
    )
    await wrapper.send({ message: { id: 'u1' } } as never)
    primary.events.push({ type: 'error', error: new Error('HTTP 429 rate limit') })

    const iterator = wrapper.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'chunk' } })

    // The turn was admitted under default with bash disabled; an agent save during the backoff
    // (e.g. bypassPermissions, or re-enabling bash) must not re-admit the replay under it.
    expect(driver.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionPolicy: { permissionMode: 'default', disabledTools: ['bash'] }
      })
    )
    await wrapper.close()
  })

  it('replays the turn under its admission-time permission mode, not a mid-backoff save', async () => {
    const primary = fakeConnection()
    primary.getPermissionPolicy.mockReturnValue({ permissionMode: 'default', disabledTools: [] })
    const fallback = fakeConnection()
    const driver = { connect: vi.fn(async () => fallback) }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
      primary as unknown as AgentRuntimeConnection
    )
    await wrapper.send({ message: { id: 'u1' } } as never)

    // The user saves bypassPermissions while the live reconcile is still awaiting discovery, so
    // the applied policy already reads bypassPermissions when the fallback drains that save.
    let releaseSave!: () => void
    primary.reconcile.mockImplementationOnce(async () => {
      primary.getPermissionPolicy.mockReturnValue({ permissionMode: 'bypassPermissions', disabledTools: [] })
      await new Promise<void>((resolve) => {
        releaseSave = resolve
      })
      return 'patched'
    })
    const save = wrapper.reconcile({ modelId: 'primary::model' })
    await vi.waitFor(() => expect(releaseSave).toBeTypeOf('function'))

    primary.events.push({ type: 'error', error: new Error('HTTP 503 service overloaded') })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    releaseSave()
    await save

    await vi.waitFor(() => expect(driver.connect).toHaveBeenCalled())
    // The replayed turn keeps the approval requirement it was admitted under; the later save
    // reaches the next fresh turn instead of widening this one into approval-free Bash.
    expect(driver.connect).toHaveBeenCalledWith(
      expect.objectContaining({ permissionPolicy: { permissionMode: 'default', disabledTools: [] } })
    )
    await wrapper.close()
  })

  it('keeps the tools the turn was admitted without when a re-enable crosses the fallback boundary', async () => {
    const primary = fakeConnection()
    // Admitting the turn removed Bash even though the mode is bypassPermissions.
    primary.getPermissionPolicy.mockReturnValue({ permissionMode: 'bypassPermissions', disabledTools: ['bash'] })
    const fallback = fakeConnection()
    const driver = { connect: vi.fn(async () => fallback) }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
      primary as unknown as AgentRuntimeConnection
    )
    await wrapper.send({ message: { id: 'u1' } } as never)

    // The user re-enables Bash while reconciliation awaits snapshot discovery; the loosening
    // applies (and the native turn ends) before that verdict is in.
    let releaseReenable!: () => void
    primary.reconcile.mockImplementationOnce(async () => {
      primary.getPermissionPolicy.mockReturnValue({ permissionMode: 'bypassPermissions', disabledTools: [] })
      await new Promise<void>((resolve) => {
        releaseReenable = resolve
      })
      return 'patched'
    })
    const reenable = wrapper.reconcile({ modelId: 'primary::model' })
    await vi.waitFor(() => expect(releaseReenable).toBeTypeOf('function'))

    primary.events.push({ type: 'error', error: new Error('HTTP 503 service overloaded') })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    releaseReenable()
    await reenable

    await vi.waitFor(() => expect(driver.connect).toHaveBeenCalled())
    // The replay stays inside the host turn that was admitted without Bash: the pending re-enable
    // reaches the next fresh turn, not a turn that already had its approval requirement waived.
    expect(driver.connect).toHaveBeenCalledWith(
      expect.objectContaining({ permissionPolicy: { permissionMode: 'bypassPermissions', disabledTools: ['bash'] } })
    )
    await wrapper.close()
  })

  it('keeps a restriction a save applied before a later re-enable crossed the fallback boundary', async () => {
    const primary = fakeConnection()
    primary.getPermissionPolicy.mockReturnValue({ permissionMode: 'default', disabledTools: [] })
    const fallback = fakeConnection()
    const driver = { connect: vi.fn(async () => fallback) }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
      primary as unknown as AgentRuntimeConnection
    )
    await wrapper.send({ message: { id: 'u1' } } as never)

    // A save disables Bash and settles.
    primary.reconcile.mockImplementationOnce(async () => {
      primary.getPermissionPolicy.mockReturnValue({ permissionMode: 'default', disabledTools: ['bash'] })
      return 'patched'
    })
    await wrapper.reconcile({ modelId: 'primary::model' })

    // Another save re-enables it while reconciliation awaits discovery, so the live policy reads
    // no restriction by the time the fallback drains that save.
    let releaseReenable!: () => void
    primary.reconcile.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseReenable = resolve
      })
      primary.getPermissionPolicy.mockReturnValue({ permissionMode: 'default', disabledTools: [] })
      return 'patched'
    })
    const reenable = wrapper.reconcile({ modelId: 'primary::model' })
    await vi.waitFor(() => expect(releaseReenable).toBeTypeOf('function'))

    primary.events.push({ type: 'error', error: new Error('HTTP 503 service overloaded') })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    releaseReenable()
    await reenable

    await vi.waitFor(() => expect(driver.connect).toHaveBeenCalled())
    // The restriction the turn already served under survives the re-enable for the replay.
    expect(driver.connect).toHaveBeenCalledWith(
      expect.objectContaining({ permissionPolicy: { permissionMode: 'default', disabledTools: ['bash'] } })
    )
    await wrapper.close()
  })

  it('carries a policy save from the replacement startup window into the replayed turn', async () => {
    const primary = fakeConnection()
    primary.getPermissionPolicy.mockReturnValue({ permissionMode: 'default', disabledTools: [] })
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

    // While the replacement startup awaits, the host still reconciles the connection it holds —
    // the wrapper, which forwards to the old connection. The user disables a tool here: without
    // retention, the replacement (and its replay) would never learn of the tightening.
    await wrapper.reconcile({ modelId: 'primary::model' })
    expect(primary.reconcile).toHaveBeenCalledWith({ modelId: 'primary::model' })
    expect(fallback.reconcile).not.toHaveBeenCalled()

    releaseConnect()
    const iterator = wrapper.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'chunk' } })

    // The retained save re-applies to the replacement before the replay is admitted, naming the
    // fallback model; its frozen mode stays `default` and the tool tightening lands.
    expect(fallback.reconcile).toHaveBeenCalledWith({ modelId: 'backup::model' })
    expect(fallback.send).toHaveBeenCalled()
    await wrapper.close()
  })

  it('carries every restriction applied in the startup window, not just the final save', async () => {
    const primary = fakeConnection()
    // Each forwarded save applies on the old connection; the second re-enables what the first
    // disabled, so its final policy names no disabled tool and the row the replacement re-derives
    // cannot recover the restriction — only a carried union of what the window applied can.
    primary.reconcile.mockImplementation(async () => {
      primary.getPermissionPolicy.mockReturnValue({ permissionMode: 'default', disabledTools: ['bash'] })
      return 'patched'
    })
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

    // Two completed saves during the delayed replacement startup: bash disabled, then re-enabled.
    await wrapper.reconcile({ modelId: 'primary::model' })
    primary.reconcile.mockImplementation(async () => {
      primary.getPermissionPolicy.mockReturnValue({ permissionMode: 'default', disabledTools: [] })
      return 'current'
    })
    await wrapper.reconcile({ modelId: 'primary::model' })

    releaseConnect()
    const iterator = wrapper.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'chunk' } })

    // The replay is admitted only under the union of what the window applied: bash stays disabled
    // on the replacement even though the saved row has it enabled again.
    expect(fallback.reconcile).toHaveBeenCalledWith({ modelId: 'backup::model', carriedDisabledTools: ['bash'] })
    expect(fallback.send).toHaveBeenCalled()
    await wrapper.close()
  })

  it('drains a tool disable that was still being applied when the fallback started', async () => {
    const primary = fakeConnection()
    primary.getPermissionPolicy.mockReturnValue({ permissionMode: 'default', disabledTools: [] })
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

    // The user disables `write` while the live turn is executing. The save reaches the old
    // connection, whose reconcile does not settle until its skill discovery finishes.
    let releaseSave!: () => void
    primary.reconcile.mockImplementation(async () => {
      primary.getPermissionPolicy.mockReturnValue({ permissionMode: 'default', disabledTools: ['write'] })
      await new Promise<void>((resolve) => {
        releaseSave = resolve
      })
      return 'patched'
    })
    const inFlightSave = wrapper.reconcile({ modelId: 'primary::model' })
    // The save has applied the disable but has not reported back yet.
    await vi.waitFor(() => expect(primary.getPermissionPolicy().disabledTools).toEqual(['write']))

    // A content-free 503 lands while that save is still awaiting discovery.
    primary.events.push({ type: 'error', error: new Error('HTTP 503 service overloaded') })
    // The fallback must not capture the turn policy until the pending save's verdict is in, so it
    // waits here — releasing it is what lets the replacement startup reach its connect.
    await vi.waitFor(() => expect(releaseSave).toBeTypeOf('function'))
    releaseSave()
    await inFlightSave
    await vi.waitFor(() => expect(driver.connect).toHaveBeenCalled())

    releaseConnect()
    const iterator = wrapper.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'chunk' } })

    // The replacement prefers its explicit old policy over the row, and the host defers the live
    // reconcile's rebuild verdict — nothing else repairs this handoff. Without draining the
    // already-pending save, the replay executes the newly disabled tool.
    expect(fallback.reconcile).toHaveBeenCalledWith({ modelId: 'backup::model', carriedDisabledTools: ['write'] })
    expect(fallback.send).toHaveBeenCalled()
    await wrapper.close()
  })

  it('retains a tool disable that lands while the fallback drains its pending saves', async () => {
    const primary = fakeConnection()
    primary.getPermissionPolicy.mockReturnValue({ permissionMode: 'default', disabledTools: [] })
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

    let releaseFirst!: () => void
    primary.reconcile.mockImplementationOnce(async () => {
      primary.getPermissionPolicy.mockReturnValue({ permissionMode: 'default', disabledTools: ['write'] })
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      return 'patched'
    })
    let releaseSecond!: () => void
    primary.reconcile.mockImplementationOnce(async () => {
      // This save lands its restriction only when its discovery finishes.
      await new Promise<void>((resolve) => {
        releaseSecond = resolve
      })
      primary.getPermissionPolicy.mockReturnValue({ permissionMode: 'default', disabledTools: ['write', 'bash'] })
      return 'patched'
    })
    const firstSave = wrapper.reconcile({ modelId: 'primary::model' })
    await vi.waitFor(() => expect(releaseFirst).toBeTypeOf('function'))

    // A content-free 503 starts the fallback, which waits for the pending save's verdict.
    primary.events.push({ type: 'error', error: new Error('HTTP 503 service overloaded') })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    // While that wait is open the user disables `bash`. The fallback must already own this save:
    // forwarding it to the retired primary would land its tightening after the replay was admitted.
    const secondSave = wrapper.reconcile({ modelId: 'primary::model' })
    await vi.waitFor(() => expect(releaseSecond).toBeTypeOf('function'))
    expect(driver.connect).not.toHaveBeenCalled()

    releaseFirst()
    await firstSave
    await vi.waitFor(() => expect(driver.connect).toHaveBeenCalled())
    releaseConnect()
    releaseSecond()
    await secondSave

    const iterator = wrapper.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'chunk' } })

    // The replacement is admitted under the union of every restriction the window applied, including
    // the one saved during the drain — otherwise its replay executes the disabled tool.
    expect(fallback.reconcile).toHaveBeenCalledWith({
      modelId: 'backup::model',
      carriedDisabledTools: expect.arrayContaining(['write', 'bash'])
    })
    expect(fallback.send).toHaveBeenCalled()
    await wrapper.close()
  })

  it('replays the turn under the prompt it was admitted with, not one saved mid-turn', async () => {
    const primary = fakeConnection()
    primary.getPromptPolicy = vi.fn(() => ({ instructions: 'A' }))
    const fallback = fakeConnection()
    const driver = { connect: vi.fn(async () => fallback) }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
      primary as unknown as AgentRuntimeConnection
    )
    // The turn was admitted with instructions A; B is saved while the provider request is in flight.
    await wrapper.send({ message: { id: 'u1' } } as never)
    primary.getPromptPolicy.mockReturnValue({ instructions: 'B' })
    primary.events.push({ type: 'error', error: new Error('HTTP 429 rate limit') })

    const iterator = wrapper.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'chunk' } })

    // The replay still belongs to the turn admitted with A: saved instructions apply on the next
    // fresh turn (agent-prompt-layers.md), so B must not reach the rebuilt connection.
    expect(driver.connect).toHaveBeenCalledWith(expect.objectContaining({ promptPolicy: { instructions: 'A' } }))
    await wrapper.close()
  })

  it('drains a policy save that lands while the replay submission is in flight', async () => {
    const primary = fakeConnection()
    primary.getPermissionPolicy.mockReturnValue({ permissionMode: 'default', disabledTools: [] })
    const fallback = fakeConnection()
    let releaseSend!: () => void
    // The replacement's own startup reads (skill reads, composition materialization) finish its
    // connect, but a save can still land while the replay submission is in flight.
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

    // A second save lands after the replay was already handed to the replacement: Pi/DSH can begin
    // executing that prompt immediately, so the tightening must reach the replacement while send()
    // is still in flight — waiting for it to settle lets a just-disabled tool run for the whole
    // submission, and forwarding it to the closed primary reaches nobody.
    await wrapper.reconcile({ modelId: 'primary::model' })
    expect(primary.reconcile).toHaveBeenCalledTimes(1)
    expect(fallback.reconcile).toHaveBeenCalledWith({ modelId: 'backup::model' })

    releaseSend()
    const iterator = wrapper.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'chunk' } })
    expect(fallback.reconcile).toHaveBeenCalledTimes(1)
    await wrapper.close()
  })

  it('drains a second save landing while the first retained reconcile is still applying before the replay', async () => {
    const primary = fakeConnection()
    primary.getPermissionPolicy.mockReturnValue({ permissionMode: 'default', disabledTools: [] })
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
    // The order the replacement sees its saves and its replay submission.
    const calls: string[] = []
    let releaseFirstReconcile!: () => void
    fallback.reconcile.mockImplementationOnce(async (): Promise<AgentRuntimeReconcileResult> => {
      calls.push('reconcile')
      // The first retained save's application awaits skill discovery inside the replacement.
      await new Promise<void>((resolve) => {
        releaseFirstReconcile = resolve
      })
      return 'current'
    })
    fallback.reconcile.mockImplementation(async (): Promise<AgentRuntimeReconcileResult> => {
      calls.push('reconcile')
      return 'current'
    })
    fallback.send.mockImplementation(async () => {
      calls.push('send')
    })
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
      primary as unknown as AgentRuntimeConnection
    )
    await wrapper.send({ message: { id: 'u1' } } as never)
    primary.events.push({ type: 'error', error: new Error('HTTP 429 rate limit') })
    await vi.waitFor(() => expect(driver.connect).toHaveBeenCalled())

    // Save A lands in the replacement startup window and is retained for it.
    await wrapper.reconcile({ modelId: 'primary::model' })
    releaseConnect()
    await vi.waitFor(() => expect(fallback.reconcile).toHaveBeenCalledTimes(1))

    // Save B (disabling a tool) lands while A is still being applied — the handoff is not open
    // yet, so B is retained too and must still reach the replacement.
    await wrapper.reconcile({ modelId: 'primary::model' })
    expect(fallback.send).not.toHaveBeenCalled()

    releaseFirstReconcile()
    // Both retained saves must reach the replacement BEFORE the replay is submitted: Pi/DSH can
    // begin executing that prompt on send(), and a restriction applied only afterwards is one the
    // replay could already have run a tool against.
    await vi.waitFor(() => expect(fallback.send).toHaveBeenCalled())
    await vi.waitFor(() => expect(fallback.reconcile).toHaveBeenCalledTimes(2))
    expect(calls).toEqual(['reconcile', 'reconcile', 'send'])
    await wrapper.close()
  })

  it('does not adopt a replacement whose retained reconcile failed to tighten the policy', async () => {
    const primary = fakeConnection('primary capture')
    primary.getPermissionPolicy.mockReturnValue({ permissionMode: 'default', disabledTools: [] })
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

    // Disabling `write` while the replacement starts up is retained for it.
    await wrapper.reconcile({ modelId: 'primary::model' })
    // The replacement's own policy push fails: it may still be enforcing the OLD (looser) policy.
    fallback.reconcile.mockResolvedValueOnce('failed')
    releaseConnect()

    const seen = await collectEvents(wrapper)
    // Adopting it would let the replay execute an ordinary workspace write under stale permissions.
    expect(fallback.send).not.toHaveBeenCalled()
    expect(seen).not.toContainEqual(
      expect.objectContaining({ type: 'chunk', chunk: expect.objectContaining({ type: 'data-model-fallback' }) })
    )
    expect(wrapper.usageCapture).toBe('primary capture')
    await wrapper.close()
  })

  it('does not adopt a replacement whose handoff reconcile failed to tighten the policy', async () => {
    const primary = fakeConnection('primary capture')
    primary.getPermissionPolicy.mockReturnValue({ permissionMode: 'default', disabledTools: [] })
    const fallback = fakeConnection()
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

    // The replacement already owns the replay, and saving `disabledTools: ['write']` now reaches it
    // directly — but its policy push fails, so `write` may still be permitted while it executes.
    fallback.reconcile.mockResolvedValueOnce('failed')
    await wrapper.reconcile({ modelId: 'primary::model' })
    releaseSend()

    const seen = await collectEvents(wrapper)
    // A failed tighten must not be adopted: the replay runs on a policy the user already revoked.
    expect(seen).not.toContainEqual(
      expect.objectContaining({ type: 'chunk', chunk: expect.objectContaining({ type: 'data-model-fallback' }) })
    )
    expect(wrapper.usageCapture).toBe('primary capture')
    await wrapper.close()
  })

  it('does not adopt a replacement whose retained reconcile cannot derive the policy', async () => {
    const primary = fakeConnection()
    primary.getPermissionPolicy.mockReturnValue({ permissionMode: 'default', disabledTools: [] })
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

    // Disabling `write` mid-startup is retained; the fallback-only model row is deleted too, so the
    // replacement cannot resolve the policy the restriction belongs to.
    await wrapper.reconcile({ modelId: 'primary::model' })
    fallback.reconcile.mockResolvedValueOnce('invalid')
    releaseConnect()

    const seen = await collectEvents(wrapper)
    // Nothing is derivable, so adopting it would replay the turn under an unknown policy.
    expect(fallback.send).not.toHaveBeenCalled()
    expect(seen).not.toContainEqual(
      expect.objectContaining({ type: 'chunk', chunk: expect.objectContaining({ type: 'data-model-fallback' }) })
    )
    await wrapper.close()
  })

  it('does not adopt a replacement whose retained reconcile throws', async () => {
    const primary = fakeConnection()
    primary.getPermissionPolicy.mockReturnValue({ permissionMode: 'default', disabledTools: [] })
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

    // Model lookup throws before the restriction is applied: the outcome is unknown, so adopting the
    // replacement would replay the turn under whatever policy it happens to enforce.
    await wrapper.reconcile({ modelId: 'primary::model' })
    fallback.reconcile.mockRejectedValueOnce(new Error('model lookup exploded'))
    releaseConnect()

    const seen = await collectEvents(wrapper)
    expect(fallback.send).not.toHaveBeenCalled()
    expect(seen).not.toContainEqual(
      expect.objectContaining({ type: 'chunk', chunk: expect.objectContaining({ type: 'data-model-fallback' }) })
    )
    await wrapper.close()
  })

  it('declines the replay when the live turn policy cannot be read', async () => {
    const primary = fakeConnection()
    const policyless = { ...primary, getPermissionPolicy: undefined }
    const driver = { connect: vi.fn() }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
      policyless as unknown as AgentRuntimeConnection
    )
    await wrapper.send({ message: { id: 'u1' } } as never)
    primary.events.push({ type: 'error', error: new Error('HTTP 429 rate limit') })

    const iterator = wrapper.events[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'error' } })
    // A policy that cannot be preserved must not be replayed under whatever the agent row says now.
    expect(driver.connect).not.toHaveBeenCalled()
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

  it('joins a still-settling close instead of reporting success to a retry', async () => {
    const primary = fakeConnection()
    let releaseClose!: () => void
    primary.close.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseClose = resolve
        })
    )
    const driver = { connect: vi.fn() }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
      primary as unknown as AgentRuntimeConnection
    )

    const first = wrapper.close()
    await new Promise((resolve) => setTimeout(resolve, 0))
    // The host's 20-second close barrier fired and closeSessionForArchive() is retrying while Pi
    // teardown is still running: the retry must join the original shutdown, not read success.
    let retried = false
    const second = wrapper.close().then(() => {
      retried = true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(retried).toBe(false)

    releaseClose()
    await Promise.all([first, second])
    expect(primary.close).toHaveBeenCalledTimes(1)
  })

  it('returns the failed shutdown to a retry instead of a fresh success', async () => {
    const primary = fakeConnection()
    primary.close.mockRejectedValueOnce(new Error('pi shutdown failed'))
    const driver = { connect: vi.fn() }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
      primary as unknown as AgentRuntimeConnection
    )

    await expect(wrapper.close()).rejects.toThrow('pi shutdown failed')
    // A retry after the failed teardown must observe the same failure — reporting success here
    // clears failedClosures and lets the workspace archive while shutdown stays unconfirmed.
    await expect(wrapper.close()).rejects.toThrow('pi shutdown failed')
    expect(primary.close).toHaveBeenCalledTimes(1)
  })

  it('rejects the raced close when the discarded replacement shutdown fails', async () => {
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

    fallback.close.mockRejectedValueOnce(new Error('replacement shutdown failed'))

    const closing = wrapper.close()
    // Handled here because the rejection settles while this test is still waiting on the rebuild;
    // the closeRuntimeConnection caller attaches its handler synchronously and never sees this.
    closing.catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 0))
    releaseConnect()
    await vi.waitFor(() => expect(fallback.close).toHaveBeenCalled())

    // The Stop raced the rebuild into discard(): the replacement's shutdown failed, and a fulfilled
    // close here would clear failedClosures and let closeSessionForArchive() archive the workspace
    // with that shutdown unconfirmed.
    await expect(closing).rejects.toThrow('replacement shutdown failed')
    await expect(wrapper.close()).rejects.toThrow('replacement shutdown failed')
    expect(fallback.close).toHaveBeenCalledTimes(1)
  })

  it('rejects the raced close when the pending replacement shutdown fails', async () => {
    const primary = fakeConnection()
    const fallback = fakeConnection()
    let releaseSend!: () => void
    fallback.send.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseSend = resolve
      })
    })
    fallback.close.mockRejectedValueOnce(new Error('replacement shutdown failed'))
    const driver = { connect: vi.fn(async () => fallback) }
    const wrapper = new AgentSessionFallbackConnection(
      driver as unknown as AgentSessionRuntimeDriver,
      { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
      primary as unknown as AgentRuntimeConnection
    )
    await wrapper.send({ message: { id: 'u1' } } as never)
    primary.events.push({ type: 'error', error: new Error('HTTP 429 rate limit') })
    await vi.waitFor(() => expect(fallback.send).toHaveBeenCalled())

    // The Stop lands while the replay submission is in flight: close() tears the pending
    // replacement down itself, and its failed shutdown must reject the close — reporting success
    // clears failedClosures and lets the workspace archive while teardown stayed unconfirmed.
    await expect(wrapper.close()).rejects.toThrow('replacement shutdown failed')
    releaseSend()
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

  it('does not submit the replay when the session closes while the replacement is reconciling', async () => {
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

    // A save lands in the replacement startup window, so the replay waits on its application.
    await wrapper.reconcile({ modelId: 'primary::model' })
    let releaseReconcile!: () => void
    fallback.reconcile.mockImplementationOnce(async (): Promise<AgentRuntimeReconcileResult> => {
      await new Promise<void>((resolve) => {
        releaseReconcile = resolve
      })
      return 'current'
    })
    releaseConnect()
    await vi.waitFor(() => expect(fallback.reconcile).toHaveBeenCalled())

    // Stop lands during that reconciliation: close() owns the replacement's teardown, and Pi can
    // finish abort and remain awaiting a shutdown extension while retaining its session.
    const closing = wrapper.close()
    await vi.waitFor(() => expect(fallback.close).toHaveBeenCalled())
    releaseReconcile()
    await closing
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Submitting here would start a prompt on the closing connection whose output is discarded.
    expect(fallback.send).not.toHaveBeenCalled()
    expect(fallback.close).toHaveBeenCalledTimes(1)
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

  it.each(['text-start', 'reasoning-start'] as const)(
    'still falls back when the failed turn emitted only a %s boundary',
    async (type) => {
      const primary = fakeConnection()
      const fallback = fakeConnection()
      const driver = { connect: vi.fn(async () => fallback) }
      const wrapper = new AgentSessionFallbackConnection(
        driver as unknown as AgentSessionRuntimeDriver,
        { sessionId: 's1', agentId: 'a1', modelId: 'primary::model' },
        primary as unknown as AgentRuntimeConnection
      )
      await wrapper.send({ message: { id: 'u1' } } as never)
      // Pi emits the block start separately from its deltas; a provider failure after the start
      // marker but before any content still showed the user nothing.
      primary.events.push({ type: 'chunk', chunk: { type, id: 'part-1' } } as never)
      primary.events.push({ type: 'error', error: new Error('HTTP 503 service unavailable') })

      const iterator = wrapper.events[Symbol.asyncIterator]()
      await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'chunk', chunk: { type } } })
      await expect(iterator.next()).resolves.toMatchObject({
        value: { type: 'chunk', chunk: { type: 'data-model-fallback' } }
      })
      expect(driver.connect).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'backup::model' }))
      await wrapper.close()
    }
  )

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
