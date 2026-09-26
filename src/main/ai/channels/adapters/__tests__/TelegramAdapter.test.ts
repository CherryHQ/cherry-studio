import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('@main/i18n', () => ({
  t: (key: string) => key
}))

const mockBot = {
  use: vi.fn(),
  command: vi.fn(),
  on: vi.fn(),
  api: {
    setMyCommands: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendChatAction: vi.fn().mockResolvedValue(undefined),
    sendDocument: vi.fn().mockResolvedValue(undefined)
  },
  catch: vi.fn(),
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined)
}

vi.mock('grammy', () => {
  class MockInputFile {
    constructor(
      readonly data: Buffer,
      readonly filename: string
    ) {}
  }
  class MockHttpError extends Error {
    constructor(
      message: string,
      readonly error: unknown
    ) {
      super(message)
      this.name = 'HttpError'
    }
  }
  class MockGrammyError extends Error {
    readonly ok = false as const
    readonly parameters = {}
    readonly error_code: number
    readonly description: string
    constructor(
      message: string,
      err: { ok: false; error_code: number; description: string },
      readonly method: string,
      readonly payload: Record<string, unknown>
    ) {
      super(`${message} (${err.error_code}: ${err.description})`)
      this.name = 'GrammyError'
      this.error_code = err.error_code
      this.description = err.description
    }
  }
  return {
    Bot: vi.fn().mockImplementation(function BotMock() {
      return mockBot
    }),
    InputFile: MockInputFile,
    HttpError: MockHttpError,
    GrammyError: MockGrammyError
  }
})

import { GrammyError, HttpError, InputFile } from 'grammy'
import { convert as toMarkdownV2 } from 'telegram-markdown-v2'

import { createTelegramAdapter } from '../telegram/TelegramAdapter'

function networkResetError(): HttpError {
  const cause = Object.assign(
    new Error('Client network socket disconnected before secure TLS connection was established'),
    {
      code: 'ECONNRESET',
      errno: 'ECONNRESET',
      type: 'system'
    }
  )
  return new HttpError("Network request for 'sendMessage' failed!", cause)
}

