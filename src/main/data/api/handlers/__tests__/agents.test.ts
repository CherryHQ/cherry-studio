import { ErrorCode } from '@shared/data/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listAgentsMock,
  createAgentMock,
  getAgentMock,
  updateAgentMock,
  deleteAgentMock,
  listTasksMock,
  createTaskMock,
  getTaskMock,
  updateTaskMock,
  deleteTaskMock,
  listSkillsMock,
  getSkillByIdMock
} = vi.hoisted(() => ({
  listAgentsMock: vi.fn(),
  createAgentMock: vi.fn(),
  getAgentMock: vi.fn(),
  updateAgentMock: vi.fn(),
  deleteAgentMock: vi.fn(),
  listTasksMock: vi.fn(),
  createTaskMock: vi.fn(),
  getTaskMock: vi.fn(),
  updateTaskMock: vi.fn(),
  deleteTaskMock: vi.fn(),
  listSkillsMock: vi.fn(),
  getSkillByIdMock: vi.fn()
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: {
    listAgents: listAgentsMock,
    createAgent: createAgentMock,
    getAgent: getAgentMock,
    updateAgent: updateAgentMock,
    deleteAgent: deleteAgentMock
  }
}))

vi.mock('@data/services/AgentTaskService', () => ({
  agentTaskService: {
    listTasks: listTasksMock,
    createTask: createTaskMock,
    getTask: getTaskMock,
    updateTask: updateTaskMock,
    deleteTask: deleteTaskMock
  }
}))

vi.mock('@data/services/AgentGlobalSkillService', () => ({
  agentGlobalSkillService: {
    list: listSkillsMock,
    getById: getSkillByIdMock
  }
}))

vi.mock('@data/services/AgentChannelService', () => ({ agentChannelService: {} }))

import { agentHandlers } from '../agents'
import { skillHandlers } from '../skills'

const AGENT_ID = 'agent_1234567890_abcdefghi'
const TASK_ID = 'task_1234567890_abcdefghi'
const SKILL_ID = 'skill-abc-123'

const mockAgent = { id: AGENT_ID, name: 'Test', type: 'claude-code', model: 'claude-3-5-sonnet' }
const mockTask = { id: TASK_ID, agentId: AGENT_ID, name: 'Daily', prompt: 'Hello' }
const mockSkill = { id: SKILL_ID, name: 'my-skill', isEnabled: true }

