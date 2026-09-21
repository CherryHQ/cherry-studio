import { describe, expect, it, vi } from 'vitest'

import { ChannelAdapter, type ChannelAdapterConfig } from '../ChannelAdapter'
import { ChannelRuntime, type ChannelRuntimeDesired, type ChannelRuntimeHooks } from '../ChannelRuntime'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

class ControlledAdapter extends ChannelAdapter {
  readonly started = deferred()
  aborted = false
  disconnectCount = 0

  constructor(
    config: ChannelAdapterConfig,
    readonly token: string,
    private readonly gate?: Promise<void>,
    private readonly connectError?: Error,
    private readonly qrUrl?: string,
    public disconnectError?: Error
  ) {
    super(config)
  }

  protected async performConnect(signal: AbortSignal): Promise<void> {
    this.started.resolve()
    if (this.qrUrl) this.emit('qr', this.qrUrl)
    if (this.connectError) throw this.connectError
    if (this.gate) {
      await Promise.race([
        this.gate,
        new Promise<never>((_, reject) => {
          const abort = () => {
            this.aborted = true
            reject(new Error('aborted'))
          }
          if (signal.aborted) abort()
          else signal.addEventListener('abort', abort, { once: true })
        })
      ])
    }
    this.markConnected()
  }

  protected async performDisconnect(): Promise<void> {
    this.disconnectCount++
    if (this.disconnectError) throw this.disconnectError
  }

  async sendMessage(): Promise<void> {}
  async sendTypingIndicator(): Promise<void> {}
}

const makeChannel = (token = 'old') => ({
  id: 'ch-1',
  type: 'telegram' as const,
  name: 'Test',
  agentId: 'agent-1',
  sessionId: null,
  workspace: { type: 'system' as const },
  config: { bot_token: token, allowed_chat_ids: [] },
  isActive: true,
  activeChatIds: [],
  permissionMode: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
})

function createHooks(
  readDesired: () => ChannelRuntimeDesired,
  loadAdapter: ChannelRuntimeHooks['loadAdapter']
): ChannelRuntimeHooks {
  return {
    readDesired,
    loadAdapter,
    onMessage: vi.fn(),
    onCommand: vi.fn(),
    onCredentials: vi.fn(),
    onDynamicChatId: vi.fn(),
    onLog: vi.fn(),
    onStatus: vi.fn(),
    onError: vi.fn()
  }
}