describe('TelegramAdapter', () => {
  beforeEach(() => {
    // Reset all mock functions but preserve the factory registration
    mockBot.use.mockClear()
    mockBot.command.mockClear()
    mockBot.on.mockClear()
    mockBot.api.setMyCommands.mockClear().mockResolvedValue(undefined)
    mockBot.api.sendMessage.mockReset().mockResolvedValue(undefined)
    mockBot.api.sendChatAction.mockClear().mockResolvedValue(undefined)
    mockBot.api.sendDocument.mockClear().mockResolvedValue(undefined)
    mockBot.catch.mockClear()
    mockBot.start.mockClear().mockResolvedValue(undefined)
    mockBot.stop.mockClear().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createAdapter(overrides: Record<string, unknown> = {}): any {
    return createTelegramAdapter({
      channelId: (overrides.channelId as string) ?? 'ch-1',
      channelType: 'telegram',
      agentId: (overrides.agentId as string) ?? 'agent-1',
      channelConfig: {
        bot_token: (overrides.bot_token as string) ?? 'test-token',
        allowed_chat_ids: (overrides.allowed_chat_ids as string[]) ?? ['123']
      }
    })
  }

  it('connect() registers middleware, commands, message handler, and starts polling', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    expect(mockBot.use).toHaveBeenCalledTimes(1) // auth middleware
    expect(mockBot.command).toHaveBeenCalledTimes(4) // new, compact, help, whoami
    expect(mockBot.on).toHaveBeenCalledWith('message:text', expect.any(Function))
    expect(mockBot.api.setMyCommands).toHaveBeenCalledWith([
      { command: 'new', description: 'Start a new conversation' },
      { command: 'compact', description: 'Compact conversation history' },
      { command: 'help', description: 'Show help information' },
      { command: 'whoami', description: 'Show the current chat ID' }
    ])
    expect(mockBot.catch).toHaveBeenCalledTimes(1)
    expect(mockBot.start).toHaveBeenCalledTimes(1)
  })

  it('disconnect() stops the bot', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    await adapter.disconnect()

    expect(mockBot.stop).toHaveBeenCalledTimes(1)
  })

  // channel-adapters-2: grammY rethrows a fatal 409/Conflict out of bot.start(); the adapter
  // must reconnect with backoff instead of staying permanently down.
  it('reconnects with backoff when polling rejects (REGRESSION channel-adapters-2)', async () => {
    vi.useFakeTimers()
    const adapter = createAdapter()
    mockBot.start.mockReset()
    // First polling attempt fails (recoverable 409); the reconnect attempt succeeds.
    mockBot.start.mockRejectedValueOnce(new Error('409: Conflict')).mockResolvedValue(undefined)

    await adapter.connect()
    await vi.advanceTimersByTimeAsync(0) // let the rejection handler schedule the reconnect
    expect(mockBot.start).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000) // first backoff delay
    expect(mockBot.start).toHaveBeenCalledTimes(2) // reconnected
  })

  it('resets the reconnect budget after a stable polling window (REGRESSION channel-adapters-2)', async () => {
    vi.useFakeTimers()
    const adapter = createAdapter()
    mockBot.start.mockReset()
    // One transient failure bumps the attempt counter, then the reconnect stays up.
    mockBot.start.mockRejectedValueOnce(new Error('409: Conflict')).mockResolvedValue(undefined)

    await adapter.connect()
    await vi.advanceTimersByTimeAsync(1000) // reconnect fires and succeeds
    expect(adapter.reconnectAttempts).toBe(1)

    // After the stability window the counter resets, so lifetime-cumulative transient
    // failures can't monotonically exhaust maxReconnectAttempts.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(adapter.reconnectAttempts).toBe(0)
  })

  it('does not reconnect after disconnect() (REGRESSION channel-adapters-2)', async () => {
    vi.useFakeTimers()
    const adapter = createAdapter()
    mockBot.start.mockReset()
    mockBot.start.mockRejectedValue(new Error('409: Conflict'))

    await adapter.connect()
    await vi.advanceTimersByTimeAsync(0) // a reconnect is now pending
    await adapter.disconnect() // shouldStop + clear the pending reconnect timer

    const callsAfterDisconnect = mockBot.start.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mockBot.start.mock.calls.length).toBe(callsAfterDisconnect) // no further reconnect
  })

  it('sendMessage() sends text with MarkdownV2 by default', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    await adapter.sendMessage('123', 'Hello')

    expect(mockBot.api.sendMessage).toHaveBeenCalledWith('123', 'Hello', { parse_mode: 'MarkdownV2' })
  })

  it('sendMessage() converts markdown to MarkdownV2 via library', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    await adapter.sendMessage('123', 'Price is 10.5!')

    const call = mockBot.api.sendMessage.mock.calls[0]
    expect(call[0]).toBe('123')
    expect(call[2]).toEqual({ parse_mode: 'MarkdownV2' })
    // The library converts the text — special chars should be escaped
    expect(call[1]).not.toBe('Price is 10.5!')
  })

  // #20643: special characters stay under the plain budget, but MarkdownV2 escaping
  // exceeds 4096. Deliver that chunk as plain text instead of dropping it.
  it('sendMessage() falls back to plain text when escaped MarkdownV2 exceeds 4096 (REGRESSION #20643)', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    const plain = '.'.repeat(2500)
    expect(plain.length).toBeLessThanOrEqual(4096)
    expect(toMarkdownV2(plain).trimEnd().length).toBeGreaterThan(4096)

    mockBot.api.sendMessage.mockImplementation(async (...args: [string, string]) => {
      const text = args[1]
      if (text.length > 4096) {
        throw new GrammyError(
          "Call to 'sendMessage' failed!",
          { ok: false, error_code: 400, description: 'Bad Request: message is too long' },
          'sendMessage',
          {}
        )
      }
    })

    await adapter.sendMessage('123', plain)

    const payloadCalls = mockBot.api.sendMessage.mock.calls.filter(
      (call) => call[1] !== 'common.channel_message_dropped'
    )
    expect(payloadCalls).toContainEqual(['123', plain, {}])
    expect(payloadCalls.every((call) => call[1].length <= 4096)).toBe(true)
    expect(mockBot.api.sendMessage.mock.calls.some((call) => call[1] === 'common.channel_message_dropped')).toBe(false)
  })

  // Length rejections are not parse errors. A MarkdownV2 400 "message is too long"
  // must still downgrade to the plain chunk instead of the drop notice.
  it('sendMessage() falls back to plain text when Telegram reports message is too long (REGRESSION #20643)', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    mockBot.api.sendMessage.mockRejectedValueOnce(
      new GrammyError(
        "Call to 'sendMessage' failed!",
        { ok: false, error_code: 400, description: 'Bad Request: message is too long' },
        'sendMessage',
        {}
      )
    )

    await adapter.sendMessage('123', 'Hello')

    expect(mockBot.api.sendMessage).toHaveBeenCalledTimes(2)
    expect(mockBot.api.sendMessage.mock.calls[1]).toEqual(['123', 'Hello', {}])
    expect(mockBot.api.sendMessage.mock.calls.some((call) => call[1] === 'common.channel_message_dropped')).toBe(false)
  })

  it('sendMessage() falls back to plain text on MarkdownV2 error', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    mockBot.api.sendMessage.mockRejectedValueOnce(
      new GrammyError(
        "Call to 'sendMessage' failed!",
        { ok: false, error_code: 400, description: "Bad Request: can't parse entities" },
        'sendMessage',
        {}
      )
    )

    await adapter.sendMessage('123', 'Hello')

    expect(mockBot.api.sendMessage).toHaveBeenCalledTimes(2)
    // Second call should be plain text fallback
    expect(mockBot.api.sendMessage.mock.calls[1][1]).toBe('Hello')
    expect(mockBot.api.sendMessage.mock.calls[1][2]).toEqual({})
  })

  // #20643: network-layer failures must not be misclassified as MarkdownV2 parse
  // failures. A format downgrade on ECONNRESET wastes the only retry and still fails.
  it('sendMessage() does not format-downgrade on network errors (REGRESSION #20643)', async () => {
    vi.useFakeTimers()
    const adapter = createAdapter()
    await adapter.connect()

    mockBot.api.sendMessage.mockRejectedValue(networkResetError())

    const sendPromise = adapter.sendMessage('123', 'Price is 10.5!')
    const expectation = expect(sendPromise).rejects.toMatchObject({ name: 'HttpError' })
    await vi.runAllTimersAsync()
    await expectation

    const payloadCalls = mockBot.api.sendMessage.mock.calls.filter(
      (call) => call[1] !== 'common.channel_message_dropped'
    )
    expect(payloadCalls.length).toBeGreaterThan(1)
    for (const call of payloadCalls) {
      expect(call[2]).toEqual({ parse_mode: 'MarkdownV2' })
      // Escaped MarkdownV2 payload — never the raw plain chunk used by format fallback.
      expect(call[1]).not.toBe('Price is 10.5!')
    }
  })

  // #20643: transient network failures should backoff-retry the same payload before giving up.
  it('sendMessage() retries transient network errors with backoff then succeeds (REGRESSION #20643)', async () => {
    vi.useFakeTimers()
    const adapter = createAdapter()
    await adapter.connect()

    mockBot.api.sendMessage
      .mockRejectedValueOnce(networkResetError())
      .mockRejectedValueOnce(networkResetError())
      .mockResolvedValueOnce(undefined)

    const sendPromise = adapter.sendMessage('123', 'Hello')
    await Promise.resolve()
    expect(mockBot.api.sendMessage).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mockBot.api.sendMessage).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(15_000)
    await sendPromise

    expect(mockBot.api.sendMessage).toHaveBeenCalledTimes(3)
    for (const call of mockBot.api.sendMessage.mock.calls) {
      expect(call[2]).toEqual({ parse_mode: 'MarkdownV2' })
    }
  })

  // #20643: after retries are exhausted the failure must surface to the caller and a
  // user-visible drop notice must be attempted (not silent swallow inside the adapter).
  it('sendMessage() notifies and rethrows after network retries are exhausted (REGRESSION #20643)', async () => {
    vi.useFakeTimers()
    const adapter = createAdapter()
    await adapter.connect()

    mockBot.api.sendMessage.mockRejectedValue(networkResetError())

    const sendPromise = adapter.sendMessage('123', 'Hello')
    const expectation = expect(sendPromise).rejects.toMatchObject({ name: 'HttpError' })
    await vi.runAllTimersAsync()
    await expectation

    const dropNotice = mockBot.api.sendMessage.mock.calls.find((call) => call[1] === 'common.channel_message_dropped')
    expect(dropNotice).toBeDefined()
    expect(dropNotice?.[0]).toBe('123')
    // Initial attempt + 3 backoff retries for the payload, then one drop-notice attempt.
    expect(mockBot.api.sendMessage.mock.calls.length).toBe(5)
  })

  it('sendMessage() chunks long messages', async () => {
    vi.useFakeTimers()
    const adapter = createAdapter()
    await adapter.connect()

    const longText = 'A'.repeat(5000)
    const sendPromise = adapter.sendMessage('123', longText)

    // Flush all pending timers (inter-chunk delays) regardless of count
    await vi.runAllTimersAsync()
    await sendPromise

    expect(mockBot.api.sendMessage).toHaveBeenCalledTimes(2)
    // After MarkdownV2 conversion the total length may differ slightly
    const totalSent = mockBot.api.sendMessage.mock.calls[0][1].length + mockBot.api.sendMessage.mock.calls[1][1].length
    expect(totalSent).toBe(5000)
  })

  it('sendFile() sends a document built from the decoded buffer and filename', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    const data = Buffer.from('file-bytes').toString('base64')
    await adapter.sendFile('123', { filename: 'report.pdf', data, media_type: 'application/pdf', size: 10 })

    expect(mockBot.api.sendDocument).toHaveBeenCalledTimes(1)
    const [chatId, inputFile] = mockBot.api.sendDocument.mock.calls[0]
    expect(chatId).toBe('123')
    expect(inputFile).toBeInstanceOf(InputFile)
    expect(inputFile.filename).toBe('report.pdf')
    expect(inputFile.data.toString()).toBe('file-bytes')
  })

  it('sendTypingIndicator() sends typing action', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    await adapter.sendTypingIndicator('123')

    expect(mockBot.api.sendChatAction).toHaveBeenCalledWith('123', 'typing')
  })

  it('auth middleware blocks unauthorized chats', async () => {
    const adapter = createAdapter({ allowed_chat_ids: ['123'] })
    await adapter.connect()

    // Extract the auth middleware
    const middleware = mockBot.use.mock.calls[0][0] as (ctx: any, next: () => Promise<void>) => Promise<void>

    const next = vi.fn()

    // Unauthorized chat
    await middleware({ chat: { id: 999 } }, next)
    expect(next).not.toHaveBeenCalled()

    // Authorized chat
    next.mockClear()
    await middleware({ chat: { id: 123 } }, next)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('command handler emits command events', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    const commandSpy = vi.fn()
    adapter.on('command', commandSpy)

    // Find the 'new' command handler (first bot.command call)
    const commandHandler = mockBot.command.mock.calls[0][1] as (ctx: any) => void

    commandHandler({
      chat: { id: 123 },
      from: { id: 456, first_name: 'TestUser' }
    })

    expect(commandSpy).toHaveBeenCalledWith({
      chatId: '123',
      userId: '456',
      userName: 'TestUser',
      command: 'new'
    })
  })

  it('whoami command handler emits command events', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    const commandSpy = vi.fn()
    adapter.on('command', commandSpy)

    const commandHandler = mockBot.command.mock.calls[3][1] as (ctx: any) => void

    commandHandler({
      chat: { id: 123 },
      from: { id: 456, first_name: 'TestUser' }
    })

    expect(commandSpy).toHaveBeenCalledWith({
      chatId: '123',
      userId: '456',
      userName: 'TestUser',
      command: 'whoami'
    })
  })

  it('message handler emits message events', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    // Extract the message:text handler
    const messageHandler = mockBot.on.mock.calls[0][1] as (ctx: any) => void

    messageHandler({
      chat: { id: 123 },
      from: { id: 456, first_name: 'TestUser' },
      message: { text: 'Hello bot' }
    })

    expect(messageSpy).toHaveBeenCalledWith({
      chatId: '123',
      userId: '456',
      userName: 'TestUser',
      text: 'Hello bot'
    })
  })
})
