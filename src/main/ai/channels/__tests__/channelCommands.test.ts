import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createChannel: vi.fn(),
  updateChannel: vi.fn(),
  deleteChannel: vi.fn(),
  requestReconcile: vi.fn(),
  reconcileChannel: vi.fn(),
  waitForQrAndReconcile: vi.fn(),
  removeChannel: vi.fn()
}))

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: {
    createChannel: mocks.createChannel,
    updateChannel: mocks.updateChannel,
    deleteChannel: mocks.deleteChannel
  }
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name !== 'ChannelManager') throw new Error(`Unexpected service: ${name}`)
      return {
        requestReconcile: mocks.requestReconcile,
        reconcileChannel: mocks.reconcileChannel,
        waitForQrAndReconcile: mocks.waitForQrAndReconcile,
        removeChannel: mocks.removeChannel
      }
    }
  }
}))

import {
  createAgentChannel,
  createAgentChannelAndWaitForQr,
  deleteAgentChannel,
  updateAgentChannel
} from '../channelCommands'

const input = {
  type: 'telegram' as const,
  name: 'Bot',
  agentId: 'agent-1',
  workspace: { type: 'system' as const },
  config: { bot_token: 'token' },
  isActive: true
}

const channel = {
  ...input,
  id: 'ch-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('channelCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createChannel.mockReturnValue(channel)
    mocks.updateChannel.mockReturnValue(channel)
    mocks.deleteChannel.mockReturnValue(true)
    mocks.removeChannel.mockResolvedValue(undefined)
  })

  it('commits create before requesting runtime convergence', () => {
    expect(createAgentChannel(input)).toBe(channel)
    expect(mocks.createChannel).toHaveBeenCalledWith(input)
    expect(mocks.requestReconcile).toHaveBeenCalledWith('ch-1')
    expect(mocks.createChannel.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.requestReconcile.mock.invocationCallOrder[0]
    )
  })

  it('keeps a successful update even though runtime convergence is asynchronous', () => {
    expect(updateAgentChannel('ch-1', { name: 'Renamed' })).toBe(channel)
    expect(mocks.updateChannel).toHaveBeenCalledWith('ch-1', { name: 'Renamed' })
    expect(mocks.requestReconcile).toHaveBeenCalledWith('ch-1')
  })

  it('deletes persisted state before removing the owned runtime', async () => {
    await expect(deleteAgentChannel('ch-1')).resolves.toBe(true)
    expect(mocks.deleteChannel.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.removeChannel.mock.invocationCallOrder[0]
    )
  })

  it('removes a newly-created QR channel when waiting for its QR fails', async () => {
    mocks.waitForQrAndReconcile.mockRejectedValue(new Error('Timed out waiting for QR code'))

    await expect(createAgentChannelAndWaitForQr(input, 10)).rejects.toThrow('Timed out waiting for QR code')

    expect(mocks.waitForQrAndReconcile).toHaveBeenCalledWith('agent-1', 'ch-1', 10)
    expect(mocks.deleteChannel).toHaveBeenCalledWith('ch-1')
    expect(mocks.removeChannel).toHaveBeenCalledWith('ch-1')
  })
})
