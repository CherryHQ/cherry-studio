import { ErrorCode } from '@shared/data/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listChannelsMock,
  createChannelMock,
  getChannelMock,
  updateChannelMock,
  deleteChannelMock,
  syncChannelMock,
  disconnectChannelMock,
  getTaskLogsMock
} = vi.hoisted(() => ({
  listChannelsMock: vi.fn(),
  createChannelMock: vi.fn(),
  getChannelMock: vi.fn(),
  updateChannelMock: vi.fn(),
  deleteChannelMock: vi.fn(),
  syncChannelMock: vi.fn(),
  disconnectChannelMock: vi.fn(),
  getTaskLogsMock: vi.fn()
}))

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: {
    listChannels: listChannelsMock,
    createChannel: createChannelMock,
    getChannel: getChannelMock,
    updateChannel: updateChannelMock,
    deleteChannel: deleteChannelMock
  }
}))

vi.mock('@main/services/agents/services/channels', () => ({
  channelManager: {
    syncChannel: syncChannelMock,
    disconnectChannel: disconnectChannelMock
  }
}))

vi.mock('@data/services/AgentTaskService', () => ({
  agentTaskService: {
    getTaskLogs: getTaskLogsMock
  }
}))

// Mock all other services used in agentHandlers (required for the module to load)
vi.mock('@data/services/AgentService', () => ({ agentService: {} }))
vi.mock('@data/services/AgentSessionService', () => ({ agentSessionService: {} }))
vi.mock('@data/services/AgentSessionMessageService', () => ({ agentSessionMessageService: {} }))
vi.mock('@main/services/agents/skills/SkillService', () => ({ skillService: {} }))

import { agentHandlers } from '../agents'

const AGENT_ID = 'agent_1234567890_abcdefghi'
const CHANNEL_ID = 'channel_1234567890_abcdef'
const TASK_ID = 'task_1234567890_abcdefghi'

const mockChannel = {
  id: CHANNEL_ID,
  type: 'telegram',
  name: 'Test Channel',
  agentId: AGENT_ID,
  sessionId: null,
  config: { token: 'abc123' },
  isActive: true,
  activeChatIds: null,
  permissionMode: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
}

const mockLog = {
  id: 1,
  taskId: TASK_ID,
  sessionId: null,
  runAt: '2024-01-01T00:00:00.000Z',
  durationMs: 100,
  status: 'success',
  result: 'ok',
  error: null
}

