import { beforeEach, describe, expect, it, vi } from 'vitest'

const { syncChannelMock, disconnectChannelMock } = vi.hoisted(() => ({
  syncChannelMock: vi.fn(),
  disconnectChannelMock: vi.fn()
}))

vi.mock('@main/services/agents/services/channels', () => ({
  channelManager: {
    syncChannel: syncChannelMock,
    disconnectChannel: disconnectChannelMock
  }
}))

const { createChannelMock, getChannelMock, updateChannelMock, deleteChannelMock } = vi.hoisted(() => ({
  createChannelMock: vi.fn(),
  getChannelMock: vi.fn(),
  updateChannelMock: vi.fn(),
  deleteChannelMock: vi.fn()
}))

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: {
    createChannel: createChannelMock,
    getChannel: getChannelMock,
    updateChannel: updateChannelMock,
    deleteChannel: deleteChannelMock
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn()
    })
  }
}))

// Import AFTER mocks
import { agentChannelWorkflowService } from '../AgentChannelWorkflowService'

const makeChannel = (overrides: Record<string, unknown> = {}) => ({
  id: 'ch-1',
  type: 'telegram',
  name: 'My Bot',
  agentId: 'agent-1',
  sessionId: 'sess-1',
  config: { bot_token: 'token-abc' },
  isActive: true,
  activeChatIds: ['chat-1'],
  permissionMode: 'whitelist',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides
})

