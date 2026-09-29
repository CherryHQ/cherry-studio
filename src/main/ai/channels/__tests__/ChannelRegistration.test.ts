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
  const dingBegin = {
    errcode: 0,
    device_code: 'private-device',
    verification_uri_complete: 'https://open-dev.dingtalk.com/openapp/registration/openClaw?code=qr',
    interval: 2,
    expires_in: 7200
  }
  const startDingTalk = async () => {
    channelId = agentChannelService.createChannel({
      type: 'dingtalk',
      name: 'DingTalk',
      workspace: { type: 'system' },
      isActive: false,
      config: {
        client_id: '',
        client_secret: '',
        robot_code: '',
        allowed_chat_ids: ['dm:alice'],
        card_template_id: 'template'
      }
    }).id
    vi.mocked(net.fetch)
      .mockResolvedValueOnce(response({ errcode: 0, nonce: 'nonce' }))
      .mockResolvedValueOnce(response(dingBegin))
    return begin()
  }

  it('registers DingTalk with Cherry identity and saves robot credentials without losing settings', async () => {
    const result = await startDingTalk()
    expect(result.url).toBe(dingBegin.verification_uri_complete)
    const [initUrl, initOptions] = vi.mocked(net.fetch).mock.calls[0]
    expect(initUrl).toBe('https://oapi.dingtalk.com/app/registration/init')
    expect(JSON.parse(initOptions!.body as string)).toEqual({ source: 'CHERRY_STUDIO' })
    vi.mocked(net.fetch).mockResolvedValue(response({ errcode: 0, status: 'WAITING' }))
    expect(await poll()).toEqual({ status: 'pending' })
    vi.mocked(net.fetch).mockResolvedValue(
      response({ errcode: 0, status: 'SUCCESS', client_id: 'ding-app', client_secret: ' secret ' })
    )
    expect(await poll()).toEqual({ status: 'confirmed' })
    expect(agentChannelService.getChannel(channelId)).toMatchObject({
      isActive: false,
      config: {
        client_id: 'ding-app',
        client_secret: ' secret ',
        robot_code: 'ding-app',
        allowed_chat_ids: ['dm:alice'],
        card_template_id: 'template'
      }
    })
  })

  it.each([
    [{ errcode: 0, status: 'FAIL' }, 'error'],
    [{ errcode: 0, status: 'EXPIRED' }, 'expired'],
    [{ errcode: 1, status: 'SUCCESS', client_id: 'x', client_secret: 'x' }, 'error'],
    [{ errcode: 0, status: 'SUCCESS', client_id: 'x' }, 'error']
  ] as const)('rejects unsuccessful DingTalk authorization %j', async (data, status) => {
    await startDingTalk()
    vi.mocked(net.fetch).mockResolvedValue(response(data))
    expect(await poll()).toEqual({ status })
    expect(agentChannelService.getChannel(channelId)?.config).toMatchObject({ client_secret: '' })
  })
})
