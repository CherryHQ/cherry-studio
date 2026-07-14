import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChannelMessageEvent } from '../ChannelAdapter'
import { ChannelManager } from '../ChannelManager'
import { ChannelMessageHandler, channelMessageHandler } from '../ChannelMessageHandler'

vi.mock('@main/ai/runtime/claudeCode/settingsBuilder', () => {
  class MockAgentSessionWorkspaceError extends Error {}
  return {
    AgentSessionWorkspaceError: MockAgentSessionWorkspaceError,
    isAgentSessionWorkspaceError: (error: unknown) => error instanceof MockAgentSessionWorkspaceError,
    prepareClaudeCodeWorkspaceDirectory: vi.fn()
  }
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('../security/ExternalContentGuard', () => ({
  wrapExternalContent: vi.fn((text: string) => text)
}))

vi.mock('../security/OutputSanitizer', () => ({
  sanitizeChannelOutput: vi.fn((text: string) => ({ text, redacted: false }))
}))

// The global mock (tests/main.setup.ts) wires the default service set, which omits
// AiStreamManager; the abort path reads it, so override locally.
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ AiStreamManager: { abort: vi.fn() } } as never)
})

vi.mock('@data/services/AgentService', () => ({
  agentService: {
    getAgent: vi.fn().mockReturnValue({
      id: 'agent-1',
      configuration: {},
      model: 'openai::gpt-4'
    })
  }
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: {
    getById: vi.fn(),
    create: vi.fn()
  }
}))

vi.mock('@shared/data/types/model', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    createUniqueModelId: vi.fn((providerId: string, modelId: string) => `${providerId}::${modelId}`)
  }
})

const { mockStartAgentSessionRun } = vi.hoisted(() => ({ mockStartAgentSessionRun: vi.fn() }))
vi.mock('@main/ai/streamManager/api/startAgentSessionRun', () => ({
  startAgentSessionRun: (...args: unknown[]) => mockStartAgentSessionRun(...args)
}))

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: {
    getChannel: vi
      .fn()
      .mockReturnValue({ id: 'channel-1', sessionId: null, permissionMode: null, workspace: { type: 'system' } }),
    updateChannel: vi.fn().mockResolvedValue(null),
    findBySessionId: vi.fn().mockResolvedValue(null)
  }
}))

const SESSION = {
  id: 'session-1',
  agentId: 'agent-1',
  agentType: 'claude-code',
  model: 'openai::gpt-4',
  workspace: { path: '/tmp/test-workspace' },
  configuration: {}
}

/** Configure mockStartAgentSessionRun to stream chunks and complete via onDone. */
function simulateStream(parts: Array<{ type: string; delta?: string }>) {
  mockStartAgentSessionRun.mockImplementationOnce(
    async ({
      listeners
    }: {
      listeners: Array<{
        id: string
        onChunk: (chunk: unknown) => void
        onDone: (result: { status: string }) => void | Promise<void>
      }>
    }) => {
      for (const listener of listeners) {
        for (const part of parts) {
          listener.onChunk(part)
        }
        await listener.onDone({ status: 'success' })
      }
    }
  )
}

function createMockAdapter(overrides: Record<string, unknown> = {}) {
  const adapter = new EventEmitter() as any
  adapter.agentId = overrides.agentId ?? 'agent-1'
  adapter.channelId = overrides.channelId ?? 'channel-1'
  adapter.channelType = overrides.channelType ?? 'telegram'
  adapter.connected = true
  adapter.sendMessage = vi.fn().mockResolvedValue(undefined)
  adapter.sendTypingIndicator = vi.fn().mockResolvedValue(undefined)
  adapter.onTextUpdate = vi.fn().mockResolvedValue(undefined)
  adapter.onStreamComplete = vi.fn().mockResolvedValue(false)
  adapter.onStreamError = vi.fn().mockResolvedValue(undefined)
  adapter.notifyChatIds = []
  return adapter
}

function msg(text: string): ChannelMessageEvent {
  return { chatId: 'chat-1', userId: 'user-1', userName: 'User', text }
}

