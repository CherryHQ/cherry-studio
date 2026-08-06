import { BaseService } from '@main/core/lifecycle/BaseService'
import { deriveRootSpanId } from '@shared/data/types/trace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  startupMock,
  buildWarmRequestMock,
  applicationGetMock,
  applicationIsQuitting,
  closeAgentRuntimeMock,
  traceModeEnabledMock,
  prepareTraceMock,
  ensureTraceIdMock
} = vi.hoisted(() => ({
  startupMock: vi.fn(),
  buildWarmRequestMock: vi.fn(),
  applicationGetMock: vi.fn(),
  applicationIsQuitting: { value: true },
  closeAgentRuntimeMock: vi.fn(),
  traceModeEnabledMock: vi.fn(),
  prepareTraceMock: vi.fn(),
  ensureTraceIdMock: vi.fn()
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { ensureTraceId: ensureTraceIdMock }
}))

vi.mock('@application', () => ({
  application: {
    get: applicationGetMock,
    get isQuitting() {
      return applicationIsQuitting.value
    }
  }
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  startup: startupMock
}))

vi.mock('../agentSessionWarmup', () => ({
  buildClaudeCodeWarmQueryRequestForAgentSession: buildWarmRequestMock
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
  }
}))

const { claudeCodeProcessManager, spawnClaudeCodeProcess } = await import('../ClaudeCodeProcessManager')
const { ClaudeCodeWarmQueryManager, createClaudeCodeWarmQuerySignature } = await import('../ClaudeCodeWarmQueryManager')

