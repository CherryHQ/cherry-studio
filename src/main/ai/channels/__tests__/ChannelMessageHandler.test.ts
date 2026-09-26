import { EventEmitter } from 'events'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { buildAgentSessionTopicId } from '@main/ai/agentSession/topic'
import { AgentSessionWorkspaceError } from '@main/ai/runtime/agentSessionWorkspace'
import { AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY } from '@shared/ai/agentSessionSlashCommands'

import type { ChannelCommandEvent, ChannelMessageEvent } from '../ChannelAdapter'
import { ChannelMessageHandler, channelMessageHandler } from '../ChannelMessageHandler'
import { isSlashCommand } from '../constants'
import { sanitizeChannelOutput } from '../security/OutputSanitizer'

const { mockPrepareAgentSessionWorkspaceDirectory, MockAgentSessionWorkspaceError } = vi.hoisted(() => {
  class MockAgentSessionWorkspaceError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'AgentSessionWorkspaceError'
    }
  }

  return {
    mockPrepareAgentSessionWorkspaceDirectory: vi.fn(),
    MockAgentSessionWorkspaceError
  }
})

const persistedChannelSessions = vi.hoisted(() => ({
  bindings: new Map<string, string>(),
  sessions: new Map<string, Record<string, unknown>>()
}))

vi.mock('@main/ai/runtime/agentSessionWorkspace', () => ({
  AgentSessionWorkspaceError: MockAgentSessionWorkspaceError,
  isAgentSessionWorkspaceError: (error: unknown) => error instanceof MockAgentSessionWorkspaceError,
  prepareAgentSessionWorkspaceDirectory: mockPrepareAgentSessionWorkspaceDirectory
}))

const { mockLogError } = vi.hoisted(() => ({ mockLogError: vi.fn() }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: mockLogError, warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('../security/OutputSanitizer', () => ({
  sanitizeChannelOutput: vi.fn((text: string) => ({ text, redacted: false }))
}))

// The global mock (tests/main.setup.ts) wires the default service set, which omits
// AiStreamManager; the abort path reads it, so override locally with a captured spy.
const { mockStreamAbort } = vi.hoisted(() => ({ mockStreamAbort: vi.fn() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ AiStreamManager: { abort: mockStreamAbort } } as never)
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
  agentSessionService: (() => {
    const create = vi.fn()
    return {
      getById: vi.fn((id: string) => persistedChannelSessions.sessions.get(id)),
      create,
      createTx: vi.fn((_tx: unknown, id: string, dto: Record<string, unknown>) => {
        const template = create(dto) ?? { agentId: dto.agentId, workspace: { path: '/tmp/test-workspace' } }
        persistedChannelSessions.sessions.set(id, { ...template, id })
      }),
      notifyReadModelChange: vi.fn()
    }
  })()
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
    findBySessionId: vi.fn().mockResolvedValue(null),
    getActiveSessionId: vi.fn((channelId: string, conversationId: string) =>
      persistedChannelSessions.bindings.get(`${channelId}:${conversationId}`)
    ),
    activateSessionTx: vi.fn(
      (_tx: unknown, input: { channelId: string; conversationId: string; sessionId: string }) => {
        persistedChannelSessions.bindings.set(`${input.channelId}:${input.conversationId}`, input.sessionId)
      }
    )
  }
}))

/**
 * Helper: configure mockStartAgentSessionRun to simulate streaming chunks to ALL
 * registered listeners (both the `channel-completion:` sentinel and the
 * `ChannelAdapterListener` that owns delivery), then call onDone on each so the
 * `executionDone` promise inside `collectStreamResponse` resolves and the listener
 * finalizes delivery. `text-delta` chunks carry the payload on `delta` (AI SDK
 * `UIMessageChunk`), not `text`.
 */
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
      return { mode: 'started' }
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

/**
 * Helper: call handleIncoming and advance fake timers so the debounce fires,
 * then await the returned promise to wait for processing to complete.
 */
async function handleIncomingAndFlush(adapter: ReturnType<typeof createMockAdapter>, message: ChannelMessageEvent) {
  const promise = channelMessageHandler.handleIncoming(adapter, { ...message })
  await vi.advanceTimersByTimeAsync(1000)
  return promise
}