function pendingBatchCount(handler: ChannelMessageHandler): number {
  return (handler as unknown as { pendingBatches: Map<string, unknown> }).pendingBatches.size
}

function pendingAdmissionCount(handler: ChannelMessageHandler): number {
  return (handler as unknown as { pendingAdmissions: Map<string, Promise<void>> }).pendingAdmissions.size
}

// Delegate coverage below constructs the manager directly, like ChannelManager.test.ts —
// BaseService's singleton guard allows one instance per module registry.
const channelManager = new ChannelManager()

describe('ChannelMessageHandler write quiesce', () => {
  // Fresh instance per test so pauseHolds / pendingAdmissions never leak between tests
  // (and never touch the module singleton that ChannelMessageHandler.test.ts drives).
  let handler: ChannelMessageHandler

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    // Restore default agent mock after clearAllMocks
    vi.mocked(agentService.getAgent).mockReturnValue({
      id: 'agent-1',
      configuration: {},
      model: 'openai::gpt-4'
    } as any)
    handler = new ChannelMessageHandler()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('pause() flushes the buffered batch immediately without waiting out the debounce timer', async () => {
    const adapter = createMockAdapter()
    vi.mocked(agentSessionService.create).mockReturnValue(SESSION as any)
    simulateStream([{ type: 'text-delta', delta: 'OK' }])

    const turn = handler.handleIncoming(adapter, msg('Hi'))
    // Still buffered — the 8 s debounce has not been advanced.
    expect(mockStartAgentSessionRun).not.toHaveBeenCalled()

    const hold = handler.pause('restore')
    // Settles on microtasks alone — no vi.advanceTimersByTimeAsync anywhere.
    await turn
    expect(mockStartAgentSessionRun).toHaveBeenCalledTimes(1)
    hold.dispose()
  })

  it('a second hold does not re-flush — the run starts exactly once', async () => {
    const adapter = createMockAdapter()
    vi.mocked(agentSessionService.create).mockReturnValue(SESSION as any)
    simulateStream([{ type: 'text-delta', delta: 'OK' }])

    const turn = handler.handleIncoming(adapter, msg('Hi'))
    const h1 = handler.pause()
    const h2 = handler.pause()

    await turn
    expect(mockStartAgentSessionRun).toHaveBeenCalledTimes(1)
    h1.dispose()
    h2.dispose()
  })

  it('handleIncoming while quiesced resolves (not rejects) and creates no batch', async () => {
    const adapter = createMockAdapter()
    const hold = handler.pause()

    await expect(handler.handleIncoming(adapter, msg('dropped'))).resolves.toBeUndefined()

    expect(pendingBatchCount(handler)).toBe(0)
    expect(mockStartAgentSessionRun).not.toHaveBeenCalled()
    hold.dispose()
  })

  it('handleCommand while quiesced is dropped without side effects', async () => {
    const adapter = createMockAdapter()
    const hold = handler.pause()

    await handler.handleCommand(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      command: 'new'
    })

    expect(agentSessionService.create).not.toHaveBeenCalled()
    expect(channelService.updateChannel).not.toHaveBeenCalled()
    expect(adapter.sendMessage).not.toHaveBeenCalled()
    hold.dispose()
  })

  it('drainInFlight resolves at turn admission, not at turn completion', async () => {
    const adapter = createMockAdapter()
    vi.mocked(agentSessionService.create).mockReturnValue(SESSION as any)
    // Admission lands (startAgentSessionRun resolves) but no listener ever fires, so the
    // sentinel's executionDone — and therefore the whole turn — stays pending forever.
    mockStartAgentSessionRun.mockResolvedValue(undefined)

    const turn = handler.handleIncoming(adapter, msg('Hi'))
    let turnSettled = false
    turn.finally(() => {
      turnSettled = true
    })
    const hold = handler.pause()

    await expect(handler.drainInFlight({ timeoutMs: 1000 })).resolves.toEqual({ stragglerIds: [] })

    expect(mockStartAgentSessionRun).toHaveBeenCalledTimes(1)
    expect(pendingAdmissionCount(handler)).toBe(0)
    // The turn itself never completed — the drain verdict did not wait for it.
    await Promise.resolve()
    expect(turnSettled).toBe(false)
    hold.dispose()
  })

  it('an early-return processIncoming still settles its admission (backstop onAdmitted)', async () => {
    const adapter = createMockAdapter()
    // Orphan session: agentId === null makes processIncoming bail before startAgentSessionRun.
    vi.mocked(agentSessionService.create).mockReturnValue({ id: 'orphan-session', agentId: null } as any)

    const turn = handler.handleIncoming(adapter, msg('Hi'))
    const hold = handler.pause()

    await expect(handler.drainInFlight({ timeoutMs: 1000 })).resolves.toEqual({ stragglerIds: [] })

    expect(mockStartAgentSessionRun).not.toHaveBeenCalled()
    expect(pendingAdmissionCount(handler)).toBe(0)
    await turn // the bailed batch resolved its callers cleanly
    hold.dispose()
  })

  it('drainInFlight times out and reports stragglers without aborting them', async () => {
    const adapter = createMockAdapter()
    vi.mocked(agentSessionService.create).mockReturnValue(SESSION as any)
    // Hangs before admission: startAgentSessionRun never settles.
    mockStartAgentSessionRun.mockImplementation(() => new Promise(() => {}))

    const turn = handler.handleIncoming(adapter, msg('Hi'))
    turn.catch(() => {})
    const hold = handler.pause()

    // The flushed-but-unadmitted batch is visible as active work.
    expect(handler.listActiveWork()).toEqual([
      {
        id: expect.stringMatching(/^agent-1:channel-1:chat-1#\d+$/),
        summary: 'flushed batch awaiting turn admission'
      }
    ])

    const drain = handler.drainInFlight({ timeoutMs: 50 })
    await vi.advanceTimersByTimeAsync(60)
    const result = await drain

    expect(result.stragglerIds).toHaveLength(1)
    expect(result.stragglerIds[0]).toMatch(/^agent-1:channel-1:chat-1#\d+$/)
    // Timing out never aborts the straggler — its admission entry is still registered.
    expect(pendingAdmissionCount(handler)).toBe(1)
    hold.dispose()
  })

  it('holds are refcounted, dispose is idempotent, and an undisposed hold fails closed', () => {
    expect(handler.isWriteQuiesced).toBe(false)

    const h1 = handler.pause('first')
    const h2 = handler.pause('second')
    expect(handler.isWriteQuiesced).toBe(true)

    h1.dispose()
    expect(handler.isWriteQuiesced).toBe(true) // h2 still holds the gate

    // Idempotent double-dispose must not release h2's hold.
    h1.dispose()
    expect(handler.isWriteQuiesced).toBe(true)

    h2.dispose()
    expect(handler.isWriteQuiesced).toBe(false)

    // Fails closed: a hold that is never disposed keeps the gate on.
    handler.pause('never-released')
    expect(handler.isWriteQuiesced).toBe(true)
  })

  it('listActiveWork lists a buffered batch before flush', async () => {
    const adapter = createMockAdapter()

    const turn = handler.handleIncoming(adapter, msg('Hi'))
    turn.catch(() => {})

    expect(handler.listActiveWork()).toEqual([{ id: 'agent-1:channel-1:chat-1', summary: 'buffered=1' }])

    // Discard the pending batch so its debounce timer and promise don't outlive the test.
    handler.clearSessionTracker('agent-1')
    await expect(turn).rejects.toThrow('Agent removed; batch discarded')
  })
})

describe('ChannelManager write-quiesce delegates', () => {
  it('pause / drainInFlight / listActiveWork delegate to the channelMessageHandler singleton', async () => {
    expect(channelMessageHandler.isWriteQuiesced).toBe(false)

    const hold = channelManager.pause('delegate-test')
    try {
      expect(channelMessageHandler.isWriteQuiesced).toBe(true)
      expect(channelManager.listActiveWork()).toEqual([])
      await expect(channelManager.drainInFlight({ timeoutMs: 10 })).resolves.toEqual({ stragglerIds: [] })
    } finally {
      hold.dispose()
    }

    expect(channelMessageHandler.isWriteQuiesced).toBe(false)
  })
})
