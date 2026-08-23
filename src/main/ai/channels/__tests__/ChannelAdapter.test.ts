import { describe, expect, it, vi } from 'vitest'

import { ChannelAdapter, type ChannelAdapterConfig } from '../ChannelAdapter'

class ControlledAdapter extends ChannelAdapter {
  private readonly connectResolvers: Array<() => void> = []

  readonly sendMessage = vi.fn().mockResolvedValue(undefined)
  readonly sendTypingIndicator = vi.fn().mockResolvedValue(undefined)
  readonly performDisconnect = vi.fn().mockResolvedValue(undefined)

  constructor() {
    super({
      channelId: 'channel-1',
      channelType: 'telegram',
      agentId: 'agent-1',
      channelConfig: { bot_token: 'token', allowed_chat_ids: [] }
    } satisfies ChannelAdapterConfig<'telegram'>)
  }

  protected async performConnect(signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve) => this.connectResolvers.push(resolve))
    this.markConnected(signal)
  }

  resolveConnect(index: number): void {
    this.connectResolvers[index]?.()
  }

  pendingConnectCount(): number {
    return this.connectResolvers.length
  }
}

describe('ChannelAdapter connect ownership', () => {
  it('aborts a superseded connect and prevents it from publishing connected', async () => {
    const adapter = new ControlledAdapter()
    const statuses: boolean[] = []
    adapter.on('statusChange', ({ connected }) => statuses.push(connected))

    const first = adapter.connect()
    await vi.waitFor(() => expect(adapter.pendingConnectCount()).toBe(1))
    const second = adapter.connect()
    await vi.waitFor(() => expect(adapter.pendingConnectCount()).toBe(2))

    adapter.resolveConnect(0)
    await expect(first).resolves.toBeUndefined()
    expect(adapter.connected).toBe(false)
    expect(statuses).toEqual([])

    adapter.resolveConnect(1)
    await second
    expect(adapter.connected).toBe(true)
    expect(statuses).toEqual([true])
  })

  it('waits for disconnect while preventing a late connect from reopening the adapter', async () => {
    const adapter = new ControlledAdapter()
    const statuses: boolean[] = []
    adapter.on('statusChange', ({ connected }) => statuses.push(connected))

    const connecting = adapter.connect()
    await vi.waitFor(() => expect(adapter.pendingConnectCount()).toBe(1))
    await adapter.disconnect()
    adapter.resolveConnect(0)

    await expect(connecting).resolves.toBeUndefined()
    expect(adapter.connected).toBe(false)
    expect(statuses).toEqual([])
  })
})