describe('AgentChannelWorkflowService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createChannel', () => {
    it('returns the channel when syncChannel succeeds', async () => {
      const channel = makeChannel()
      createChannelMock.mockResolvedValue(channel)
      syncChannelMock.mockResolvedValue(undefined)

      const result = await agentChannelWorkflowService.createChannel({
        type: 'telegram',
        name: 'My Bot',
        config: { bot_token: 'token-abc' }
      })

      expect(result).toEqual(channel)
      expect(syncChannelMock).toHaveBeenCalledWith('ch-1', { awaitConnect: true, strictDisconnect: true })
    })

    it('deletes DB row and calls disconnectChannel when syncChannel throws', async () => {
      const channel = makeChannel()
      createChannelMock.mockResolvedValue(channel)
      syncChannelMock.mockRejectedValue(new Error('sync failed'))
      deleteChannelMock.mockResolvedValue(true)
      disconnectChannelMock.mockResolvedValue(undefined)

      await expect(
        agentChannelWorkflowService.createChannel({
          type: 'telegram',
          name: 'My Bot',
          config: { bot_token: 'token-abc' }
        })
      ).rejects.toThrow('sync failed')

      expect(deleteChannelMock).toHaveBeenCalledWith('ch-1')
      expect(disconnectChannelMock).toHaveBeenCalledWith('ch-1')
    })

    it('still throws even if cleanup deleteChannel fails', async () => {
      const channel = makeChannel()
      createChannelMock.mockResolvedValue(channel)
      syncChannelMock.mockRejectedValue(new Error('sync failed'))
      deleteChannelMock.mockRejectedValue(new Error('cleanup failed'))
      disconnectChannelMock.mockResolvedValue(undefined)

      await expect(
        agentChannelWorkflowService.createChannel({
          type: 'telegram',
          name: 'My Bot',
          config: { bot_token: 'token-abc' }
        })
      ).rejects.toThrow('sync failed')
    })
  })

  describe('updateChannel', () => {
    it('returns null when channel does not exist', async () => {
      getChannelMock.mockResolvedValue(null)

      const result = await agentChannelWorkflowService.updateChannel('nonexistent', { name: 'New Name' })

      expect(result).toBeNull()
      expect(updateChannelMock).not.toHaveBeenCalled()
    })

    it('returns null when row vanishes mid-update', async () => {
      const existing = makeChannel()
      getChannelMock.mockResolvedValue(existing)
      updateChannelMock.mockResolvedValue(null)

      const result = await agentChannelWorkflowService.updateChannel('ch-1', { name: 'New Name' })

      expect(result).toBeNull()
      expect(syncChannelMock).not.toHaveBeenCalled()
    })

    it('returns updated channel when syncChannel succeeds', async () => {
      const existing = makeChannel()
      const updated = makeChannel({ name: 'New Name' })
      getChannelMock.mockResolvedValue(existing)
      updateChannelMock.mockResolvedValue(updated)
      syncChannelMock.mockResolvedValue(undefined)

      const result = await agentChannelWorkflowService.updateChannel('ch-1', { name: 'New Name' })

      expect(result).toEqual(updated)
    })

    it('restores all fields (name/agentId/sessionId/config/isActive/activeChatIds/permissionMode) when syncChannel throws', async () => {
      const existing = makeChannel()
      const updated = makeChannel({ name: 'New Name' })
      getChannelMock.mockResolvedValue(existing)
      // First call (real update) succeeds, second call (restore) also resolves
      updateChannelMock.mockResolvedValueOnce(updated).mockResolvedValueOnce(existing)
      syncChannelMock.mockRejectedValue(new Error('sync failed'))

      await expect(agentChannelWorkflowService.updateChannel('ch-1', { name: 'New Name' })).rejects.toThrow(
        'sync failed'
      )

      // Second updateChannel call is the rollback restore
      expect(updateChannelMock).toHaveBeenCalledTimes(2)
      const restoreArgs = updateChannelMock.mock.calls[1][1]
      expect(restoreArgs).toMatchObject({
        name: existing.name,
        agentId: existing.agentId,
        sessionId: existing.sessionId,
        config: existing.config,
        isActive: existing.isActive,
        activeChatIds: existing.activeChatIds,
        permissionMode: existing.permissionMode
      })
      // Ensure all 7 fields are present (no extras silently dropped)
      expect(Object.keys(restoreArgs)).toEqual(
        expect.arrayContaining([
          'name',
          'agentId',
          'sessionId',
          'config',
          'isActive',
          'activeChatIds',
          'permissionMode'
        ])
      )
    })

    it('rejects discord-shaped config when existing channel is telegram (cross-type guard)', async () => {
      const existing = makeChannel({ type: 'telegram', config: { bot_token: 'tok' } })
      getChannelMock.mockResolvedValue(existing)

      // Discord config has `bot_token` AND `allowed_channel_ids` (number-keyed channel IDs are not the issue;
      // the strict-shape check rejects the missing telegram-specific fields when re-parsed as telegram).
      // We use a clearly-invalid shape: an extra unknown key plus wrong value type for bot_token.
      await expect(
        agentChannelWorkflowService.updateChannel('ch-1', {
          config: { bot_token: 12345 } as never // wrong type — telegram schema requires string
        })
      ).rejects.toMatchObject({ code: expect.any(String) })

      // updateChannel must NOT be called when validation fails
      expect(updateChannelMock).not.toHaveBeenCalled()
      expect(syncChannelMock).not.toHaveBeenCalled()
    })

    it('rejects activation when active-only constraints are not satisfied', async () => {
      // Telegram active schema enforces `bot_token: z.string().min(1)`; an empty string on activation should fail.
      const existing = makeChannel({ type: 'telegram', isActive: false, config: { bot_token: '' } })
      getChannelMock.mockResolvedValue(existing)

      await expect(
        agentChannelWorkflowService.updateChannel('ch-1', {
          isActive: true
          // config not changed; uses existing.config which has empty bot_token
        })
      ).rejects.toMatchObject({ code: expect.any(String) })

      expect(updateChannelMock).not.toHaveBeenCalled()
      expect(syncChannelMock).not.toHaveBeenCalled()
    })

    it('calls resync (without awaitConnect) after rollback', async () => {
      const existing = makeChannel()
      const updated = makeChannel({ name: 'Changed' })
      getChannelMock.mockResolvedValue(existing)
      updateChannelMock.mockResolvedValueOnce(updated).mockResolvedValueOnce(existing)
      syncChannelMock.mockRejectedValue(new Error('sync failed'))

      await expect(agentChannelWorkflowService.updateChannel('ch-1', { name: 'Changed' })).rejects.toThrow(
        'sync failed'
      )

      // First sync call uses strict options; second (resync after rollback) uses no options
      expect(syncChannelMock).toHaveBeenCalledTimes(2)
      expect(syncChannelMock.mock.calls[0]).toEqual(['ch-1', { awaitConnect: true, strictDisconnect: true }])
      expect(syncChannelMock.mock.calls[1]).toEqual(['ch-1'])
    })
  })

  describe('deleteChannel', () => {
    it('returns false when channel does not exist', async () => {
      getChannelMock.mockResolvedValue(null)

      const result = await agentChannelWorkflowService.deleteChannel('nonexistent')

      expect(result).toBe(false)
      expect(disconnectChannelMock).not.toHaveBeenCalled()
    })

    it('returns true when disconnect and delete both succeed', async () => {
      const existing = makeChannel()
      getChannelMock.mockResolvedValue(existing)
      disconnectChannelMock.mockResolvedValue(undefined)
      deleteChannelMock.mockResolvedValue(true)

      const result = await agentChannelWorkflowService.deleteChannel('ch-1')

      expect(result).toBe(true)
      expect(disconnectChannelMock).toHaveBeenCalledWith('ch-1', { suppressErrors: false })
    })

    it('runs resync compensation when disconnect succeeded but DB delete failed', async () => {
      const existing = makeChannel()
      getChannelMock.mockResolvedValue(existing)
      disconnectChannelMock.mockResolvedValue(undefined)
      deleteChannelMock.mockRejectedValue(new Error('db delete failed'))
      syncChannelMock.mockResolvedValue(undefined)

      await expect(agentChannelWorkflowService.deleteChannel('ch-1')).rejects.toThrow('db delete failed')

      expect(syncChannelMock).toHaveBeenCalledWith('ch-1')
    })

    it('still throws even if the resync compensation also fails', async () => {
      const existing = makeChannel()
      getChannelMock.mockResolvedValue(existing)
      disconnectChannelMock.mockResolvedValue(undefined)
      deleteChannelMock.mockRejectedValue(new Error('db delete failed'))
      syncChannelMock.mockRejectedValue(new Error('resync failed'))

      await expect(agentChannelWorkflowService.deleteChannel('ch-1')).rejects.toThrow('db delete failed')
    })
  })
})