describe('ChannelRuntime', () => {
  it('captures the owner while reading intent so a post-commit purge can still find the runtime', async () => {
    const channel = makeChannel()
    const adapter = new ControlledAdapter(
      {
        channelId: channel.id,
        channelType: channel.type,
        agentId: 'agent-1',
        channelConfig: channel.config
      },
      channel.config.bot_token
    )
    const hooks = createHooks(
      () => ({ kind: 'connected', channel, agentId: 'agent-1' }),
      async () => adapter
    )
    const runtime = new ChannelRuntime('ch-1', hooks)

    runtime.requestReconcile()

    expect(runtime.ownerAgentId).toBe('agent-1')
    await runtime.flush()
    await runtime.dispose()
  })

  it('aborts a superseded connect and converges to only the latest channel row', async () => {
    const firstGate = deferred()
    let desired: ChannelRuntimeDesired = { kind: 'connected', channel: makeChannel('old'), agentId: 'agent-1' }
    const adapters: ControlledAdapter[] = []
    const hooks = createHooks(
      () => desired,
      async (channel, agentId) => {
        const adapter = new ControlledAdapter(
          {
            channelId: channel.id,
            channelType: channel.type,
            agentId,
            channelConfig: channel.config
          },
          channel.type === 'telegram' ? channel.config.bot_token : '',
          adapters.length === 0 ? firstGate.promise : undefined
        )
        adapters.push(adapter)
        return adapter
      }
    )
    const runtime = new ChannelRuntime('ch-1', hooks)

    runtime.requestReconcile()
    await vi.waitFor(() => expect(adapters).toHaveLength(1))
    await adapters[0].started.promise
    desired = { kind: 'connected', channel: makeChannel('new'), agentId: 'agent-1' }
    runtime.requestReconcile()
    adapters[0].emit('message', { chatId: 'stale', userId: 'u', userName: 'U', text: 'ignored' })
    await runtime.flush()

    expect(adapters[0].aborted).toBe(true)
    expect(adapters[0].disconnectCount).toBeGreaterThan(0)
    expect(adapters).toHaveLength(2)
    expect(adapters[1].token).toBe('new')
    expect(runtime.adapter).toBe(adapters[1])
    expect(hooks.onMessage).not.toHaveBeenCalled()
    await runtime.dispose()
  })

  it('stops after a failed target and retries only after a later request', async () => {
    const connectError = new Error('invalid token')
    let attempt = 0
    const hooks = createHooks(
      () => ({ kind: 'connected', channel: makeChannel(), agentId: 'agent-1' }),
      async (channel, agentId) => {
        attempt++
        return new ControlledAdapter(
          {
            channelId: channel.id,
            channelType: channel.type,
            agentId,
            channelConfig: channel.config
          },
          channel.type === 'telegram' ? channel.config.bot_token : '',
          undefined,
          attempt === 1 ? connectError : undefined
        )
      }
    )
    const runtime = new ChannelRuntime('ch-1', hooks)

    runtime.requestReconcile()
    await expect(runtime.flush()).rejects.toBe(connectError)
    expect(attempt).toBe(1)

    await runtime.reconcile()
    expect(attempt).toBe(2)
    expect(runtime.adapter?.connected).toBe(true)
    await runtime.dispose()
  })

  it('does not create a replacement transport until the old one disconnects', async () => {
    const disconnectError = new Error('transport teardown failed')
    let desired: ChannelRuntimeDesired = { kind: 'connected', channel: makeChannel('old'), agentId: 'agent-1' }
    const adapters: ControlledAdapter[] = []
    const hooks = createHooks(
      () => desired,
      async (channel, agentId) => {
        const adapter = new ControlledAdapter(
          {
            channelId: channel.id,
            channelType: channel.type,
            agentId,
            channelConfig: channel.config
          },
          channel.type === 'telegram' ? channel.config.bot_token : '',
          undefined,
          undefined,
          undefined,
          adapters.length === 0 ? disconnectError : undefined
        )
        adapters.push(adapter)
        return adapter
      }
    )
    const runtime = new ChannelRuntime('ch-1', hooks)
    await runtime.reconcile()

    desired = { kind: 'connected', channel: makeChannel('new'), agentId: 'agent-1' }
    await expect(runtime.reconcile()).rejects.toBe(disconnectError)
    expect(adapters).toHaveLength(1)
    expect(runtime.adapter).toBeUndefined()

    adapters[0].disconnectError = undefined
    await runtime.reconcile()
    expect(adapters).toHaveLength(2)
    expect(runtime.adapter).toBe(adapters[1])
    await runtime.dispose()
  })

  it('captures a QR emitted synchronously by connect because the waiter is installed first', async () => {
    const hooks = createHooks(
      () => ({ kind: 'connected', channel: makeChannel(), agentId: 'agent-1' }),
      async (channel, agentId) =>
        new ControlledAdapter(
          {
            channelId: channel.id,
            channelType: channel.type,
            agentId,
            channelConfig: channel.config
          },
          channel.type === 'telegram' ? channel.config.bot_token : '',
          undefined,
          undefined,
          'https://example.com/qr'
        )
    )
    const runtime = new ChannelRuntime('ch-1', hooks)
    const qrUrl = runtime.waitForQrUrl('agent-1', 1_000)

    runtime.requestReconcile()

    await expect(qrUrl).resolves.toBe('https://example.com/qr')
    await runtime.flush()
    await runtime.dispose()
  })
})
