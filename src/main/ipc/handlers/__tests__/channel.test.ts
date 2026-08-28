import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock, getPathMock, readFileMock } = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  getPathMock: vi.fn(),
  readFileMock: vi.fn()
}))

vi.mock('@application', () => ({ application: { get: appGetMock, getPath: getPathMock } }))
vi.mock('fs', () => ({ default: { promises: { readFile: readFileMock } } }))

import { channelHandlers } from '../channel'

const channelManager = { getChannelLogs: vi.fn(), getAllStatuses: vi.fn() }
const ctx = { senderId: 'w1' }

beforeEach(() => {
  vi.clearAllMocks()
  getPathMock.mockReturnValue('/tokens/weixin_bot_c1.json')
  appGetMock.mockImplementation((name: string) => {
    if (name === 'ChannelManager') return channelManager
    throw new Error(`Unexpected application.get(${name})`)
  })
})

describe('channelHandlers', () => {
  it('wechat.has_credentials returns exists + userId when the token file parses', async () => {
    readFileMock.mockResolvedValue(JSON.stringify({ userId: 'u1' }))
    expect(await channelHandlers['channel.wechat.has_credentials']('c1', ctx)).toEqual({ exists: true, userId: 'u1' })
    expect(getPathMock).toHaveBeenCalledWith('feature.agents.channels', 'weixin_bot_c1.json')
  })

  it('wechat.has_credentials returns { exists: false } on any read/parse failure', async () => {
    readFileMock.mockRejectedValue(new Error('nope'))
    expect(await channelHandlers['channel.wechat.has_credentials']('c1', ctx)).toEqual({ exists: false })
  })

  it('get_logs and get_statuses delegate to ChannelManager', async () => {
    channelManager.getChannelLogs.mockReturnValue([{ timestamp: 1, level: 'info', message: 'm', channelId: 'c1' }])
    channelManager.getAllStatuses.mockReturnValue([{ channelId: 'c1', connected: true }])
    expect(await channelHandlers['channel.get_logs']('c1', ctx)).toEqual([
      { timestamp: 1, level: 'info', message: 'm', channelId: 'c1' }
    ])
    expect(channelManager.getChannelLogs).toHaveBeenCalledWith('c1')
    expect(await channelHandlers['channel.get_statuses'](undefined, ctx)).toEqual([
      { channelId: 'c1', connected: true }
    ])
  })
})