describe('ChannelMessageHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    // Restore default agent mock after clearAllMocks
    vi.mocked(agentService.getAgent).mockReturnValue({
      id: 'agent-1',
      configuration: {},
      model: 'openai::gpt-4'
    } as any)
    mockPrepareAgentSessionWorkspaceDirectory.mockReset()
    mockPrepareAgentSessionWorkspaceDirectory.mockResolvedValue(undefined)
    persistedChannelSessions.bindings.clear()
    persistedChannelSessions.sessions.clear()
    vi.mocked(agentSessionService.getById).mockImplementation(
      (id) => persistedChannelSessions.sessions.get(id) as never
    )
    // Clear session tracker to ensure clean state
    channelMessageHandler.clearSessionTracker('agent-1')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('collectStreamResponse accumulates text across turns and sends via adapter', async () => {
    const adapter = createMockAdapter()
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      agentType: 'claude-code',
      model: 'openai::gpt-4',
      workspace: { path: '/tmp/test-workspace' },
      configuration: {}
    }

    vi.mocked(agentSessionService.create).mockReturnValueOnce(session as any)
    simulateStream([
      { type: 'text-delta', delta: 'Hello ' },
      { type: 'text-delta', delta: 'world!' },
      { type: 'text-end' },
      { type: 'text-delta', delta: '\n\nDone.' },
      { type: 'text-end' }
    ])

    await handleIncomingAndFlush(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'Hi'
    })

    // Delivery is owned by ChannelAdapterListener (the handler no longer post-sends);
    // it accumulates all text-delta chunks via `.delta`, trims, and sends once.
    expect(adapter.sendMessage).toHaveBeenCalledTimes(1)
    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'Hello world!\n\nDone.', undefined)
  })

  it('settles a busy channel message and leaves the chat queue usable', async () => {
    const adapter = createMockAdapter()
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      agentType: 'claude-code',
      model: 'openai::gpt-4',
      workspace: { path: '/tmp/test-workspace' },
      configuration: {}
    }
    vi.mocked(agentSessionService.create).mockReturnValue(session as any)
    mockStartAgentSessionRun.mockResolvedValueOnce({ mode: 'not-started', reason: 'busy' })

    await handleIncomingAndFlush(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'first'
    })

    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'The Agent Session is busy. Please try again shortly.', {
      replyToMessageId: undefined
    })
    const typingCallsAfterBusy = adapter.sendTypingIndicator.mock.calls.length
    await vi.advanceTimersByTimeAsync(8_000)
    expect(adapter.sendTypingIndicator).toHaveBeenCalledTimes(typingCallsAfterBusy)

    simulateStream([{ type: 'text-delta', delta: 'second completed' }])
    await handleIncomingAndFlush(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'second'
    })
    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'second completed', undefined)
  })

  // channels-core-3: the streaming delivery path (real ChannelAdapterListener) must route
  // output through the OutputSanitizer before sending — otherwise secrets in the model reply
  // leak to the IM platform. simulateStream drives the real listener, so a redacting sanitizer
  // must be reflected in what the adapter sends.
  it('routes channel output through the OutputSanitizer before delivery (REGRESSION channels-core-3)', async () => {
    const adapter = createMockAdapter()
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      agentType: 'claude-code',
      model: 'openai::gpt-4',
      workspace: { path: '/tmp/test-workspace' },
      configuration: {}
    }
    vi.mocked(agentSessionService.create).mockReturnValueOnce(session as any)

    vi.mocked(sanitizeChannelOutput).mockImplementation((text: string) => ({
      text: text.replace('sk-SECRET', '<redacted>'),
      redacted: text.includes('sk-SECRET')
    }))
    simulateStream([{ type: 'text-delta', delta: 'the key is sk-SECRET' }])

    await handleIncomingAndFlush(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'Hi'
    })

    expect(sanitizeChannelOutput).toHaveBeenCalled()
    // The redacted text — not the raw secret — is what reaches the adapter.
    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'the key is <redacted>', undefined)

    // Restore the identity default so later tests are unaffected.
    vi.mocked(sanitizeChannelOutput).mockImplementation((text: string) => ({ text, redacted: false }))
  })

  // stream-context-5: a workspace error is thrown before streaming starts, so onStreamError
  // (a no-op without a live controller on most adapters) can't surface it. The handler must
  // fall back to a plain sendMessage so the inbound message isn't silently dropped.
  it('surfaces a pre-stream workspace error as a plain message (REGRESSION stream-context-5)', async () => {
    const adapter = createMockAdapter()
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      agentType: 'claude-code',
      model: 'openai::gpt-4',
      workspace: { path: '/tmp/test-workspace' },
      configuration: {}
    }
    vi.mocked(agentSessionService.create).mockReturnValueOnce(session as any)
    mockStartAgentSessionRun.mockRejectedValueOnce(new AgentSessionWorkspaceError('workspace is missing'))

    await handleIncomingAndFlush(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'Hi'
    })

    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'workspace is missing', { replyToMessageId: undefined })
    expect(adapter.onStreamError).not.toHaveBeenCalled()
  })

  it('validates the workspace before persisting channel attachments', async () => {
    const adapter = createMockAdapter()
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      agentType: 'claude-code',
      model: 'openai::gpt-4',
      workspaceId: 'workspace-1',
      workspace: {
        id: 'workspace-1',
        name: 'Workspace',
        path: '/tmp/test-workspace',
        type: 'user',
        orderKey: 'a0',
        createdAt: '2026-05-20T00:00:00.000Z',
        updatedAt: '2026-05-20T00:00:00.000Z'
      },
      configuration: {}
    }
    vi.mocked(agentSessionService.create).mockReturnValueOnce(session as any)
    mockPrepareAgentSessionWorkspaceDirectory.mockRejectedValueOnce(
      new AgentSessionWorkspaceError('workspace is missing')
    )

    await handleIncomingAndFlush(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'Hi',
      images: [{ media_type: 'image/png', data: 'AA==' }]
    })

    expect(mockPrepareAgentSessionWorkspaceDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1', workspace: session.workspace })
    )
    expect(mockStartAgentSessionRun).not.toHaveBeenCalled()
    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'workspace is missing', { replyToMessageId: undefined })
  })

  it('confines an image with a hostile media type to channel-images as .png', async () => {
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'channel-images-'))
    try {
      const adapter = createMockAdapter()
      const session = {
        id: 'session-1',
        agentId: 'agent-1',
        agentType: 'claude-code',
        model: 'openai::gpt-4',
        workspace: { path: workDir },
        configuration: {}
      }
      vi.mocked(agentSessionService.create).mockReturnValueOnce(session as any)
      simulateStream([{ type: 'text-delta', delta: 'ok' }])

      await handleIncomingAndFlush(adapter, {
        chatId: 'chat-1',
        userId: 'user-1',
        userName: 'User',
        text: 'Hi',
        images: [{ media_type: 'image/a\\..\\..\\..\\evil', data: Buffer.from('img').toString('base64') }]
      })

      const written = await readdir(path.join(workDir, '.cherry-studio', 'channel-images'))
      expect(written).toHaveLength(1)
      expect(written[0]).toMatch(/\.png$/)
      expect(await readdir(workDir)).toEqual(['.cherry-studio'])
      expect(await readdir(path.join(workDir, '.cherry-studio'))).toEqual(['channel-images'])
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  })

  it('skips final send when adapter handles stream completion', async () => {
    const adapter = createMockAdapter()
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      agentType: 'claude-code',
      model: 'openai::gpt-4',
      workspace: { path: '/tmp/test-workspace' },
      configuration: {}
    }

    adapter.onStreamComplete.mockResolvedValueOnce(true)
    vi.mocked(agentSessionService.create).mockReturnValueOnce(session as any)
    simulateStream([{ type: 'text-delta', delta: 'Hello world!' }])

    await handleIncomingAndFlush(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'Hi'
    })

    expect(adapter.onStreamComplete).toHaveBeenCalledWith('chat-1', 'Hello world!', undefined)
    expect(adapter.sendMessage).not.toHaveBeenCalled()
  })

  it('delivers a long response in a single send (platform splitting is the adapter concern)', async () => {
    const adapter = createMockAdapter()
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      agentType: 'claude-code',
      model: 'openai::gpt-4',
      workspace: { path: '/tmp/test-workspace' },
      configuration: {}
    }

    vi.mocked(agentSessionService.create).mockReturnValueOnce(session as any)

    const longText = 'A'.repeat(5000)
    simulateStream([{ type: 'text-delta', delta: longText }])

    await handleIncomingAndFlush(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'Hi'
    })

    // The handler-level 4096-char chunking was dead code (post-hoc path never ran)
    // and has been removed; ChannelAdapterListener delivers the full text once and
    // each adapter splits per its own platform limit.
    expect(adapter.sendMessage).toHaveBeenCalledTimes(1)
    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', longText, undefined)
  })

  it('handleCommand /new creates a new session in the channel-bound workspace', async () => {
    const adapter = createMockAdapter()
    vi.mocked(channelService.getChannel).mockReturnValueOnce({
      id: 'channel-1',
      sessionId: null,
      permissionMode: null,
      workspace: { type: 'user', workspaceId: 'workspace-bound' }
    } as any)
    vi.mocked(agentSessionService.create).mockReturnValueOnce({ id: 'new-session' } as any)

    await channelMessageHandler.handleCommand(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      command: 'new'
    })

    expect(agentSessionService.createTx).toHaveBeenCalledWith(expect.anything(), expect.any(String), {
      agentId: 'agent-1',
      name: 'Channel session',
      workspace: { type: 'user', workspaceId: 'workspace-bound' }
    })
    expect(channelService.activateSessionTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channelId: 'channel-1',
        conversationId: 'chat-1'
      })
    )
    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'New session created.', { replyToMessageId: undefined })
  })

  it('handleCommand /compact sends /compact as message content', async () => {
    const adapter = createMockAdapter()
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      agentType: 'claude-code',
      model: 'openai::gpt-4',
      workspace: { path: '/tmp/test-workspace' },
      configuration: {}
    }

    vi.mocked(agentSessionService.create).mockReturnValueOnce(session as any)
    simulateStream([{ type: 'text-delta', delta: 'Compacted.' }])

    await channelMessageHandler.handleCommand(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      command: 'compact'
    })

    const createdSessionId = vi.mocked(agentSessionService.createTx).mock.calls[0][1]
    expect(mockStartAgentSessionRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: createdSessionId,
        userParts: [{ type: 'text', text: '/compact' }],
        // Channel-triggered runs have no interactive responder — headless keeps AskUserQuestion
        // disallowed so the run can't stall on an approval prompt.
        headless: true,
        requireIdle: { expectedAgentId: 'agent-1' },
        listeners: expect.arrayContaining([
          expect.objectContaining({ id: expect.stringContaining('channel-completion:') })
        ])
      })
    )
    // ChannelAdapterListener delivers the compact output once; the handler no longer
    // also sends it (would have been a double-send once the `.delta` read was fixed).
    expect(adapter.sendMessage).toHaveBeenCalledTimes(1)
    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'Compacted.', undefined)
  })

  it('serializes commands after earlier messages in the same conversation', async () => {
    const adapter = createMockAdapter()
    let releaseStream!: () => void
    let markStreamStarted!: () => void
    const streamStarted = new Promise<void>((resolve) => (markStreamStarted = resolve))

    mockStartAgentSessionRun.mockImplementationOnce(
      async ({ listeners }: { listeners: Array<{ onDone: (result: { status: string }) => void | Promise<void> }> }) => {
        markStreamStarted()
        await new Promise<void>((resolve) => (releaseStream = resolve))
        for (const listener of listeners) await listener.onDone({ status: 'success' })
      }
    )

    const message = channelMessageHandler.handleIncoming(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'Use the current session'
    })
    const command = channelMessageHandler.handleCommand(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      command: 'new'
    })

    await streamStarted
    expect(agentSessionService.createTx).toHaveBeenCalledTimes(1)
    expect(adapter.sendMessage).not.toHaveBeenCalledWith('chat-1', 'New session created.', expect.anything())

    releaseStream()
    await Promise.all([message, command])

    expect(agentSessionService.createTx).toHaveBeenCalledTimes(2)
    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'New session created.', {
      replyToMessageId: undefined
    })
  })

  it('handleCommand /help sends help text with agent info', async () => {
    const adapter = createMockAdapter()
    vi.mocked(agentService.getAgent).mockReturnValueOnce({
      name: 'TestAgent',
      description: 'A test agent'
    } as any)

    await channelMessageHandler.handleCommand(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      command: 'help'
    })

    expect(adapter.sendMessage).toHaveBeenCalledTimes(1)
    const helpText = adapter.sendMessage.mock.calls[0][1] as string
    expect(helpText).toContain('*TestAgent*')
    expect(helpText).toContain('_A test agent_')
    expect(helpText).toContain('Available commands:')
    expect(helpText).toContain('/new')
    expect(helpText).toContain('/compact')
    expect(helpText).toContain('/help')
    expect(helpText).toContain('/whoami')
    expect(helpText).toContain('/stop')
  })

  it('handleCommand /help merges the bound session slash commands (control wins on collision)', async () => {
    const adapter = createMockAdapter()
    vi.mocked(agentService.getAgent).mockResolvedValueOnce({ name: 'TestAgent', description: '' } as any)
    persistedChannelSessions.bindings.set('channel-1:chat-merge', 'session-xyz')
    persistedChannelSessions.sessions.set('session-xyz', { id: 'session-xyz', agentId: 'agent-1' })
    MockMainCacheServiceUtils.setSharedCacheValue(AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY('session-xyz'), [
      { name: 'deploy', description: 'Deploy the app', argumentHint: '' },
      // Collides with the control command — control description must win, session dup dropped.
      { name: 'compact', description: 'session dup', argumentHint: '' },
      { name: 'stop', description: 'session stop dup', argumentHint: '' }
    ])

    try {
      await channelMessageHandler.handleCommand(adapter, {
        chatId: 'chat-merge',
        userId: 'user-1',
        userName: 'User',
        command: 'help'
      })

      const helpText = adapter.sendMessage.mock.calls[0][1] as string
      expect(helpText).toContain('/deploy - Deploy the app')
      expect(helpText).toContain('/compact - Compact conversation history')
      expect(helpText).not.toContain('session dup')
      expect(helpText).toContain('/stop - Cancel the current turn')
      expect(helpText).not.toContain('session stop dup')
    } finally {
      MockMainCacheServiceUtils.setSharedCacheValue(AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY('session-xyz'), null)
    }
  })

  it('handleCommand /help ignores a channel session that belongs to another agent', async () => {
    const adapter = createMockAdapter()
    vi.mocked(agentService.getAgent).mockResolvedValueOnce({ name: 'TestAgent', description: '' } as any)
    persistedChannelSessions.bindings.set('channel-1:chat-stale', 'stale-session')
    persistedChannelSessions.sessions.set('stale-session', { id: 'stale-session', agentId: 'other-agent' })
    MockMainCacheServiceUtils.setSharedCacheValue(AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY('stale-session'), [
      { name: 'leak', description: 'commands from the wrong agent', argumentHint: '' }
    ])

    try {
      await channelMessageHandler.handleCommand(adapter, {
        chatId: 'chat-stale',
        userId: 'user-1',
        userName: 'User',
        command: 'help'
      })

      const helpText = adapter.sendMessage.mock.calls[0][1] as string
      expect(helpText).not.toContain('/leak')
      // Control commands are still listed — only the foreign session catalog is withheld.
      expect(helpText).toContain('/new')
    } finally {
      MockMainCacheServiceUtils.setSharedCacheValue(AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY('stale-session'), null)
    }
  })

  it('handleCommand /whoami sends the current chat ID', async () => {
    const adapter = createMockAdapter()

    await channelMessageHandler.handleCommand(adapter, {
      chatId: 'oc_123',
      userId: 'user-1',
      userName: 'User',
      command: 'whoami'
    })

    expect(adapter.sendMessage).toHaveBeenCalledWith(
      'oc_123',
      'Current chat ID: `oc_123`\n\nAdd this value to `allowed_chat_ids` (or `allowed_channel_ids` for Discord) in settings to receive notifications.',
      { replyToMessageId: undefined }
    )
  })

  it('resolveSession tracks sessions after /new', async () => {
    const adapter = createMockAdapter()
    const newSession = {
      id: 'new-session',
      agentId: 'agent-1',
      agentType: 'claude-code',
      model: 'openai::gpt-4',
      workspace: { path: '/tmp/test-workspace' },
      configuration: {}
    }

    vi.mocked(agentSessionService.create).mockReturnValueOnce(newSession as any)

    await channelMessageHandler.handleCommand(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      command: 'new'
    })

    const createdSessionId = vi.mocked(agentSessionService.createTx).mock.calls[0][1]
    simulateStream([{ type: 'text-delta', delta: 'OK' }])

    await handleIncomingAndFlush(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'test'
    })

    expect(agentSessionService.getById).toHaveBeenCalledWith(createdSessionId)
  })

  it('clearSessionTracker causes fresh session resolution', async () => {
    const adapter = createMockAdapter()
    const session1 = {
      id: 'session-1',
      agentId: 'agent-1',
      agentType: 'claude-code',
      model: 'openai::gpt-4',
      workspace: { path: '/tmp/test-workspace' },
      configuration: {}
    }

    // First interaction creates a session
    vi.mocked(agentSessionService.create).mockReturnValueOnce(session1 as any)
    simulateStream([{ type: 'text-delta', delta: 'R1' }])

    await handleIncomingAndFlush(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'msg1'
    })

    // Clear session tracker
    channelMessageHandler.clearSessionTracker('agent-1')

    // Next interaction should restore the persisted conversation binding.
    simulateStream([{ type: 'text-delta', delta: 'R2' }])

    await handleIncomingAndFlush(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'msg2'
    })

    expect(channelService.getActiveSessionId).toHaveBeenCalledWith('channel-1', 'chat-1')
    expect(agentSessionService.create).toHaveBeenCalledTimes(1)
  })

  it('keeps conversations isolated and restores each persisted session after tracker reset', async () => {
    const adapter = createMockAdapter({ channelType: 'feishu' })

    for (const chatId of ['dm-alice', 'dm-bob']) {
      simulateStream([{ type: 'text-delta', delta: `reply:${chatId}` }])
      await handleIncomingAndFlush(adapter, {
        chatId,
        userId: chatId,
        userName: chatId,
        text: 'hello'
      })
    }

    channelMessageHandler.clearSessionTracker('agent-1')
    simulateStream([{ type: 'text-delta', delta: 'welcome back' }])
    await handleIncomingAndFlush(adapter, {
      chatId: 'dm-alice',
      userId: 'dm-alice',
      userName: 'Alice',
      text: 'again'
    })

    const sessionIds = mockStartAgentSessionRun.mock.calls.map(([input]) => input.sessionId)
    expect(sessionIds[0]).not.toBe(sessionIds[1])
    const listenerIds = mockStartAgentSessionRun.mock.calls.map(
      ([input]) => input.listeners.find((listener: { id: string }) => listener.id.startsWith('channel:'))?.id
    )
    expect(listenerIds[0]).not.toBe(listenerIds[1])
    expect(sessionIds[2]).toBe(sessionIds[0])
    expect(agentSessionService.createTx).toHaveBeenCalledTimes(2)
  })

  it('dispatches a single message after exactly one second', async () => {
    const adapter = createMockAdapter()
    simulateStream([{ type: 'text-delta', delta: 'reply' }])

    const turn = channelMessageHandler.handleIncoming(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'hello'
    })

    await vi.advanceTimersByTimeAsync(999)
    expect(mockStartAgentSessionRun).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await turn
    expect(mockStartAgentSessionRun).toHaveBeenCalledTimes(1)
  })

  it('dispatches a merged batch one second after the latest rapid message', async () => {
    const adapter = createMockAdapter()
    simulateStream([{ type: 'text-delta', delta: 'reply' }])

    const first = channelMessageHandler.handleIncoming(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'first'
    })
    await vi.advanceTimersByTimeAsync(500)
    const second = channelMessageHandler.handleIncoming(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'second'
    })

    await vi.advanceTimersByTimeAsync(999)
    expect(mockStartAgentSessionRun).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await Promise.all([first, second])
    expect(mockStartAgentSessionRun).toHaveBeenCalledTimes(1)
    expect(mockStartAgentSessionRun.mock.calls[0][0].userParts[0].text).toBe('first\nsecond')
  })

  it('flushes a sustained message burst at the original sixteen-second deadline', async () => {
    const adapter = createMockAdapter()
    simulateStream([{ type: 'text-delta', delta: 'reply' }])
    const turns = [
      channelMessageHandler.handleIncoming(adapter, {
        chatId: 'chat-1',
        userId: 'user-1',
        userName: 'User',
        text: 'message-0'
      })
    ]

    for (let index = 1; index <= 17; index++) {
      await vi.advanceTimersByTimeAsync(900)
      turns.push(
        channelMessageHandler.handleIncoming(adapter, {
          chatId: 'chat-1',
          userId: 'user-1',
          userName: 'User',
          text: `message-${index}`
        })
      )
    }

    await vi.advanceTimersByTimeAsync(699)
    expect(mockStartAgentSessionRun).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await Promise.all(turns)
    expect(mockStartAgentSessionRun).toHaveBeenCalledTimes(1)
    expect(mockStartAgentSessionRun.mock.calls[0][0].userParts[0].text).toBe(
      Array.from({ length: 18 }, (_, index) => `message-${index}`).join('\n')
    )
  })

  it('preserves first-arrival order across senders whose debounce timers expire out of order', async () => {
    const adapter = createMockAdapter()
    simulateStream([{ type: 'text-delta', delta: 'A reply' }])
    simulateStream([{ type: 'text-delta', delta: 'B reply' }])

    const firstA = channelMessageHandler.handleIncoming(adapter, {
      chatId: 'group-1',
      userId: 'alice',
      userName: 'Alice',
      text: 'A1'
    })
    await vi.advanceTimersByTimeAsync(100)
    const B = channelMessageHandler.handleIncoming(adapter, {
      chatId: 'group-1',
      userId: 'bob',
      userName: 'Bob',
      text: 'B1'
    })
    await vi.advanceTimersByTimeAsync(100)
    const secondA = channelMessageHandler.handleIncoming(adapter, {
      chatId: 'group-1',
      userId: 'alice',
      userName: 'Alice',
      text: 'A2'
    })

    await vi.advanceTimersByTimeAsync(1000)
    await Promise.all([firstA, B, secondA])

    expect(mockStartAgentSessionRun.mock.calls.map(([input]) => input.userParts[0].text)).toEqual(['A1\nA2', 'B1'])
  })

  it('caps a sender debounce so queued messages from another sender are eventually admitted', async () => {
    const adapter = createMockAdapter()
    simulateStream([{ type: 'text-delta', delta: 'A reply' }])
    simulateStream([{ type: 'text-delta', delta: 'B reply' }])

    const turns = [
      channelMessageHandler.handleIncoming(adapter, {
        chatId: 'group-1',
        userId: 'alice',
        userName: 'Alice',
        text: 'A0'
      })
    ]
    await vi.advanceTimersByTimeAsync(100)
    const B = channelMessageHandler.handleIncoming(adapter, {
      chatId: 'group-1',
      userId: 'bob',
      userName: 'Bob',
      text: 'B1'
    })

    for (let index = 1; index <= 17; index++) {
      await vi.advanceTimersByTimeAsync(index === 1 ? 800 : 900)
      turns.push(
        channelMessageHandler.handleIncoming(adapter, {
          chatId: 'group-1',
          userId: 'alice',
          userName: 'Alice',
          text: `A${index}`
        })
      )
    }

    await vi.advanceTimersByTimeAsync(700)
    await Promise.all([...turns, B])

    expect(mockStartAgentSessionRun.mock.calls.map(([input]) => input.userParts[0].text)).toEqual([
      Array.from({ length: 18 }, (_, index) => `A${index}`).join('\n'),
      'B1'
    ])
  })

  it('isolates threads in the same chat and preserves their reply context', async () => {
    const adapter = createMockAdapter({ channelType: 'feishu' })

    for (const conversationId of ['thread:one', 'thread:two']) {
      simulateStream([{ type: 'text-delta', delta: conversationId }])
      await handleIncomingAndFlush(adapter, {
        chatId: 'group-1',
        conversationId,
        userId: 'user-1',
        userName: 'User',
        messageId: `${conversationId}:message`,
        replyInThread: true,
        text: 'hello'
      })
    }

    const sessionIds = mockStartAgentSessionRun.mock.calls.map(([input]) => input.sessionId)
    expect(sessionIds[0]).not.toBe(sessionIds[1])
    expect(channelService.activateSessionTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ conversationId: 'thread:one' })
    )
    expect(adapter.sendMessage).toHaveBeenCalledWith('group-1', 'thread:one', {
      replyToMessageId: 'thread:one:message',
      replyInThread: true
    })
    expect(adapter.sendMessage).toHaveBeenCalledWith('group-1', 'thread:two', {
      replyToMessageId: 'thread:two:message',
      replyInThread: true
    })
  })

  // channels-core-3: discarding a pending (un-flushed) batch must settle its callers'
  // handleIncoming promises instead of leaving them hanging forever, so .catch fires.
  it('clearSessionTracker rejects pending-batch handleIncoming promises', async () => {
    const adapter = createMockAdapter()

    // Start a batch but do NOT advance timers — it stays pending in pendingBatches.
    const pending = channelMessageHandler.handleIncoming(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'Hi'
    })
    const rejection = expect(pending).rejects.toThrow('Agent removed; batch discarded')

    // Clearing the agent's tracker discards the pending batch.
    channelMessageHandler.clearSessionTracker('agent-1')

    await rejection
    expect(mockStartAgentSessionRun).not.toHaveBeenCalled()
  })

  describe('/stop', () => {
    let handler: ChannelMessageHandler
    let adapter: ReturnType<typeof createMockAdapter>
    let holdRuns: boolean
    const runs = new Map<string, { onPaused: () => void; onDone: () => void }>()
    const incoming: ChannelMessageEvent = {
      chatId: 'chat-stop',
      conversationId: 'thread-stop',
      userId: 'user-1',
      userName: 'User',
      text: 'Run'
    }
    const stop: ChannelCommandEvent = {
      chatId: 'chat-stop',
      conversationId: 'thread-stop',
      userId: 'user-1',
      userName: 'User',
      command: 'stop',
      messageId: 'stop-message',
      replyInThread: true
    }

    function bind(
      conversationId = 'thread-stop',
      sessionId = 'session-stop',
      agentId = 'agent-1',
      channelId = 'channel-1'
    ) {
      persistedChannelSessions.bindings.set(`${channelId}:${conversationId}`, sessionId)
      persistedChannelSessions.sessions.set(sessionId, {
        id: sessionId,
        agentId,
        workspace: { path: '/tmp/test-workspace' },
        configuration: {}
      })
    }

    async function start(message = incoming, source = adapter) {
      const completion = handler.handleIncoming(source, message)
      await vi.advanceTimersByTimeAsync(1000)
      return { completion }
    }

    async function finish() {
      holdRuns = false
      for (const run of runs.values()) run.onDone()
      await vi.advanceTimersByTimeAsync(1000)
    }

    beforeEach(() => {
      handler = new ChannelMessageHandler()
      adapter = createMockAdapter()
      runs.clear()
      holdRuns = true
      mockStreamAbort.mockReset()
      mockStartAgentSessionRun.mockReset().mockImplementation(async ({ sessionId, listeners, beforePersist }) => {
        beforePersist?.()
        const sentinel = listeners.find((listener: { id: string }) => listener.id.startsWith('channel-completion:'))
        runs.set(sessionId, sentinel)
        if (!holdRuns) sentinel.onDone()
        return { mode: 'started' }
      })
      mockStreamAbort.mockImplementation((topicId: string) => {
        for (const [sessionId, run] of runs) {
          if (topicId === buildAgentSessionTopicId(sessionId)) run.onPaused()
        }
      })
    })

    afterEach(() => {
      mockStreamAbort.mockReset()
      mockStartAgentSessionRun.mockReset()
    })

    it('recognizes /stop as control input instead of sending it to the model', () => {
      expect(isSlashCommand('/stop')).toBe(true)
      expect(isSlashCommand('/stop now')).toBe(true)
      expect(isSlashCommand('/stopwatch')).toBe(false)
    })

    it('abortSession reports whether a channel turn is actually running', async () => {
      bind()
      expect(handler.abortSession('session-stop')).toBe(false)
      expect(mockStreamAbort.mock.calls).toEqual([])
      const { completion } = await start()
      try {
        expect(handler.abortSession('session-stop')).toBe(true)
        await completion
        expect(handler.abortSession('session-stop')).toBe(false)
        expect(mockStreamAbort.mock.calls).toEqual([
          [buildAgentSessionTopicId('session-stop'), 'channel-session-aborted']
        ])
      } finally {
        await finish()
      }
    })

    it('cancels the bound running turn immediately and keeps its binding and reply target', async () => {
      bind()
      const { completion } = await start()
      mockStreamAbort.mockImplementation(() => {})
      const stopped = handler.handleCommand(adapter, stop)
      try {
        await vi.advanceTimersByTimeAsync(0)
        expect(adapter.sendMessage.mock.calls).toEqual([
          ['chat-stop', 'Turn cancelled.', { replyToMessageId: 'stop-message', replyInThread: true }]
        ])
        expect(mockStreamAbort.mock.calls).toEqual([
          [buildAgentSessionTopicId('session-stop'), 'channel-session-aborted']
        ])
        expect(agentSessionService.createTx).not.toHaveBeenCalled()
        expect(persistedChannelSessions.bindings.get('channel-1:thread-stop')).toBe('session-stop')
      } finally {
        await finish()
        await Promise.all([completion, stopped])
      }
    })

    it.each(['bound', 'unbound', 'foreign-agent'] as const)(
      'reports no active turn for %s without creating or aborting a session',
      async (kind) => {
        if (kind !== 'unbound')
          bind('thread-stop', 'session-stop', kind === 'foreign-agent' ? 'other-agent' : 'agent-1')
        await handler.handleCommand(adapter, stop)
        expect(adapter.sendMessage.mock.calls).toEqual([
          ['chat-stop', 'No active turn to cancel.', { replyToMessageId: 'stop-message', replyInThread: true }]
        ])
        expect(mockStreamAbort.mock.calls).toEqual([])
        expect(agentSessionService.createTx).not.toHaveBeenCalled()
      }
    )

    it('reports abort failure explicitly and settles the command without rejecting', async () => {
      bind()
      const { completion } = await start()
      const discarded = handler.handleIncoming(adapter, { ...incoming, text: 'Discard despite abort failure' })
      let discardedSettled = false
      void discarded.then(() => {
        discardedSettled = true
      })
      mockStreamAbort.mockImplementationOnce(() => {
        throw new Error('abort failed')
      })
      let settled = false
      const stopped = handler.handleCommand(adapter, stop).then(() => {
        settled = true
      })
      try {
        await vi.advanceTimersByTimeAsync(0)
        expect(settled).toBe(true)
        expect(discardedSettled).toBe(true)
        expect(mockLogError).toHaveBeenCalledWith('Failed to cancel channel turn', {
          agentId: 'agent-1',
          channelId: 'channel-1',
          conversationId: 'thread-stop',
          error: 'abort failed'
        })
        expect(adapter.sendMessage.mock.calls).toEqual([
          [
            'chat-stop',
            'Failed to cancel the turn. Please try again.',
            { replyToMessageId: 'stop-message', replyInThread: true }
          ]
        ])
      } finally {
        await finish()
        await Promise.all([completion, discarded, stopped])
        expect(mockStartAgentSessionRun.mock.calls.map(([input]) => input.userParts)).toEqual([
          [{ type: 'text', text: 'Run' }]
        ])
      }
    })

    it('leaves another conversation running when stopping the target conversation', async () => {
      bind()
      bind('thread-other', 'session-other')
      const first = await start()
      const other = await start({ ...incoming, conversationId: 'thread-other' })
      let otherSettled = false
      void other.completion.then(() => {
        otherSettled = true
      })
      const stopped = handler.handleCommand(adapter, stop)
      try {
        await vi.advanceTimersByTimeAsync(0)
        expect(mockStreamAbort.mock.calls).toEqual([
          [buildAgentSessionTopicId('session-stop'), 'channel-session-aborted']
        ])
        expect(otherSettled).toBe(false)
        expect(adapter.sendMessage.mock.calls.map((call: unknown[]) => call[1])).toEqual(['Turn cancelled.'])
      } finally {
        await finish()
        await Promise.all([first.completion, other.completion, stopped])
      }
    })

    it.each([
      ['buffered', false],
      ['buffered', true],
      ['flushed', false],
      ['flushed', true]
    ] as const)('prevents %s work from starting without an active turn (bound: %s)', async (state, bound) => {
      if (bound) bind()
      const bindingsBeforeStop = [...persistedChannelSessions.bindings]
      const processIncoming = vi.spyOn(handler as any, 'processIncoming')
      const discarded = ['user-1', 'user-2'].map((userId) =>
        handler.handleIncoming(adapter, { ...incoming, userId, text: 'Old work' })
      )
      let settled = 0
      for (const completion of discarded) void completion.then(() => settled++)
      // Flush timers without running queue microtasks, leaving released batches waiting to start.
      if (state === 'flushed') vi.advanceTimersByTime(1000)
      const stopped = handler.handleCommand(adapter, stop)
      try {
        await vi.advanceTimersByTimeAsync(0)
        expect(settled).toBe(2)
        expect(adapter.sendMessage.mock.calls.map((call: unknown[]) => call[1])).toEqual(['Turn cancelled.'])
        expect([...persistedChannelSessions.bindings]).toEqual(bindingsBeforeStop)
        expect(agentSessionService.createTx).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1000)
        expect(processIncoming.mock.calls).toEqual([])
        expect(mockStartAgentSessionRun.mock.calls).toEqual([])
        expect(mockStreamAbort.mock.calls).toEqual([])
        const pause = handler.pause('stop-test')
        try {
          await expect(handler.drainInFlight({ timeoutMs: 50 })).resolves.toEqual({ stragglerIds: [] })
        } finally {
          pause.dispose()
        }
        holdRuns = false
        const next = await start({ ...incoming, text: 'New work' })
        await next.completion
        expect(mockStartAgentSessionRun.mock.calls.map(([input]) => input.userParts)).toEqual([
          [{ type: 'text', text: 'New work' }]
        ])
        expect(adapter.sendMessage.mock.calls.map((call: unknown[]) => call[1])).toEqual(['Turn cancelled.'])
      } finally {
        await finish()
        await Promise.all([...discarded, stopped])
        processIncoming.mockRestore()
      }
    })

    it.each(['resolveSession', 'prepareWorkspace', 'rejectWorkspace', 'persistImages', 'persistFiles'] as const)(
      'prevents a batch paused in %s from starting after /stop',
      async (stage) => {
        bind()
        let release!: () => void
        const ready = new Promise<void>((resolve) => {
          release = resolve
        })
        let reached = false
        const workspaceStage = stage === 'prepareWorkspace' || stage === 'rejectWorkspace'
        const preparation = workspaceStage ? mockPrepareAgentSessionWorkspaceDirectory : vi.spyOn(handler as any, stage)
        preparation.mockImplementationOnce(async () => {
          reached = true
          await ready
          if (stage === 'rejectWorkspace') throw new AgentSessionWorkspaceError('workspace is missing')
          return stage === 'resolveSession' ? persistedChannelSessions.sessions.get('session-stop') : []
        })
        const completion = handler.handleIncoming(adapter, {
          ...incoming,
          ...(stage === 'persistImages' || workspaceStage
            ? { images: [{ media_type: 'image/png', data: 'AA==' }] }
            : {}),
          ...(stage === 'persistFiles'
            ? { files: [{ filename: 'test.txt', data: 'AA==', media_type: 'text/plain', size: 1 }] }
            : {})
        })
        let settled = false
        void completion.then(() => {
          settled = true
        })
        try {
          await vi.advanceTimersByTimeAsync(1000)
          expect(reached).toBe(true)
          expect(mockStartAgentSessionRun.mock.calls).toEqual([])
          await handler.handleCommand(adapter, stop)
          await vi.advanceTimersByTimeAsync(0)
          expect(settled).toBe(true)
          expect(adapter.sendMessage.mock.calls.map((call: unknown[]) => call[1])).toEqual(['Turn cancelled.'])
          const pause = handler.pause('stop-test')
          try {
            await expect(handler.drainInFlight({ timeoutMs: 50 })).resolves.toEqual({ stragglerIds: [] })
          } finally {
            pause.dispose()
          }
          release()
          await vi.advanceTimersByTimeAsync(0)
          expect(mockStartAgentSessionRun.mock.calls).toEqual([])
          expect(mockStreamAbort.mock.calls).toEqual([])
          expect(persistedChannelSessions.bindings.get('channel-1:thread-stop')).toBe('session-stop')
          holdRuns = false
          const next = await start({ ...incoming, text: 'New work' })
          await next.completion
          expect(mockStartAgentSessionRun.mock.calls.map(([input]) => input.userParts)).toEqual([
            [{ type: 'text', text: 'New work' }]
          ])
          expect(adapter.sendMessage.mock.calls.map((call: unknown[]) => call[1])).toEqual(['Turn cancelled.'])
        } finally {
          release()
          await finish()
          await completion
          preparation.mockRestore()
        }
      }
    )

    it('prevents a turn awaiting runtime admission from starting after /stop', async () => {
      bind()
      let release!: () => void
      const ready = new Promise<void>((resolve) => {
        release = resolve
      })
      let preparing = false
      const admitted: string[] = []
      mockStartAgentSessionRun.mockImplementationOnce(async ({ beforePersist, userParts, listeners }) => {
        preparing = true
        await ready
        beforePersist?.()
        admitted.push(userParts[0].text)
        listeners[0].onDone()
        return { mode: 'started' }
      })
      const completion = handler.handleIncoming(adapter, incoming)
      let settled = false
      void completion.then(() => {
        settled = true
      })
      try {
        await vi.advanceTimersByTimeAsync(1000)
        expect(preparing).toBe(true)
        await handler.handleCommand(adapter, stop)
        await vi.advanceTimersByTimeAsync(0)
        expect(settled).toBe(true)
        expect(adapter.sendMessage.mock.calls.map((call: unknown[]) => call[1])).toEqual(['Turn cancelled.'])
        expect(adapter.onStreamError.mock.calls).toEqual([])
        const pause = handler.pause('stop-test')
        try {
          await expect(handler.drainInFlight({ timeoutMs: 50 })).resolves.toEqual({ stragglerIds: [] })
        } finally {
          pause.dispose()
        }
        release()
        await vi.advanceTimersByTimeAsync(0)
        expect(admitted).toEqual([])
        expect(adapter.onStreamError.mock.calls).toEqual([])
        holdRuns = false
        const next = await start({ ...incoming, text: 'New work' })
        await next.completion
        expect(runs.has('session-stop')).toBe(true)
        expect(mockStartAgentSessionRun.mock.calls.at(-1)?.[0].userParts).toEqual([{ type: 'text', text: 'New work' }])
      } finally {
        release()
        await finish()
        await completion
      }
    })

    it('discards flushed work blocked by a command receipt without waiting for that command', async () => {
      let release!: () => void
      const receipt = new Promise<void>((resolve) => {
        release = resolve
      })
      adapter.sendMessage.mockReturnValueOnce(receipt)
      const command = handler.handleCommand(adapter, { ...stop, command: 'new' })
      await vi.advanceTimersByTimeAsync(0)
      const binding = persistedChannelSessions.bindings.get('channel-1:thread-stop')
      const discarded = handler.handleIncoming(adapter, incoming)
      let settled = false
      void discarded.then(() => {
        settled = true
      })
      try {
        await vi.advanceTimersByTimeAsync(1000)
        await handler.handleCommand(adapter, stop)
        await vi.advanceTimersByTimeAsync(0)
        expect(settled).toBe(true)
        expect(adapter.sendMessage.mock.calls.map((call: unknown[]) => call[1])).toEqual([
          'New session created.',
          'Turn cancelled.'
        ])
        const pause = handler.pause('stop-test')
        try {
          await expect(handler.drainInFlight({ timeoutMs: 50 })).resolves.toEqual({ stragglerIds: [] })
        } finally {
          pause.dispose()
        }
        release()
        await command
        await vi.advanceTimersByTimeAsync(1000)
        expect(mockStartAgentSessionRun.mock.calls).toEqual([])
        expect(persistedChannelSessions.bindings.get('channel-1:thread-stop')).toBe(binding)
        holdRuns = false
        const next = await start({ ...incoming, text: 'New work' })
        await next.completion
        expect(mockStartAgentSessionRun.mock.calls.map(([input]) => input.userParts)).toEqual([
          [{ type: 'text', text: 'New work' }]
        ])
      } finally {
        release()
        await finish()
        await Promise.all([command, discarded])
      }
    })

    it('keeps pending work in other conversations, channels and agents when discarding the target batch', async () => {
      holdRuns = false
      const discarded = handler.handleIncoming(adapter, incoming)
      const others = [
        handler.handleIncoming(adapter, { ...incoming, conversationId: 'thread-other', text: 'Other conversation' }),
        handler.handleIncoming(createMockAdapter({ channelId: 'channel-2' }), { ...incoming, text: 'Other channel' }),
        handler.handleIncoming(createMockAdapter({ agentId: 'agent-2' }), { ...incoming, text: 'Other agent' })
      ]
      await handler.handleCommand(adapter, stop)
      await vi.advanceTimersByTimeAsync(1000)
      await Promise.all([discarded, ...others])
      expect(mockStartAgentSessionRun.mock.calls.map(([input]) => input.userParts)).toEqual([
        [{ type: 'text', text: 'Other conversation' }],
        [{ type: 'text', text: 'Other channel' }],
        [{ type: 'text', text: 'Other agent' }]
      ])
      expect(adapter.sendMessage.mock.calls.map((call: unknown[]) => call[1])).toEqual(['Turn cancelled.'])
    })

    it.each(['buffered', 'flushed'] as const)(
      'discards %s messages from all senders without errors or stuck admissions, then accepts new messages',
      async (state) => {
        bind()
        const active = await start()
        const discarded = ['user-1', 'user-2'].map((userId) =>
          handler.handleIncoming(adapter, { ...incoming, userId, text: 'Old work' })
        )
        if (state === 'flushed') await vi.advanceTimersByTimeAsync(1000)
        holdRuns = false
        const stopped = handler.handleCommand(adapter, stop)
        try {
          await vi.advanceTimersByTimeAsync(0)
          expect(adapter.sendMessage.mock.calls.map((call: unknown[]) => call[1])).toEqual(['Turn cancelled.'])
          holdRuns = false
          await vi.advanceTimersByTimeAsync(1000)
          await Promise.all([active.completion, stopped, ...discarded])
          const pause = handler.pause('stop-test')
          try {
            await expect(handler.drainInFlight({ timeoutMs: 50 })).resolves.toEqual({ stragglerIds: [] })
          } finally {
            pause.dispose()
          }
          holdRuns = false
          const next = handler.handleIncoming(adapter, { ...incoming, text: 'New work' })
          await vi.advanceTimersByTimeAsync(1000)
          await next
          expect(mockStartAgentSessionRun.mock.calls.map(([input]) => input.userParts)).toEqual([
            [{ type: 'text', text: 'Run' }],
            [{ type: 'text', text: 'New work' }]
          ])
          expect(adapter.sendMessage.mock.calls.map((call: unknown[]) => call[1])).toEqual(['Turn cancelled.'])
          expect(agentSessionService.createTx).not.toHaveBeenCalled()
        } finally {
          await finish()
          await Promise.all([active.completion, stopped, ...discarded])
        }
      }
    )

    it('settles discarded callers and admissions before the aborted stream finishes', async () => {
      bind()
      const active = await start()
      const buffered = handler.handleIncoming(adapter, { ...incoming, text: 'Discard me' })
      mockStreamAbort.mockImplementation(() => {})
      let discardedSettled = false
      void buffered.then(() => {
        discardedSettled = true
      })
      const stopped = handler.handleCommand(adapter, stop)
      try {
        await vi.advanceTimersByTimeAsync(0)
        expect(discardedSettled).toBe(true)
        expect(adapter.sendMessage.mock.calls.map((call: unknown[]) => call[1])).toEqual(['Turn cancelled.'])
        const pause = handler.pause('stop-test')
        try {
          await expect(handler.drainInFlight({ timeoutMs: 50 })).resolves.toEqual({ stragglerIds: [] })
        } finally {
          pause.dispose()
        }
      } finally {
        await finish()
        await Promise.all([active.completion, buffered, stopped])
      }
    })

    it('cancels a running /compact without claiming that it completed or that no turn is active', async () => {
      bind()
      const compact = handler.handleCommand(adapter, { ...stop, command: 'compact' })
      await vi.advanceTimersByTimeAsync(0)
      const stopped = handler.handleCommand(adapter, stop)
      try {
        await vi.advanceTimersByTimeAsync(0)
        expect(mockStreamAbort.mock.calls).toEqual([
          [buildAgentSessionTopicId('session-stop'), 'channel-session-aborted']
        ])
        expect(adapter.sendMessage.mock.calls.map((call: unknown[]) => call[1])).toEqual(['Turn cancelled.'])
        await Promise.all([compact, stopped])
        expect(handler.abortSession('session-stop')).toBe(false)
        expect(agentSessionService.createTx).not.toHaveBeenCalled()
      } finally {
        await finish()
        await Promise.all([compact, stopped])
      }
    })
  })

  // channels-core-2: a local AbortController only flips a listener's isAlive() — clearing
  // a tracked session must stop the upstream agent-session turn via the manager.
  it('clearSessionTracker aborts the upstream agent-session turn via the manager', async () => {
    const adapter = createMockAdapter()
    vi.mocked(agentSessionService.create).mockReturnValueOnce({ id: 'sess-x' } as any)

    await channelMessageHandler.handleCommand(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      command: 'new'
    })
    const createdSessionId = vi.mocked(agentSessionService.createTx).mock.calls[0][1]
    mockStreamAbort.mockClear()

    channelMessageHandler.clearSessionTracker('agent-1')

    expect(mockStreamAbort).toHaveBeenCalledWith(buildAgentSessionTopicId(createdSessionId), 'agent-cleared')
  })
})
