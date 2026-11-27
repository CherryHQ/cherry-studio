import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentSessionEntitySchema, type AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
const mocks = vi.hoisted(() => ({
  agent: vi.fn(),
  workspace: vi.fn(),
  prepareBranch: vi.fn(),
  context: vi.fn(),
  backend: vi.fn(),
  roots: vi.fn(),
  markRecoveryCheck: vi.fn(),
  openStorage: vi.fn(),
  openBackend: vi.fn(),
  readWork: vi.fn(),
  forkDurable: vi.fn(),
  Connection: vi.fn()
}))
vi.mock('@data/services/AgentService', () => ({ agentService: { getAgent: mocks.agent } }))
vi.mock('@data/services/AgentSessionContextService', () => ({
  agentSessionContextService: {
    context: mocks.context,
    backend: mocks.backend,
    roots: mocks.roots,
    markRecoveryCheck: mocks.markRecoveryCheck
  }
}))
vi.mock('@main/ai/agentSession/durableNativeContext', () => ({ openDurableStorage: mocks.openStorage }))
vi.mock('../agentSessionWorkspace', () => ({ prepareAgentSessionWorkspaceDirectory: mocks.workspace }))
vi.mock('./DurableBackend', () => ({
  DurableBackend: {
    open: mocks.openBackend,
    readWork: mocks.readWork
  }
}))
vi.mock('./durableContext', () => ({ prepareDurableBranch: mocks.prepareBranch }))
vi.mock('./durableFork', () => ({ forkDurable: mocks.forkDurable }))
vi.mock('./PiDurableRuntimeConnection', () => ({ PiDurableRuntimeConnection: mocks.Connection }))
import { PiDurableRuntimeDriver } from './PiDurableRuntimeDriver'
describe('Pi Durable effective model preflight', () => {
  const session: AgentSessionEntity = {
    id: 'session-1',
    agentId: 'agent-1',
    model: 'anthropic::override',
    name: 'Session',
    isNameManuallyEdited: false,
    workspaceId: 'workspace-1',
    workspace: {
      id: 'workspace-1',
      name: 'Workspace',
      path: '/tmp',
      type: 'user',
      orderKey: 'a0',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    orderKey: 'a0',
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
  it('uses a complete session entity fixture', () => {
    expect(AgentSessionEntitySchema.parse(session)).toEqual(session)
  })
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.agent.mockReturnValue({ model: null })
    mocks.workspace.mockResolvedValue(undefined)
  })
  it('accepts an interactive override after the Agent default is deleted', async () => {
    await expect(new PiDurableRuntimeDriver().validateSession(session)).resolves.toBeUndefined()
    expect(mocks.workspace).toHaveBeenCalledWith(session)
  })
  it('rejects headless use of an override when the Agent default is deleted', async () => {
    await expect(new PiDurableRuntimeDriver().validateSession(session, { headless: true })).rejects.toThrow(
      'requires an agent, workspace and model'
    )
    expect(mocks.workspace).not.toHaveBeenCalled()
  })
  it('accepts a headless Agent default behind a session override', async () => {
    mocks.agent.mockReturnValue({ model: 'anthropic::default' })
    await expect(new PiDurableRuntimeDriver().validateSession(session, { headless: true })).resolves.toBeUndefined()
  })
  it('still requires the owning Agent', async () => {
    mocks.agent.mockReturnValue(undefined)
    await expect(new PiDurableRuntimeDriver().validateSession(session)).rejects.toThrow(
      'requires an agent, workspace and model'
    )
  })
})

describe('Pi Durable backend queue coordination', () => {
  const backendId = '00000000-0000-4000-8000-000000000001'
  const contextRow = {
    id: 'ctx-1',
    sessionId: 'session-1',
    backendId,
    anchorMessageId: 'msg-1',
    nativeThreadId: '1'
  }
  const connectInput = {
    sessionId: 'session-1',
    agentId: 'agent-1',
    modelId: 'anthropic::claude' as const
  }

  function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prepareBranch.mockReturnValue(contextRow)
    mocks.context.mockReturnValue(contextRow)
    mocks.backend.mockReturnValue({ id: backendId })
    mocks.roots.mockReturnValue([contextRow])
    mocks.openStorage.mockResolvedValue({ close: vi.fn(async () => undefined) })
    mocks.readWork.mockResolvedValue({ roots: new Map() })
  })

  function setupQueueDriver(startGates: Array<ReturnType<typeof createDeferred<void>>>) {
    let openCount = 0
    mocks.openBackend.mockImplementation(async (input) => {
      const root = { context: contextRow, input }
      return {
        owner: {
          prepare: vi.fn(async (nextInput) => ({ context: contextRow, input: nextInput })),
          runtime: { durable: {}, resume: vi.fn(async () => ({ status: 'confirmed' as const })) },
          shutdown: vi.fn(async () => undefined)
        },
        pending: [],
        root,
        recovery: { roots: new Map() }
      }
    })
    mocks.Connection.mockImplementation(function (this: unknown, _input: unknown, access: any) {
      const gate = startGates[openCount++]
      let isClosing = false
      let closePromise: Promise<void> | undefined
      const conn = {
        get isClosing() {
          return isClosing
        },
        start: vi.fn(async () => {
          await gate.promise
          return conn
        }),
        close: vi.fn(() => {
          isClosing = true
          return (closePromise ??= access.release(async () => undefined))
        })
      }
      return conn
    })
    return new PiDurableRuntimeDriver(vi.fn())
  }

  it('yields to release a closing cached connection and opens a fresh live connection', async () => {
    const startGates = [createDeferred<void>(), createDeferred<void>()]
    const driver = setupQueueDriver(startGates)
    startGates[0].resolve()
    const first = (await driver.connect(connectInput)) as unknown as { isClosing: boolean; close(): Promise<void> }

    const forkGate = createDeferred<unknown>()
    mocks.forkDurable.mockImplementationOnce(() => forkGate.promise)
    const forkPending = driver.fork({
      sourceBackendId: backendId,
      sourceSessionId: 'session-1',
      targetSessionId: 'session-2',
      checkpoint: { runtime: 'pi-durable', backendId, conversationId: '1', entryId: '1' },
      checkpoints: [],
      targetCwd: '/tmp',
      artifactDirectory: '/tmp/artifacts',
      signal: new AbortController().signal
    })
    const retryPending = driver.connect(connectInput)
    const closePending = first.close()

    expect(first.isClosing).toBe(true)
    startGates[1].resolve()
    forkGate.resolve({ checkpoint: {}, contextId: 'ctx-fork' })

    const [, retried] = (await Promise.all([forkPending, retryPending, closePending])) as [
      unknown,
      { isClosing: boolean; close(): Promise<void> },
      void
    ]
    expect(retried).not.toBe(first)
    expect(retried.isClosing).toBe(false)
    expect(mocks.openBackend).toHaveBeenCalledTimes(2)
    await retried.close()
  })

  it('opens a fresh live connection on a queued retry when the preceding open rejects', async () => {
    const startGates = [createDeferred<void>(), createDeferred<void>()]
    const driver = setupQueueDriver(startGates)
    const firstPending = driver.connect(connectInput)
    const retryPending = driver.connect(connectInput)

    startGates[0].reject(new Error('late startup failure'))
    startGates[1].resolve()

    await expect(firstPending).rejects.toThrow('late startup failure')
    const retried = (await retryPending) as unknown as { isClosing: boolean; close(): Promise<void> }
    expect(retried.isClosing).toBe(false)
    expect(mocks.openBackend).toHaveBeenCalledTimes(2)
    await retried.close()
  })
})
