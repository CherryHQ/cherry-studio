import { ErrorCode } from '@shared/data/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listChannelsMock,
  createChannelMock,
  getChannelMock,
  updateChannelMock,
  deleteChannelMock,
  getTaskMock,
  getTaskLogsMock
} = vi.hoisted(() => ({
  listChannelsMock: vi.fn(),
  createChannelMock: vi.fn(),
  getChannelMock: vi.fn(),
  updateChannelMock: vi.fn(),
  deleteChannelMock: vi.fn(),
  getTaskMock: vi.fn(),
  getTaskLogsMock: vi.fn()
}))

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: {
    listChannels: listChannelsMock,
    getChannel: getChannelMock
  }
}))

vi.mock('@data/services/AgentChannelWorkflowService', () => ({
  agentChannelWorkflowService: {
    createChannel: createChannelMock,
    updateChannel: updateChannelMock,
    deleteChannel: deleteChannelMock
  }
}))

vi.mock('@data/services/AgentTaskService', () => ({
  agentTaskService: {
    getTask: getTaskMock,
    getTaskLogs: getTaskLogsMock
  }
}))

vi.mock('@data/services/AgentService', () => ({ agentService: {} }))
vi.mock('@data/services/AgentSessionService', () => ({ agentSessionService: {} }))
vi.mock('@data/services/AgentSessionMessageService', () => ({ agentSessionMessageService: {} }))
vi.mock('@data/services/AgentTaskWorkflowService', () => ({ agentTaskWorkflowService: {} }))
vi.mock('@main/services/agents/skills/SkillService', () => ({ skillService: {} }))

import { agentHandlers } from '../agents'
import { channelHandlers } from '../channels'

const AGENT_ID = 'agent_1234567890_abcdefghi'
const CHANNEL_ID = 'channel_1234567890_abcdef'
const TASK_ID = 'task_1234567890_abcdefghi'

