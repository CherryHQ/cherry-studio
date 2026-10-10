import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

const { readFileMock } = vi.hoisted(() => ({ readFileMock: vi.fn() }))

vi.mock('fs', () => ({ default: { promises: { readFile: readFileMock } } }))
vi.mock('@main/ai/channels', () => ({
  createAgentChannel: vi.fn(),
  deleteAgentChannel: vi.fn(),
  updateAgentChannel: vi.fn()
}))

import { channelHandlers } from '../channel'

const context = { senderId: 'w1' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(application.getPath).mockReturnValue('/tokens/weixin_bot_c1.json')
})

describe('channel.wechat.has_credentials', () => {
  it('returns the saved user ID when it is a string', async () => {
    readFileMock.mockResolvedValue(JSON.stringify({ userId: 'u1' }))

    await expect(channelHandlers['channel.wechat.has_credentials']('c1', context)).resolves.toEqual({
      exists: true,
      userId: 'u1'
    })
  })

  it.each([{ id: 'u1' }, ['u1'], 123, true, null])('rejects a malformed user ID: %j', async (userId) => {
    readFileMock.mockResolvedValue(JSON.stringify({ userId }))

    await expect(channelHandlers['channel.wechat.has_credentials']('c1', context)).resolves.toEqual({ exists: false })
  })

  it('allows a credentials file without the optional user ID', async () => {
    readFileMock.mockResolvedValue('{}')

    await expect(channelHandlers['channel.wechat.has_credentials']('c1', context)).resolves.toEqual({
      exists: true,
      userId: undefined
    })
  })
})