function warmQuery(cleanup: Promise<void> = Promise.resolve()) {
  const close = vi.fn()
  return {
    query: vi.fn(),
    close,
    [Symbol.asyncDispose]: vi.fn(async () => {
      close()
      await cleanup
    })
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('ClaudeCodeWarmQueryManager', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    vi.useFakeTimers()
    applicationGetMock.mockImplementation((name: string) => {
      if (name === 'ClaudeCodeTraceBridgeService') {
        return { isTraceModeEnabled: traceModeEnabledMock, prepareTrace: prepareTraceMock }
      }
      if (name === 'AgentSessionRuntimeService') return { closeAll: closeAgentRuntimeMock }
      throw new Error(`Unexpected application.get(${name})`)
    })
    closeAgentRuntimeMock.mockResolvedValue(undefined)
    applicationIsQuitting.value = true
    traceModeEnabledMock.mockReturnValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('consumes a matching warm query once', async () => {
    const manager = new ClaudeCodeWarmQueryManager()
    const warm = warmQuery()
    const abortController = new AbortController()
    startupMock.mockResolvedValueOnce(warm)

    manager.prewarm({ key: 'session-1', options: { model: 'sonnet', resume: 'sdk-1', abortController } as any })

    const consumed = await manager.consume({ key: 'session-1', options: { model: 'sonnet', resume: 'sdk-1' } as any })
    const second = await manager.consume({ key: 'session-1', options: { model: 'sonnet', resume: 'sdk-1' } as any })

    expect(consumed?.warmQuery).toBe(warm)
    expect(second).toBeUndefined()
    expect(startupMock).toHaveBeenCalledWith({
      options: { model: 'sonnet', resume: 'sdk-1', spawnClaudeCodeProcess },
      initializeTimeoutMs: undefined
    })
    expect(warm.close).not.toHaveBeenCalled()
  })

  it('preserves the host spawn wrapper on the warm startup path', async () => {
    const manager = new ClaudeCodeWarmQueryManager()
    const warm = warmQuery()
    const ignoredSpawn = vi.fn()
    startupMock.mockResolvedValueOnce(warm)

    manager.prewarm({
      key: 'session-1',
      options: { model: 'sonnet', spawnClaudeCodeProcess: ignoredSpawn } as any
    })
    await Promise.resolve()

    expect(startupMock).toHaveBeenCalledWith({
      options: { model: 'sonnet', spawnClaudeCodeProcess },
      initializeTimeoutMs: undefined
    })
  })

  it('waits for every warm cleanup in closeAll', async () => {
    const manager = new ClaudeCodeWarmQueryManager()
    const firstCleanup = createDeferred<void>()
    const secondCleanup = createDeferred<void>()
    const firstWarm = warmQuery(firstCleanup.promise)
    const secondWarm = warmQuery(secondCleanup.promise)
    startupMock.mockResolvedValueOnce(firstWarm).mockResolvedValueOnce(secondWarm)
    manager.prewarm({ key: 'session-1', options: { model: 'sonnet' } as any })
    manager.prewarm({ key: 'session-2', options: { model: 'opus' } as any })
    await Promise.resolve()

    const closing = manager.closeAll()
    let settled = false
    void closing.then(() => {
      settled = true
    })
    await Promise.resolve()

    expect(firstWarm[Symbol.asyncDispose]).toHaveBeenCalledOnce()
    expect(secondWarm[Symbol.asyncDispose]).toHaveBeenCalledOnce()
    firstCleanup.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)

    secondCleanup.resolve()
    await expect(closing).resolves.toBeUndefined()
  })

  it('limits a non-quitting service stop to warm entries', async () => {
    applicationIsQuitting.value = false
    const shutdown = vi.spyOn(claudeCodeProcessManager, 'shutdown')
    const manager = new ClaudeCodeWarmQueryManager()
    const warm = warmQuery()
    startupMock.mockResolvedValueOnce(warm)
    try {
      manager.prewarm({ key: 'session-1', options: { model: 'sonnet' } as any })
      await Promise.resolve()

      await expect(manager._doStop()).resolves.toBeUndefined()

      expect(warm[Symbol.asyncDispose]).toHaveBeenCalledOnce()
      expect(closeAgentRuntimeMock).not.toHaveBeenCalled()
      expect(shutdown).not.toHaveBeenCalled()
    } finally {
      shutdown.mockRestore()
    }
  })

  it('bounds a hanging warm cleanup during stop without rejecting', async () => {
    const manager = new ClaudeCodeWarmQueryManager()
    const warm = warmQuery(new Promise<void>(() => {}))
    startupMock.mockResolvedValueOnce(warm)
    manager.prewarm({ key: 'session-1', options: { model: 'sonnet' } as any })
    await Promise.resolve()

    const stopped = manager._doStop().then(
      () => 'resolved' as const,
      () => 'rejected' as const
    )
    let outcome: 'pending' | 'resolved' | 'rejected' = 'pending'
    void stopped.then((result) => {
      outcome = result
    })
    await Promise.resolve()

    expect(warm[Symbol.asyncDispose]).toHaveBeenCalledOnce()
    expect(outcome).toBe('pending')
    await vi.advanceTimersByTimeAsync(1_999)
    expect(outcome).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    await expect(stopped).resolves.toBe('resolved')
    expect(closeAgentRuntimeMock).toHaveBeenCalledOnce()
  })

  it('closes a stale warm query when session options change', async () => {
    const manager = new ClaudeCodeWarmQueryManager()
    const stale = warmQuery()
    const current = warmQuery()
    startupMock.mockResolvedValueOnce(stale).mockResolvedValueOnce(current)

    manager.prewarm({ key: 'session-1', options: { model: 'sonnet', resume: 'sdk-1' } as any })
    manager.prewarm({ key: 'session-1', options: { model: 'opus', resume: 'sdk-1' } as any })

    await Promise.resolve()
    const consumed = await manager.consume({ key: 'session-1', options: { model: 'opus', resume: 'sdk-1' } as any })

    expect(stale.close).toHaveBeenCalledOnce()
    expect(consumed?.warmQuery).toBe(current)
  })

  it('uses the same signature with or without abortController', () => {
    const withAbort = createClaudeCodeWarmQuerySignature({
      model: 'sonnet',
      resume: 'sdk-1',
      abortController: new AbortController()
    } as any)
    const withoutAbort = createClaudeCodeWarmQuerySignature({ model: 'sonnet', resume: 'sdk-1' } as any)

    expect(withAbort).toBe(withoutAbort)
  })

  it('uses the same signature with or without the session steer holder', () => {
    const withHolder = createClaudeCodeWarmQuerySignature({
      model: 'sonnet',
      resume: 'sdk-1',
      steerHolder: { pending: [], dispose: vi.fn() }
    } as any)
    const withoutHolder = createClaudeCodeWarmQuerySignature({ model: 'sonnet', resume: 'sdk-1' } as any)

    expect(withHolder).toBe(withoutHolder)
  })

  it('uses the same signature across rotated credential env values', () => {
    const keyA = createClaudeCodeWarmQuerySignature({
      model: 'sonnet',
      env: { ANTHROPIC_API_KEY: 'key-a', ANTHROPIC_AUTH_TOKEN: 'key-a', ANTHROPIC_BASE_URL: 'https://api.example.com' }
    } as any)
    const keyB = createClaudeCodeWarmQuerySignature({
      model: 'sonnet',
      env: { ANTHROPIC_API_KEY: 'key-b', ANTHROPIC_AUTH_TOKEN: 'key-b', ANTHROPIC_BASE_URL: 'https://api.example.com' }
    } as any)

    expect(keyA).toBe(keyB)
  })

  it('hashes custom headers in the signature without retaining their raw values', () => {
    const tenantA = createClaudeCodeWarmQuerySignature({
      model: 'sonnet',
      env: { ANTHROPIC_CUSTOM_HEADERS: 'X-Tenant-Token: tenant-secret-a' }
    } as any)
    const tenantB = createClaudeCodeWarmQuerySignature({
      model: 'sonnet',
      env: { ANTHROPIC_CUSTOM_HEADERS: 'X-Tenant-Token: tenant-secret-b' }
    } as any)

    expect(tenantA).not.toBe(tenantB)
    expect(tenantA).not.toContain('tenant-secret-a')
  })

  // The driver has no trace branch around `consume`: a traced turn simply asks with the OTEL env
  // merged in, and this divergence is what keeps it off a query parked without tracing. Telemetry
  // env is fixed at spawn, so reusing such a park would silently produce an untraced turn.
  it('changes the signature when Claude Code trace env is present', () => {
    const traceless = createClaudeCodeWarmQuerySignature({
      model: 'sonnet',
      env: { ANTHROPIC_BASE_URL: 'https://api.example.com' }
    } as any)
    const traced = createClaudeCodeWarmQuerySignature({
      model: 'sonnet',
      env: {
        ANTHROPIC_BASE_URL: 'https://api.example.com',
        CLAUDE_CODE_ENABLE_TELEMETRY: '1',
        TRACEPARENT: `00-${'0'.repeat(32)}-${'1'.repeat(16)}-01`
      }
    } as any)

    expect(traced).not.toBe(traceless)
  })

  it('does not mutate the caller env when stripping credentials for the signature', () => {
    const options = { model: 'sonnet', env: { ANTHROPIC_API_KEY: 'key-a' } } as any

    createClaudeCodeWarmQuerySignature(options)

    expect(options.env.ANTHROPIC_API_KEY).toBe('key-a')
  })

  it('changes the signature when the credentials fingerprint changes', () => {
    const setA = createClaudeCodeWarmQuerySignature({ model: 'sonnet' } as any, 'fingerprint-a')
    const setB = createClaudeCodeWarmQuerySignature({ model: 'sonnet' } as any, 'fingerprint-b')

    expect(setA).not.toBe(setB)
  })

  it('fingerprints knowledge-base bindings as a set', () => {
    const bound = createClaudeCodeWarmQuerySignature({ model: 'sonnet' } as any, undefined, ['kb-b', 'kb-a'])
    const reordered = createClaudeCodeWarmQuerySignature({ model: 'sonnet' } as any, undefined, ['kb-a', 'kb-b'])
    const unbound = createClaudeCodeWarmQuerySignature({ model: 'sonnet' } as any, undefined, [])

    expect(reordered).toBe(bound)
    expect(unbound).not.toBe(bound)
  })

  it('consumes a warm query whose rotated key differs but whose fingerprint matches', async () => {
    const manager = new ClaudeCodeWarmQueryManager()
    const warm = warmQuery()
    startupMock.mockResolvedValueOnce(warm)

    manager.prewarm({
      key: 'session-1',
      options: { model: 'sonnet', env: { ANTHROPIC_API_KEY: 'key-a' } } as any,
      credentialsFingerprint: 'set-1'
    })
    const consumed = await manager.consume({
      key: 'session-1',
      options: { model: 'sonnet', env: { ANTHROPIC_API_KEY: 'key-b' } } as any,
      credentialsFingerprint: 'set-1'
    })

    expect(consumed?.warmQuery).toBe(warm)
    expect(warm.close).not.toHaveBeenCalled()
  })

  it('returns the receipt captured by the warm process instead of the separately rotated consume request', async () => {
    const manager = new ClaudeCodeWarmQueryManager()
    const warm = warmQuery()
    startupMock.mockResolvedValueOnce(warm)

    manager.prewarm({
      key: 'session-1',
      options: { model: 'sonnet', env: { ANTHROPIC_API_KEY: 'key-a' } } as any,
      credentialsFingerprint: 'set-1',
      usageCapture: {
        owner: 'agent-sdk',
        credentialReceipt: { attribution: 'explicit', id: 'key-a', masked: 'key-***' },
        providerId: 'anthropic',
        providerName: 'Anthropic',
        source: null,
        frozenModels: [{ modelId: 'sonnet', modelName: 'Sonnet', pricingSnapshot: null, aliases: ['sonnet'] }]
      }
    })
    const consumed = await manager.consume({
      key: 'session-1',
      options: { model: 'sonnet', env: { ANTHROPIC_API_KEY: 'key-b' } } as any,
      credentialsFingerprint: 'set-1',
      usageCapture: {
        owner: 'agent-sdk',
        credentialReceipt: { attribution: 'explicit', id: 'key-b', masked: 'key-***' },
        providerId: 'anthropic',
        providerName: 'Anthropic',
        source: null,
        frozenModels: [{ modelId: 'sonnet', modelName: 'Sonnet', pricingSnapshot: null, aliases: ['sonnet'] }]
      }
    })

    expect(consumed).toMatchObject({
      warmQuery: warm,
      usageCapture: {
        owner: 'agent-sdk',
        credentialReceipt: { attribution: 'explicit', id: 'key-a' }
      }
    })
  })

  it('discards a warm query when the enabled key set changed between park and consume', async () => {
    const manager = new ClaudeCodeWarmQueryManager()
    const warm = warmQuery()
    startupMock.mockResolvedValueOnce(warm)

    manager.prewarm({
      key: 'session-1',
      options: { model: 'sonnet' } as any,
      credentialsFingerprint: 'set-1'
    })
    const consumed = await manager.consume({
      key: 'session-1',
      options: { model: 'sonnet' } as any,
      credentialsFingerprint: 'set-2'
    })

    expect(consumed).toBeUndefined()
    await Promise.resolve()
    expect(warm.close).toHaveBeenCalledOnce()
  })

  it('discards a warm query when knowledge bindings change between park and consume', async () => {
    const manager = new ClaudeCodeWarmQueryManager()
    const warm = warmQuery()
    startupMock.mockResolvedValueOnce(warm)

    manager.prewarm({
      key: 'session-1',
      options: { model: 'sonnet' } as any,
      knowledgeBaseIds: []
    })
    const consumed = await manager.consume({
      key: 'session-1',
      options: { model: 'sonnet' } as any,
      knowledgeBaseIds: ['kb-1']
    })

    expect(consumed).toBeUndefined()
    await Promise.resolve()
    expect(warm.close).toHaveBeenCalledOnce()
  })

  it('closes unused warm queries after the idle ttl', async () => {
    const manager = new ClaudeCodeWarmQueryManager()
    const warm = warmQuery()
    startupMock.mockResolvedValueOnce(warm)

    manager.prewarm({ key: 'session-1', options: { model: 'sonnet' } as any })
    await Promise.resolve()
    vi.advanceTimersByTime(5 * 60 * 1000)
    await Promise.resolve()

    expect(warm.close).toHaveBeenCalledOnce()
  })

  it('prewarms an agent session from the session request builder', async () => {
    const manager = new ClaudeCodeWarmQueryManager()
    const warm = warmQuery()
    buildWarmRequestMock.mockResolvedValueOnce({
      key: 'session-1',
      options: { model: 'sonnet', resume: 'sdk-1' },
      initializeTimeoutMs: 100
    })
    startupMock.mockResolvedValueOnce(warm)

    await manager.prewarmAgentSession('session-1')
    const consumed = await manager.consume({ key: 'session-1', options: { model: 'sonnet', resume: 'sdk-1' } as any })

    expect(buildWarmRequestMock).toHaveBeenCalledWith('session-1')
    expect(consumed?.warmQuery).toBe(warm)
  })

  // Telemetry env is fixed at spawn and is part of the warm signature, so the park is only reusable
  // by a traced turn if it was spawned with the very env that turn will ask with.
  it('bakes the session trace env into the park so a traced turn can consume it', async () => {
    traceModeEnabledMock.mockReturnValue(true)
    const traceId = '0'.repeat(31) + 'a'
    ensureTraceIdMock.mockReturnValue(traceId)
    const traceEnv = {
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      TRACEPARENT: `00-${traceId}-${deriveRootSpanId(traceId)}-01`
    }
    prepareTraceMock.mockResolvedValue(traceEnv)
    const manager = new ClaudeCodeWarmQueryManager()
    const warm = warmQuery()
    buildWarmRequestMock.mockResolvedValueOnce({
      key: 'session-1',
      options: { model: 'sonnet', resume: 'sdk-1', env: { ANTHROPIC_BASE_URL: 'https://api.example.com' } }
    })
    startupMock.mockResolvedValueOnce(warm)

    await manager.prewarmAgentSession('session-1')

    expect(prepareTraceMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1', traceId, rootSpanId: deriveRootSpanId(traceId) })
    )
    expect(startupMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          env: { ANTHROPIC_BASE_URL: 'https://api.example.com', ...traceEnv }
        })
      })
    )

    // What the driver asks with for a traced turn: same options, trace env merged.
    const consumed = await manager.consume({
      key: 'session-1',
      options: {
        model: 'sonnet',
        resume: 'sdk-1',
        env: { ANTHROPIC_BASE_URL: 'https://api.example.com', ...traceEnv }
      } as any
    })
    expect(consumed?.warmQuery).toBe(warm)
  })

  // sessionId validation (empty / non-string) now lives in the IpcApi router's zod parse of
  // `ai.agent.session.prewarm` / `ai.agent.session.close_warm`, not in this service — so it is no
  // longer unit-tested here (a thin schema contract; see ipc-usage.md "Testing"). The
  // prewarm/close methods are exercised directly above and below.

  it('drops the live MCP server instance when building the warm-query signature', () => {
    const fakeInstance = { connect: vi.fn() }
    // Reference itself so the live instance is circular, matching real SDK objects.
    ;(fakeInstance as any).self = fakeInstance

    const withInstance = createClaudeCodeWarmQuerySignature({
      model: 'sonnet',
      mcpServers: { cherry: { type: 'sdk', name: 'cherry', instance: fakeInstance } }
    } as any)
    const withoutInstance = createClaudeCodeWarmQuerySignature({
      model: 'sonnet',
      mcpServers: { cherry: { type: 'sdk', name: 'cherry' } }
    } as any)

    expect(withInstance).toBe(withoutInstance)
    expect(withInstance).not.toContain('circular')
  })

  it('still distinguishes signatures by MCP server name and type', () => {
    const withInstance = (name: string) =>
      createClaudeCodeWarmQuerySignature({
        model: 'sonnet',
        mcpServers: { srv: { type: 'sdk', name, instance: { connect: vi.fn() } } }
      } as any)

    expect(withInstance('cherry')).not.toBe(withInstance('assistant'))
  })
})