const mockChannel = {
  id: CHANNEL_ID,
  type: 'telegram',
  name: 'Test Channel',
  agentId: AGENT_ID,
  sessionId: null,
  config: { bot_token: 'abc123', allowed_chat_ids: [] },
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

describe('channelHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/channels', () => {
    it('GET returns all channels when no filter is provided', async () => {
      listChannelsMock.mockResolvedValueOnce([mockChannel])

      const result = await channelHandlers['/channels'].GET({ query: undefined } as never)

      expect(listChannelsMock).toHaveBeenCalledWith(undefined)
      expect(result).toEqual([mockChannel])
    })

    it('GET passes agentId filter to listChannels', async () => {
      listChannelsMock.mockResolvedValueOnce([mockChannel])

      const result = await channelHandlers['/channels'].GET({ query: { agentId: AGENT_ID } } as never)

      expect(listChannelsMock).toHaveBeenCalledWith({ agentId: AGENT_ID })
      expect(result).toEqual([mockChannel])
    })

    it('GET passes type filter to listChannels', async () => {
      listChannelsMock.mockResolvedValueOnce([mockChannel])

      const result = await channelHandlers['/channels'].GET({ query: { type: 'telegram' } } as never)

      expect(listChannelsMock).toHaveBeenCalledWith({ type: 'telegram' })
      expect(result).toEqual([mockChannel])
    })

    it('GET rejects invalid query', async () => {
      await expect(channelHandlers['/channels'].GET({ query: { type: 'invalid' } } as never)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })

      expect(listChannelsMock).not.toHaveBeenCalled()
    })

    it('POST creates a channel through the workflow service', async () => {
      createChannelMock.mockResolvedValueOnce(mockChannel)

      const result = await channelHandlers['/channels'].POST({
        body: {
          type: 'telegram',
          name: 'Test Channel',
          agentId: AGENT_ID,
          config: { bot_token: 'abc123', allowed_chat_ids: [] },
          isActive: true
        }
      } as never)

      expect(createChannelMock).toHaveBeenCalledOnce()
      expect(result).toMatchObject({ id: CHANNEL_ID })
    })

    it('POST rejects with VALIDATION_ERROR when required fields are missing', async () => {
      await expect(
        channelHandlers['/channels'].POST({ body: { name: 'Test Channel' } } as never)
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })

      expect(createChannelMock).not.toHaveBeenCalled()
    })
  })

  describe('/channels/:channelId', () => {
    it('GET returns channel when found', async () => {
      getChannelMock.mockResolvedValueOnce(mockChannel)

      const result = await channelHandlers['/channels/:channelId'].GET({ params: { channelId: CHANNEL_ID } } as never)

      expect(getChannelMock).toHaveBeenCalledWith(CHANNEL_ID)
      expect(result).toMatchObject({ id: CHANNEL_ID })
    })

    it('GET throws NOT_FOUND when channel does not exist', async () => {
      getChannelMock.mockResolvedValueOnce(null)

      await expect(
        channelHandlers['/channels/:channelId'].GET({ params: { channelId: CHANNEL_ID } } as never)
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('PATCH delegates to the workflow service and returns the updated channel', async () => {
      updateChannelMock.mockResolvedValueOnce({ ...mockChannel, name: 'Updated' })

      const result = await channelHandlers['/channels/:channelId'].PATCH({
        params: { channelId: CHANNEL_ID },
        body: { name: 'Updated' }
      } as never)

      expect(updateChannelMock).toHaveBeenCalledWith(CHANNEL_ID, { name: 'Updated' })
      expect(result).toMatchObject({ name: 'Updated' })
    })

    it('PATCH throws NOT_FOUND when the workflow service returns null', async () => {
      updateChannelMock.mockResolvedValueOnce(null)

      await expect(
        channelHandlers['/channels/:channelId'].PATCH({
          params: { channelId: CHANNEL_ID },
          body: { name: 'Updated' }
        } as never)
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    })

    it('PATCH rejects body that fails UpdateChannelSchema validation', async () => {
      await expect(
        channelHandlers['/channels/:channelId'].PATCH({
          params: { channelId: CHANNEL_ID },
          body: { type: 123 }
        } as never)
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })

      expect(updateChannelMock).not.toHaveBeenCalled()
    })

    it('DELETE removes channel through the workflow service', async () => {
      deleteChannelMock.mockResolvedValueOnce(true)

      await expect(
        channelHandlers['/channels/:channelId'].DELETE({ params: { channelId: CHANNEL_ID } } as never)
      ).resolves.toBeUndefined()

      expect(deleteChannelMock).toHaveBeenCalledWith(CHANNEL_ID)
    })

    it('DELETE throws NOT_FOUND when channel does not exist', async () => {
      deleteChannelMock.mockResolvedValueOnce(false)

      await expect(
        channelHandlers['/channels/:channelId'].DELETE({ params: { channelId: CHANNEL_ID } } as never)
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })
})

describe('agentHandlers — task logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/agents/:agentId/tasks/:taskId/logs', () => {
    it('GET returns paginated logs for a task', async () => {
      getTaskMock.mockResolvedValueOnce({ id: TASK_ID, agentId: AGENT_ID })
      getTaskLogsMock.mockResolvedValueOnce({ logs: [mockLog], total: 1 })

      const result = await agentHandlers['/agents/:agentId/tasks/:taskId/logs'].GET({
        params: { agentId: AGENT_ID, taskId: TASK_ID },
        query: { page: 1, limit: 20 }
      } as never)

      expect(getTaskMock).toHaveBeenCalledWith(AGENT_ID, TASK_ID)
      expect(getTaskLogsMock).toHaveBeenCalledWith(TASK_ID, { limit: 20, offset: 0 })
      expect(result).toMatchObject({ items: [mockLog], total: 1, page: 1 })
    })

    it('GET uses default pagination when no query is provided', async () => {
      getTaskMock.mockResolvedValueOnce({ id: TASK_ID, agentId: AGENT_ID })
      getTaskLogsMock.mockResolvedValueOnce({ logs: [], total: 0 })

      const result = await agentHandlers['/agents/:agentId/tasks/:taskId/logs'].GET({
        params: { agentId: AGENT_ID, taskId: TASK_ID }
      } as never)

      expect(getTaskLogsMock).toHaveBeenCalledWith(TASK_ID, { limit: 50, offset: 0 })
      expect(result).toMatchObject({ items: [], total: 0, page: 1 })
    })

    it('GET throws NOT_FOUND when the task does not belong to the agent', async () => {
      getTaskMock.mockResolvedValueOnce(null)

      await expect(
        agentHandlers['/agents/:agentId/tasks/:taskId/logs'].GET({
          params: { agentId: AGENT_ID, taskId: TASK_ID },
          query: { page: 1, limit: 20 }
        } as never)
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })

      expect(getTaskLogsMock).not.toHaveBeenCalled()
    })

    it('GET rejects invalid pagination query', async () => {
      getTaskMock.mockResolvedValueOnce({ id: TASK_ID, agentId: AGENT_ID })

      await expect(
        agentHandlers['/agents/:agentId/tasks/:taskId/logs'].GET({
          params: { agentId: AGENT_ID, taskId: TASK_ID },
          query: { page: 0 }
        } as never)
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })

      expect(getTaskLogsMock).not.toHaveBeenCalled()
    })
  })
})
