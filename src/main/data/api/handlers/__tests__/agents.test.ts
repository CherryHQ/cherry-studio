import { ErrorCode } from '@shared/data/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listAgentsMock,
  createAgentMock,
  getAgentMock,
  updateAgentMock,
  deleteAgentMock,
  listSessionsMock,
  createSessionMock,
  getSessionMock,
  updateSessionMock,
  deleteSessionMock,
  sessionExistsMock,
  listSessionMessagesMock,
  deleteSessionMessageMock,
  listTasksMock,
  createTaskMock,
  getTaskMock,
  updateTaskMock,
  deleteTaskMock,
  workflowCreateTaskMock,
  workflowUpdateTaskMock,
  workflowDeleteTaskMock,
  listSkillsMock,
  getSkillByIdMock
} = vi.hoisted(() => ({
  listAgentsMock: vi.fn(),
  createAgentMock: vi.fn(),
  getAgentMock: vi.fn(),
  updateAgentMock: vi.fn(),
  deleteAgentMock: vi.fn(),
  listSessionsMock: vi.fn(),
  createSessionMock: vi.fn(),
  getSessionMock: vi.fn(),
  updateSessionMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  sessionExistsMock: vi.fn(),
  listSessionMessagesMock: vi.fn(),
  deleteSessionMessageMock: vi.fn(),
  listTasksMock: vi.fn(),
  createTaskMock: vi.fn(),
  getTaskMock: vi.fn(),
  updateTaskMock: vi.fn(),
  deleteTaskMock: vi.fn(),
  workflowCreateTaskMock: vi.fn(),
  workflowUpdateTaskMock: vi.fn(),
  workflowDeleteTaskMock: vi.fn(),
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

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: {
    listSessions: listSessionsMock,
    createSession: createSessionMock,
    getSession: getSessionMock,
    updateSession: updateSessionMock,
    deleteSession: deleteSessionMock,
    sessionExists: sessionExistsMock
  }
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: {
    listSessionMessages: listSessionMessagesMock,
    deleteSessionMessage: deleteSessionMessageMock
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

vi.mock('@main/services/agents/skills/SkillService', () => ({
  skillService: {
    list: listSkillsMock,
    getById: getSkillByIdMock
  }
}))

vi.mock('@data/services/AgentTaskWorkflowService', () => ({
  agentTaskWorkflowService: {
    createTask: workflowCreateTaskMock,
    updateTask: workflowUpdateTaskMock,
    deleteTask: workflowDeleteTaskMock
  }
}))

vi.mock('@data/services/AgentChannelService', () => ({ agentChannelService: {} }))
vi.mock('@main/services/agents/services/channels', () => ({ channelManager: {} }))

import { agentHandlers } from '../agents'

const AGENT_ID = 'agent_1234567890_abcdefghi'
const SESSION_ID = 'session_1234567890_abcdefghi'
const TASK_ID = 'task_1234567890_abcdefghi'
const SKILL_ID = 'skill-abc-123'
const MESSAGE_ID = '42'

const mockAgent = { id: AGENT_ID, name: 'Test', type: 'claude-code', model: 'claude-3-5-sonnet' }
const mockSession = { id: SESSION_ID, agentId: AGENT_ID, model: 'claude-3-5-sonnet' }
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

    it('GET works without query params (defaults to limit=50 offset=0)', async () => {
      listAgentsMock.mockResolvedValueOnce({ agents: [], total: 0 })

      const result = await agentHandlers['/agents'].GET({} as never)

      expect(listAgentsMock).toHaveBeenCalledWith({ limit: 50, offset: 0 })
      expect(result).toMatchObject({ total: 0 })
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
        body: { type: 'claude-code', name: 'Test', model: 'claude-3-5-sonnet' }
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

  // ── /agents/:agentId/sessions ─────────────────────────────────────────────

  describe('/agents/:agentId/sessions', () => {
    it('delegates GET to sessionService.listSessions', async () => {
      listSessionsMock.mockResolvedValueOnce({ sessions: [mockSession], total: 1 })

      const result = await agentHandlers['/agents/:agentId/sessions'].GET({
        params: { agentId: AGENT_ID },
        query: {}
      } as never)

      expect(listSessionsMock).toHaveBeenCalledWith(AGENT_ID, { limit: 50, offset: 0 })
      expect(result).toMatchObject({ items: [mockSession], total: 1, page: 1 })
    })

    it('delegates POST to sessionService.createSession', async () => {
      createSessionMock.mockResolvedValueOnce(mockSession)

      const result = await agentHandlers['/agents/:agentId/sessions'].POST({
        params: { agentId: AGENT_ID },
        body: { model: 'claude-3-5-sonnet' }
      } as never)

      expect(createSessionMock).toHaveBeenCalledWith(AGENT_ID, { model: 'claude-3-5-sonnet' })
      expect(result).toMatchObject({ id: SESSION_ID })
    })

    it('rejects invalid pagination query', async () => {
      await expect(
        agentHandlers['/agents/:agentId/sessions'].GET({ params: { agentId: AGENT_ID }, query: { limit: 0 } } as never)
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })

      expect(listSessionsMock).not.toHaveBeenCalled()
    })
  })

  // ── /agents/:agentId/sessions/:sessionId ──────────────────────────────────

  describe('/agents/:agentId/sessions/:sessionId', () => {
    it('delegates GET and throws notFound when session is missing', async () => {
      getSessionMock.mockResolvedValueOnce(mockSession)
      const result = await agentHandlers['/agents/:agentId/sessions/:sessionId'].GET({
        params: { agentId: AGENT_ID, sessionId: SESSION_ID }
      } as never)
      expect(result).toMatchObject({ id: SESSION_ID })

      getSessionMock.mockResolvedValueOnce(null)
      await expect(
        agentHandlers['/agents/:agentId/sessions/:sessionId'].GET({
          params: { agentId: AGENT_ID, sessionId: SESSION_ID }
        } as never)
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    })

    it('delegates PATCH and returns updated session', async () => {
      updateSessionMock.mockResolvedValueOnce({ ...mockSession, name: 'Updated' })

      const result = await agentHandlers['/agents/:agentId/sessions/:sessionId'].PATCH({
        params: { agentId: AGENT_ID, sessionId: SESSION_ID },
        body: { name: 'Updated' }
      } as never)

      expect(updateSessionMock).toHaveBeenCalledWith(AGENT_ID, SESSION_ID, expect.objectContaining({ name: 'Updated' }))
      expect(result).toMatchObject({ name: 'Updated' })
    })

    it('throws notFound when session does not exist on PATCH', async () => {
      updateSessionMock.mockResolvedValueOnce(null)

      await expect(
        agentHandlers['/agents/:agentId/sessions/:sessionId'].PATCH({
          params: { agentId: AGENT_ID, sessionId: SESSION_ID },
          body: {}
        } as never)
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    })

    it('delegates DELETE', async () => {
      deleteSessionMock.mockResolvedValueOnce(true)

      await expect(
        agentHandlers['/agents/:agentId/sessions/:sessionId'].DELETE({
          params: { agentId: AGENT_ID, sessionId: SESSION_ID }
        } as never)
      ).resolves.toBeUndefined()
    })
  })

  // ── /agents/:agentId/sessions/:sessionId/messages ─────────────────────────

  describe('/agents/:agentId/sessions/:sessionId/messages', () => {
    it('delegates GET to sessionMessageService.listSessionMessages', async () => {
      listSessionMessagesMock.mockResolvedValueOnce({ messages: [], total: 0 })

      const result = await agentHandlers['/agents/:agentId/sessions/:sessionId/messages'].GET({
        params: { agentId: AGENT_ID, sessionId: SESSION_ID },
        query: { limit: 20 }
      } as never)

      expect(listSessionMessagesMock).toHaveBeenCalledWith(AGENT_ID, SESSION_ID, { limit: 20, offset: 0 })
      expect(result).toEqual({ items: [], total: 0, page: 1 })
    })

    it('computes offset from page and limit on GET', async () => {
      listSessionMessagesMock.mockResolvedValueOnce({ messages: [], total: 0 })

      await agentHandlers['/agents/:agentId/sessions/:sessionId/messages'].GET({
        params: { agentId: AGENT_ID, sessionId: SESSION_ID },
        query: { page: 2, limit: 10 }
      } as never)

      expect(listSessionMessagesMock).toHaveBeenCalledWith(AGENT_ID, SESSION_ID, { limit: 10, offset: 10 })
    })

    it('rejects invalid pagination query', async () => {
      await expect(
        agentHandlers['/agents/:agentId/sessions/:sessionId/messages'].GET({
          params: { agentId: AGENT_ID, sessionId: SESSION_ID },
          query: { page: 0 }
        } as never)
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })

      expect(listSessionMessagesMock).not.toHaveBeenCalled()
    })
  })

  // ── /agents/:agentId/sessions/:sessionId/messages/:messageId ─────────────

  describe('/agents/:agentId/sessions/:sessionId/messages/:messageId', () => {
    it('delegates DELETE to deleteSessionMessage and returns undefined', async () => {
      deleteSessionMessageMock.mockResolvedValueOnce(undefined)

      await expect(
        agentHandlers['/agents/:agentId/sessions/:sessionId/messages/:messageId'].DELETE({
          params: { agentId: AGENT_ID, sessionId: SESSION_ID, messageId: MESSAGE_ID }
        } as never)
      ).resolves.toBeUndefined()

      expect(deleteSessionMessageMock).toHaveBeenCalledWith(AGENT_ID, SESSION_ID, MESSAGE_ID)
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

    it('delegates POST to task workflow service', async () => {
      workflowCreateTaskMock.mockResolvedValueOnce(mockTask)

      const result = await agentHandlers['/agents/:agentId/tasks'].POST({
        params: { agentId: AGENT_ID },
        body: { name: 'Daily', prompt: 'Hello', scheduleType: 'cron', scheduleValue: '0 9 * * *' }
      } as never)

      expect(workflowCreateTaskMock).toHaveBeenCalledWith(
        AGENT_ID,
        expect.objectContaining({ name: 'Daily', prompt: 'Hello' })
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

      expect(workflowCreateTaskMock).not.toHaveBeenCalled()
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

    it('delegates PATCH to task workflow service and returns updated task', async () => {
      workflowUpdateTaskMock.mockResolvedValueOnce({ ...mockTask, name: 'Updated' })

      const result = await agentHandlers['/agents/:agentId/tasks/:taskId'].PATCH({
        params: { agentId: AGENT_ID, taskId: TASK_ID },
        body: { name: 'Updated' }
      } as never)

      expect(workflowUpdateTaskMock).toHaveBeenCalledWith(
        AGENT_ID,
        TASK_ID,
        expect.objectContaining({ name: 'Updated' })
      )
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

    it('delegates DELETE to task workflow service', async () => {
      workflowDeleteTaskMock.mockResolvedValueOnce(true)

      await expect(
        agentHandlers['/agents/:agentId/tasks/:taskId'].DELETE({
          params: { agentId: AGENT_ID, taskId: TASK_ID }
        } as never)
      ).resolves.toBeUndefined()

      expect(workflowDeleteTaskMock).toHaveBeenCalledWith(AGENT_ID, TASK_ID)
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

      const result = await agentHandlers['/skills'].GET({ query: {} } as never)

      expect(listSkillsMock).toHaveBeenCalledWith(undefined)
      expect(result).toEqual([mockSkill])
    })

    it('passes agentId to skillService.list when provided and agent exists', async () => {
      getAgentMock.mockResolvedValueOnce(mockAgent)
      listSkillsMock.mockResolvedValueOnce([mockSkill])

      const result = await agentHandlers['/skills'].GET({ query: { agentId: AGENT_ID } } as never)

      expect(getAgentMock).toHaveBeenCalledWith(AGENT_ID)
      expect(listSkillsMock).toHaveBeenCalledWith(AGENT_ID)
      expect(result).toEqual([mockSkill])
    })

    it('throws notFound for /skills when agentId is provided but agent does not exist', async () => {
      getAgentMock.mockResolvedValueOnce(null)

      await expect(agentHandlers['/skills'].GET({ query: { agentId: AGENT_ID } } as never)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })

      expect(listSkillsMock).not.toHaveBeenCalled()
    })

    it('rejects invalid skill query fields', async () => {
      await expect(agentHandlers['/skills'].GET({ query: { extra: 'nope' } } as never)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })

      expect(listSkillsMock).not.toHaveBeenCalled()
    })
  })

  // ── /skills/:skillId ──────────────────────────────────────────────────────

  describe('/skills/:skillId', () => {
    it('delegates GET to skillService.getById', async () => {
      getSkillByIdMock.mockResolvedValueOnce(mockSkill)

      const result = await agentHandlers['/skills/:skillId'].GET({ params: { skillId: SKILL_ID } } as never)

      expect(getSkillByIdMock).toHaveBeenCalledWith(SKILL_ID)
      expect(result).toMatchObject({ id: SKILL_ID })
    })

    it('throws notFound when skill does not exist', async () => {
      getSkillByIdMock.mockResolvedValueOnce(null)

      await expect(
        agentHandlers['/skills/:skillId'].GET({ params: { skillId: SKILL_ID } } as never)
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })
})