describe('agentHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── /agents ──────────────────────────────────────────────────────────────

  describe('/agents', () => {
    it('delegates GET to agentService.listAgents', async () => {
      listAgentsMock.mockResolvedValueOnce({ agents: [mockAgent], total: 1 })

      const result = await agentHandlers['/agents'].GET({ query: {} } as never)

      expect(listAgentsMock).toHaveBeenCalledOnce()
      expect(result).toMatchObject({ items: [mockAgent], total: 1, page: 1 })
    })

    it('GET works without query params (defaults from ListAgentsQuerySchema)', async () => {
      listAgentsMock.mockResolvedValueOnce({ agents: [], total: 0 })

      const result = await agentHandlers['/agents'].GET({} as never)

      // page=1, limit=100 (AGENTS_DEFAULT_LIMIT) → offset=0; search undefined.
      expect(listAgentsMock).toHaveBeenCalledWith({
        limit: 100,
        offset: 0,
        search: undefined
      })
      expect(result).toMatchObject({ total: 0, page: 1 })
    })

    it('GET forwards search to the service', async () => {
      listAgentsMock.mockResolvedValueOnce({ agents: [], total: 0 })

      await agentHandlers['/agents'].GET({
        query: {
          search: 'research'
        }
      } as never)

      expect(listAgentsMock).toHaveBeenCalledWith({
        limit: 100,
        offset: 0,
        search: 'research'
      })
    })

    it('GET rejects tagIds before calling the service', async () => {
      await expect(
        agentHandlers['/agents'].GET({
          query: { tagIds: ['11111111-1111-4111-8111-111111111111'] }
        } as never)
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })

      expect(listAgentsMock).not.toHaveBeenCalled()
    })

    it('GET rejects invalid pagination', async () => {
      await expect(agentHandlers['/agents'].GET({ query: { page: 0 } } as never)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
      expect(listAgentsMock).not.toHaveBeenCalled()
    })

    it('rejects invalid pagination query', async () => {
      await expect(agentHandlers['/agents'].GET({ query: { page: -1 } } as never)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })

      expect(listAgentsMock).not.toHaveBeenCalled()
    })

    it('delegates POST to agentService.createAgent', async () => {
      createAgentMock.mockResolvedValueOnce(mockAgent)

      const result = await agentHandlers['/agents'].POST({
        body: { type: 'claude-code', name: 'Test', model: 'anthropic::claude-3-5-sonnet' }
      } as never)

      expect(createAgentMock).toHaveBeenCalledOnce()
      expect(result).toMatchObject({ id: AGENT_ID })
    })

    it('rejects POST when required fields are missing', async () => {
      await expect(agentHandlers['/agents'].POST({ body: { name: 'Test' } } as never)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })

      expect(createAgentMock).not.toHaveBeenCalled()
    })

    it('rejects POST when model is missing', async () => {
      await expect(
        agentHandlers['/agents'].POST({ body: { type: 'claude-code', name: 'Test' } } as never)
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })

      expect(createAgentMock).not.toHaveBeenCalled()
    })
  })

  // ── /agents/:agentId ──────────────────────────────────────────────────────

  describe('/agents/:agentId', () => {
    it('delegates GET and returns agent', async () => {
      getAgentMock.mockResolvedValueOnce(mockAgent)

      const result = await agentHandlers['/agents/:agentId'].GET({ params: { agentId: AGENT_ID } } as never)

      expect(getAgentMock).toHaveBeenCalledWith(AGENT_ID)
      expect(result).toMatchObject({ id: AGENT_ID })
    })

    it('throws notFound when agent does not exist on GET', async () => {
      getAgentMock.mockResolvedValueOnce(null)

      await expect(
        agentHandlers['/agents/:agentId'].GET({ params: { agentId: AGENT_ID } } as never)
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    })

    it('delegates PATCH and returns updated agent', async () => {
      updateAgentMock.mockResolvedValueOnce({ ...mockAgent, name: 'Updated' })

      const result = await agentHandlers['/agents/:agentId'].PATCH({
        params: { agentId: AGENT_ID },
        body: { name: 'Updated' }
      } as never)

      expect(updateAgentMock).toHaveBeenCalledWith(AGENT_ID, { name: 'Updated' })
      expect(result).toMatchObject({ name: 'Updated' })
    })

    it('throws notFound when agent does not exist on PATCH', async () => {
      updateAgentMock.mockResolvedValueOnce(null)

      await expect(
        agentHandlers['/agents/:agentId'].PATCH({ params: { agentId: AGENT_ID }, body: {} } as never)
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    })

    it('delegates DELETE', async () => {
      deleteAgentMock.mockResolvedValueOnce(true)

      await expect(
        agentHandlers['/agents/:agentId'].DELETE({ params: { agentId: AGENT_ID } } as never)
      ).resolves.toBeUndefined()

      expect(deleteAgentMock).toHaveBeenCalledWith(AGENT_ID)
    })

    it('throws notFound when agent does not exist on DELETE', async () => {
      deleteAgentMock.mockResolvedValueOnce(false)

      await expect(
        agentHandlers['/agents/:agentId'].DELETE({ params: { agentId: AGENT_ID } } as never)
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    })
  })

  // ── /agents/:agentId/tasks ────────────────────────────────────────────────

  describe('/agents/:agentId/tasks', () => {
    it('delegates GET to taskService.listTasks', async () => {
      listTasksMock.mockResolvedValueOnce({ tasks: [mockTask], total: 1 })

      const result = await agentHandlers['/agents/:agentId/tasks'].GET({
        params: { agentId: AGENT_ID },
        query: {}
      } as never)

      expect(listTasksMock).toHaveBeenCalledWith(AGENT_ID, { limit: 50, offset: 0 })
      expect(result).toMatchObject({ items: [mockTask], total: 1, page: 1 })
    })

    it('delegates POST to agentTaskService.createTask', async () => {
      createTaskMock.mockResolvedValueOnce(mockTask)

      const result = await agentHandlers['/agents/:agentId/tasks'].POST({
        params: { agentId: AGENT_ID },
        body: {
          name: 'Daily',
          prompt: 'Hello',
          trigger: { kind: 'cron', expr: '0 9 * * *' },
          workspace: { type: 'system' }
        }
      } as never)

      expect(createTaskMock).toHaveBeenCalledWith(
        AGENT_ID,
        expect.objectContaining({ name: 'Daily', prompt: 'Hello', workspace: { type: 'system' } })
      )
      expect(result).toMatchObject({ id: TASK_ID })
    })

    it('rejects POST when required task fields are missing', async () => {
      await expect(
        agentHandlers['/agents/:agentId/tasks'].POST({
          params: { agentId: AGENT_ID },
          body: { name: 'Daily' }
        } as never)
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })

      expect(createTaskMock).not.toHaveBeenCalled()
    })

    it('rejects invalid pagination query', async () => {
      await expect(
        agentHandlers['/agents/:agentId/tasks'].GET({
          params: { agentId: AGENT_ID },
          query: { limit: 999999 }
        } as never)
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })

      expect(listTasksMock).not.toHaveBeenCalled()
    })
  })

  // ── /agents/:agentId/tasks/:taskId ────────────────────────────────────────

  describe('/agents/:agentId/tasks/:taskId', () => {
    it('delegates GET and throws notFound when task is missing', async () => {
      getTaskMock.mockResolvedValueOnce(null)

      await expect(
        agentHandlers['/agents/:agentId/tasks/:taskId'].GET({
          params: { agentId: AGENT_ID, taskId: TASK_ID }
        } as never)
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    })

    it('delegates PATCH to agentTaskService.updateTask and returns updated task', async () => {
      updateTaskMock.mockResolvedValueOnce({ ...mockTask, name: 'Updated' })

      const result = await agentHandlers['/agents/:agentId/tasks/:taskId'].PATCH({
        params: { agentId: AGENT_ID, taskId: TASK_ID },
        body: { name: 'Updated' }
      } as never)

      expect(updateTaskMock).toHaveBeenCalledWith(AGENT_ID, TASK_ID, expect.objectContaining({ name: 'Updated' }))
      expect(result).toMatchObject({ name: 'Updated' })
    })

    it('throws notFound when task does not exist on PATCH', async () => {
      updateTaskMock.mockResolvedValueOnce(null)

      await expect(
        agentHandlers['/agents/:agentId/tasks/:taskId'].PATCH({
          params: { agentId: AGENT_ID, taskId: TASK_ID },
          body: {}
        } as never)
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    })

    it('delegates DELETE to agentTaskService.deleteTask', async () => {
      deleteTaskMock.mockResolvedValueOnce(true)

      await expect(
        agentHandlers['/agents/:agentId/tasks/:taskId'].DELETE({
          params: { agentId: AGENT_ID, taskId: TASK_ID }
        } as never)
      ).resolves.toBeUndefined()

      expect(deleteTaskMock).toHaveBeenCalledWith(AGENT_ID, TASK_ID)
    })

    it('throws notFound when task does not exist on DELETE', async () => {
      deleteTaskMock.mockResolvedValueOnce(false)

      await expect(
        agentHandlers['/agents/:agentId/tasks/:taskId'].DELETE({
          params: { agentId: AGENT_ID, taskId: TASK_ID }
        } as never)
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    })
  })

  // ── /skills ──────────────────────────────────────────────────────────────

  describe('/skills', () => {
    it('delegates GET to skillService.list and returns direct array', async () => {
      listSkillsMock.mockResolvedValueOnce([mockSkill])

      const result = await skillHandlers['/skills'].GET({ query: {} } as never)

      expect(listSkillsMock).toHaveBeenCalledWith({})
      expect(result).toEqual([mockSkill])
    })

    it('passes agentId to skillService.list when provided', async () => {
      listSkillsMock.mockResolvedValueOnce([mockSkill])

      const result = await skillHandlers['/skills'].GET({ query: { agentId: AGENT_ID } } as never)

      expect(listSkillsMock).toHaveBeenCalledWith({ agentId: AGENT_ID })
      expect(result).toEqual([mockSkill])
    })

    it('forwards search to skillService.list', async () => {
      listSkillsMock.mockResolvedValueOnce([mockSkill])

      await skillHandlers['/skills'].GET({
        query: { search: 'summary' }
      } as never)

      expect(listSkillsMock).toHaveBeenCalledWith({ search: 'summary' })
    })

    it('rejects skill tag filters before calling the service', async () => {
      await expect(
        skillHandlers['/skills'].GET({
          query: { tagIds: ['11111111-1111-4111-8111-111111111111'] }
        } as never)
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })

      expect(listSkillsMock).not.toHaveBeenCalled()
    })

    it('propagates notFound from /skills service when agentId does not exist', async () => {
      listSkillsMock.mockRejectedValueOnce({ code: ErrorCode.NOT_FOUND })

      await expect(skillHandlers['/skills'].GET({ query: { agentId: AGENT_ID } } as never)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })

      expect(listSkillsMock).toHaveBeenCalledWith({ agentId: AGENT_ID })
    })

    it('rejects invalid skill query fields', async () => {
      await expect(skillHandlers['/skills'].GET({ query: { extra: 'nope' } } as never)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })

      expect(listSkillsMock).not.toHaveBeenCalled()
    })
  })

  // ── /skills/:skillId ──────────────────────────────────────────────────────

  describe('/skills/:skillId', () => {
    it('delegates GET to skillService.getById', async () => {
      getSkillByIdMock.mockResolvedValueOnce(mockSkill)

      const result = await skillHandlers['/skills/:skillId'].GET({ params: { skillId: SKILL_ID } } as never)

      expect(getSkillByIdMock).toHaveBeenCalledWith(SKILL_ID)
      expect(result).toMatchObject({ id: SKILL_ID })
    })

    it('throws notFound when skill does not exist', async () => {
      getSkillByIdMock.mockResolvedValueOnce(null)

      await expect(
        skillHandlers['/skills/:skillId'].GET({ params: { skillId: SKILL_ID } } as never)
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })
})
