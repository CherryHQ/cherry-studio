import { EventEmitter } from 'node:events'

import { setupTestDatabase } from '@test-helpers/db'
import { type BrowserWindow, net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentChannelService } from '@data/services/AgentChannelService'

import { ChannelRegistration } from '../ChannelRegistration'

const response = (data: unknown) => new Response(JSON.stringify(data))
const requestId = '0377cb14-1413-4b68-aa78-a354aa5b0abc'
const qr = { data: { scode: 'private-code', auth_url: 'https://work.weixin.qq.com/ai/qc/c?s=qr' } }
const success = { data: { status: 'success', bot_info: { botid: 'new-bot', secret: ' secret ' } } }

describe('channel QR registration', () => {
  setupTestDatabase()
  let registration: ChannelRegistration
  let window: EventEmitter
  let channelId: string
  beforeEach(() => {
    vi.useFakeTimers()
    registration = new ChannelRegistration()
    window = Object.assign(new EventEmitter(), { isDestroyed: () => false })
    vi.mocked(application.get('WindowManager').getWindow).mockReturnValue(window as BrowserWindow)
    vi.mocked(net.fetch).mockReset().mockResolvedValue(response(qr))
    channelId = agentChannelService.createChannel({
      type: 'wecom',
      name: 'WeCom',
      workspace: { type: 'system' },
      isActive: false,
      config: { bot_id: 'old-bot', secret: 'old-secret', allowed_chat_ids: ['dm:alice'], allowed_user_ids: ['alice'] }
    }).id
  })
  afterEach(() => {
    registration.dispose()
    vi.useRealTimers()
  })
  const begin = () => registration.begin('owner', channelId, requestId)
  const poll = async () => {
    const result = registration.poll('owner', requestId)
    await vi.advanceTimersByTimeAsync(3000)
    return result
  }

  it('saves authorized credentials to the draft without enabling it or returning secrets to the renderer', async () => {
    const result = await begin()
    expect(result).toEqual({ requestId, url: qr.data.auth_url, expiresAt: Date.now() + 300_000 })
    vi.mocked(net.fetch).mockResolvedValue(response(success))
    expect(await poll()).toEqual({ status: 'confirmed' })
    expect(agentChannelService.getChannel(channelId)).toMatchObject({
      isActive: false,
      config: { bot_id: 'new-bot', secret: ' secret ', allowed_chat_ids: ['dm:alice'], allowed_user_ids: ['alice'] }
    })
  })

  it('does not expose or cancel another window’s pending authorization', async () => {
    await begin()
    registration.cancel('other', requestId)
    expect(await registration.poll('other', requestId)).toEqual({ status: 'cancelled' })
    vi.mocked(net.fetch).mockResolvedValue(response(success))
    expect(await poll()).toEqual({ status: 'confirmed' })
  })

  it('keeps waiting for an unscanned code and fails closed on missing success credentials', async () => {
    await begin()
    vi.mocked(net.fetch).mockResolvedValue(response({ data: { status: 'init' } }))
    expect(await poll()).toEqual({ status: 'pending' })
    vi.mocked(net.fetch).mockResolvedValue(response({ data: { status: 'success' } }))
    expect(await poll()).toEqual({ status: 'error' })
    expect(agentChannelService.getChannel(channelId)?.config).toMatchObject({ bot_id: 'old-bot', secret: 'old-secret' })
  })

  it.each(['cancel', 'close', 'stop', 'expired'] as const)(
    'never saves late authorization after %s',
    async (action) => {
      await begin()
      let finish!: (value: Response) => void
      vi.mocked(net.fetch).mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
      const result = registration.poll('owner', requestId)
      await vi.advanceTimersByTimeAsync(3000)
      if (action === 'cancel') registration.cancel('owner', requestId)
      if (action === 'close') window.emit('closed')
      if (action === 'stop') registration.dispose()
      if (action === 'expired') await vi.advanceTimersByTimeAsync(300_000)
      finish(response(success))
      expect(await result).toEqual({ status: action === 'expired' ? 'expired' : 'cancelled' })
      expect(agentChannelService.getChannel(channelId)?.config).toMatchObject({ secret: 'old-secret' })
    }
  )

  it.each(['manual', 'active', 'deleted'] as const)(
    'does not overwrite a channel changed by %s configuration',
    async (change) => {
      await begin()
      if (change === 'manual')
        agentChannelService.updateChannel(channelId, { config: { bot_id: 'manual', secret: 'manual' } })
      if (change === 'active') agentChannelService.updateChannel(channelId, { isActive: true })
      if (change === 'deleted') agentChannelService.deleteChannel(channelId)
      vi.mocked(net.fetch).mockResolvedValue(response(success))
      expect(await poll()).toEqual({ status: 'cancelled' })
      expect(agentChannelService.getChannel(channelId)?.config).not.toMatchObject({ secret: ' secret ' })
    }
  )

  it('rejects foreign QR hosts, oversized responses and raw transport errors without exposing response data', async () => {
    for (const data of [{ data: { ...qr.data, auth_url: 'https://evil.example/?secret=leak' } }, 'x'.repeat(65537)]) {
      vi.mocked(net.fetch).mockResolvedValue(response(data))
      await expect(begin()).rejects.toThrow('Channel registration failed')
    }
    vi.mocked(net.fetch).mockRejectedValue(new Error('https://example.com/?secret=leak'))
    await expect(begin()).rejects.toThrow(/^Channel registration failed$/)
  })
})