describe('agentHandlers — channels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── /channels ──────────────────────────────────────────────────────────────

  describe('/channels', () => {
    it('GET returns all channels when no filter is provided', async () => {
      listChannelsMock.mockResolvedValueOnce([mockChannel])

      const result = await agentHandlers['/channels'].GET({ query: undefined } as never)

      expect(listChannelsMock).toHaveBeenCalledWith(undefined)
      expect(result).toEqual([mockChannel])
    })

    it('GET passes agentId filter to listChannels', async () => {
      listChannelsMock.mockResolvedValueOnce([mockChannel])

      const result = await agentHandlers['/channels'].GET({ query: { agentId: AGENT_ID } } as never)

      expect(listChannelsMock).toHaveBeenCalledWith({ agentId: AGENT_ID })
      expect(result).toEqual([mockChannel])
    })

    it('GET passes type filter to listChannels', async () => {
      listChannelsMock.mockResolvedValueOnce([mockChannel])

      const result = await agentHandlers['/channels'].GET({ query: { type: 'telegram' } } as never)

      expect(listChannelsMock).toHaveBeenCalledWith({ type: 'telegram' })
      expect(result).toEqual([mockChannel])
    })

    it('POST creates a channel and calls syncChannel', async () => {
      createChannelMock.mockResolvedValueOnce(mockChannel)
      syncChannelMock.mockResolvedValueOnce(undefined)

      const result = await agentHandlers['/channels'].POST({
        body: {
          type: 'telegram',
          name: 'Test Channel',
          agentId: AGENT_ID,
          config: { token: 'abc123' },
          isActive: true
        }
      } as never)

      expect(createChannelMock).toHaveBeenCalledOnce()
      expect(syncChannelMock).toHaveBeenCalledWith(CHANNEL_ID)
      expect(result).toMatchObject({ id: CHANNEL_ID })
    })

    it('POST rejects with VALIDATION_ERROR when required fields are missing', async () => {
      await expect(agentHandlers['/channels'].POST({ body: { name: 'Test Channel' } } as never)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })

      expect(createChannelMock).not.toHaveBeenCalled()
      expect(syncChannelMock).not.toHaveBeenCalled()
    })
  })

  // ── /channels/:channelId ──────────────────────────────────────────────────

  describe('/channels/:channelId', () => {
    it('GET returns channel when found', async () => {
      getChannelMock.mockResolvedValueOnce(mockChannel)

      const result = await agentHandlers['/channels/:channelId'].GET({
        params: { channelId: CHANNEL_ID }
      } as never)

      expect(getChannelMock).toHaveBeenCalledWith(CHANNEL_ID)
      expect(result).toMatchObject({ id: CHANNEL_ID })
    })

    it('GET throws NOT_FOUND when channel does not exist', async () => {
      getChannelMock.mockResolvedValueOnce(null)

      await expect(
        agentHandlers['/channels/:channelId'].GET({ params: { channelId: CHANNEL_ID } } as never)
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    })

    it('PATCH updates channel and calls syncChannel', async () => {
      updateChannelMock.mockResolvedValueOnce({ ...mockChannel, name: 'Updated' })
      syncChannelMock.mockResolvedValueOnce(undefined)

      const result = await agentHandlers['/channels/:channelId'].PATCH({
        params: { channelId: CHANNEL_ID },
        body: { name: 'Updated' }
      } as never)

      expect(updateChannelMock).toHaveBeenCalledWith(CHANNEL_ID, { name: 'Updated' })
      expect(syncChannelMock).toHaveBeenCalledWith(CHANNEL_ID)
      expect(result).toMatchObject({ name: 'Updated' })
    })

    it('PATCH throws NOT_FOUND when channel does not exist', async () => {
      updateChannelMock.mockResolvedValueOnce(null)

      await expect(
        agentHandlers['/channels/:channelId'].PATCH({
          params: { channelId: CHANNEL_ID },
          body: { name: 'Updated' }
        } as never)
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })

      expect(syncChannelMock).not.toHaveBeenCalled()
    })

    it('DELETE removes channel and calls disconnectChannel', async () => {
      deleteChannelMock.mockResolvedValueOnce(true)
      disconnectChannelMock.mockResolvedValueOnce(undefined)

      await expect(
        agentHandlers['/channels/:channelId'].DELETE({ params: { channelId: CHANNEL_ID } } as never)
      ).resolves.toBeUndefined()

      expect(deleteChannelMock).toHaveBeenCalledWith(CHANNEL_ID)
      expect(disconnectChannelMock).toHaveBeenCalledWith(CHANNEL_ID)
    })

    it('DELETE throws NOT_FOUND when channel does not exist', async () => {
      deleteChannelMock.mockResolvedValueOnce(false)

      await expect(
        agentHandlers['/channels/:channelId'].DELETE({ params: { channelId: CHANNEL_ID } } as never)
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })

      expect(disconnectChannelMock).not.toHaveBeenCalled()
    })
  })

  // ── /agents/:agentId/tasks/:taskId/logs ───────────────────────────────────

  describe('/agents/:agentId/tasks/:taskId/logs', () => {
    it('GET returns paginated logs for a task', async () => {
      getTaskLogsMock.mockResolvedValueOnce({ logs: [mockLog], total: 1 })

      const result = await agentHandlers['/agents/:agentId/tasks/:taskId/logs'].GET({
        params: { agentId: AGENT_ID, taskId: TASK_ID },
        query: { page: 1, limit: 20 }
      } as never)

      expect(getTaskLogsMock).toHaveBeenCalledWith(TASK_ID, { limit: 20, offset: 0 })
      expect(result).toMatchObject({ items: [mockLog], total: 1, page: 1 })
    })

    it('GET uses default pagination when no query is provided', async () => {
      getTaskLogsMock.mockResolvedValueOnce({ logs: [], total: 0 })

      const result = await agentHandlers['/agents/:agentId/tasks/:taskId/logs'].GET({
        params: { agentId: AGENT_ID, taskId: TASK_ID }
      } as never)

      expect(getTaskLogsMock).toHaveBeenCalledWith(TASK_ID, { limit: 50, offset: 0 })
      expect(result).toMatchObject({ items: [], total: 0, page: 1 })
    })
  })
})
