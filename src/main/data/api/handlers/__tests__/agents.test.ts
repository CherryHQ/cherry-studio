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
  listSessionMessagesMock,
  deleteSessionMessageMock,
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
  listSessionsMock: vi.fn(),
  createSessionMock: vi.fn(),
  getSessionMock: vi.fn(),
  updateSessionMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  listSessionMessagesMock: vi.fn(),
  deleteSessionMessageMock: vi.fn(),
  listTasksMock: vi.fn(),
  createTaskMock: vi.fn(),
  getTaskMock: vi.fn(),
  updateTaskMock: vi.fn(),
  deleteTaskMock: vi.fn(),
  listSkillsMock: vi.fn(),
  getSkillByIdMock: vi.fn()
}))

vi.mock('@main/services/agents/services/AgentService', () => ({
  agentService: {
    listAgents: listAgentsMock,
    createAgent: createAgentMock,
    getAgent: getAgentMock,
    updateAgent: updateAgentMock,
    deleteAgent: deleteAgentMock
  }
}))

vi.mock('@main/services/agents/services/SessionService', () => ({
  sessionService: {
    listSessions: listSessionsMock,
    createSession: createSessionMock,
    getSession: getSessionMock,
    updateSession: updateSessionMock,
    deleteSession: deleteSessionMock
  }
}))

vi.mock('@main/services/agents/services/SessionMessageService', () => ({
  sessionMessageService: {
    listSessionMessages: listSessionMessagesMock,
    deleteSessionMessage: deleteSessionMessageMock
  }
}))

vi.mock('@main/services/agents/services/TaskService', () => ({
  taskService: {
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

      const result = await agentHandlers['/agents'].GET({} as never)

      expect(listAgentsMock).toHaveBeenCalledOnce()
      expect(result).toMatchObject({ data: [mockAgent], total: 1 })
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

  // ── /agents/:id ──────────────────────────────────────────────────────────

  describe('/agents/:id', () => {
    it('delegates GET and returns agent', async () => {
      getAgentMock.mockResolvedValueOnce(mockAgent)

      const result = await agentHandlers['/agents/:id'].GET({ params: { id: AGENT_ID } } as never)

      expect(getAgentMock).toHaveBeenCalledWith(AGENT_ID)
      expect(result).toMatchObject({ id: AGENT_ID })
    })

    it('throws notFound when agent does not exist on GET', async () => {
      getAgentMock.mockResolvedValueOnce(null)

      await expect(agentHandlers['/agents/:id'].GET({ params: { id: AGENT_ID } } as never)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('delegates PATCH and returns updated agent', async () => {
      updateAgentMock.mockResolvedValueOnce({ ...mockAgent, name: 'Updated' })

      const result = await agentHandlers['/agents/:id'].PATCH({
        params: { id: AGENT_ID },
        body: { name: 'Updated' }
      } as never)

      expect(updateAgentMock).toHaveBeenCalledWith(AGENT_ID, { name: 'Updated' })
      expect(result).toMatchObject({ name: 'Updated' })
    })

    it('throws notFound when agent does not exist on PATCH', async () => {
      updateAgentMock.mockResolvedValueOnce(null)

      await expect(
        agentHandlers['/agents/:id'].PATCH({ params: { id: AGENT_ID }, body: {} } as never)
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    })

    it('delegates DELETE', async () => {
      deleteAgentMock.mockResolvedValueOnce(true)

      await expect(agentHandlers['/agents/:id'].DELETE({ params: { id: AGENT_ID } } as never)).resolves.toBeUndefined()

      expect(deleteAgentMock).toHaveBeenCalledWith(AGENT_ID)
    })

    it('throws notFound when agent does not exist on DELETE', async () => {
      deleteAgentMock.mockResolvedValueOnce(false)

      await expect(agentHandlers['/agents/:id'].DELETE({ params: { id: AGENT_ID } } as never)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  // ── /agents/:id/sessions ─────────────────────────────────────────────────

  describe('/agents/:id/sessions', () => {
    it('delegates GET to sessionService.listSessions', async () => {
      listSessionsMock.mockResolvedValueOnce({ sessions: [mockSession], total: 1 })

      const result = await agentHandlers['/agents/:id/sessions'].GET({
        params: { id: AGENT_ID }
      } as never)

      expect(listSessionsMock).toHaveBeenCalledWith(AGENT_ID)
      expect(result).toMatchObject({ data: [mockSession], total: 1 })
    })

    it('delegates POST to sessionService.createSession', async () => {
      createSessionMock.mockResolvedValueOnce(mockSession)

      const result = await agentHandlers['/agents/:id/sessions'].POST({
        params: { id: AGENT_ID },
        body: { model: 'claude-3-5-sonnet' }
      } as never)

      expect(createSessionMock).toHaveBeenCalledWith(AGENT_ID, { model: 'claude-3-5-sonnet' })
      expect(result).toMatchObject({ id: SESSION_ID })
    })
  })

  // ── /agents/:id/sessions/:sid ─────────────────────────────────────────────

  describe('/agents/:id/sessions/:sid', () => {
    it('delegates GET and throws notFound when session is missing', async () => {
      getSessionMock.mockResolvedValueOnce(mockSession)
      const result = await agentHandlers['/agents/:id/sessions/:sid'].GET({
        params: { id: AGENT_ID, sid: SESSION_ID }
      } as never)
      expect(result).toMatchObject({ id: SESSION_ID })

      getSessionMock.mockResolvedValueOnce(null)
      await expect(
        agentHandlers['/agents/:id/sessions/:sid'].GET({ params: { id: AGENT_ID, sid: SESSION_ID } } as never)
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    })

    it('delegates DELETE', async () => {
      deleteSessionMock.mockResolvedValueOnce(true)

      await expect(
        agentHandlers['/agents/:id/sessions/:sid'].DELETE({
          params: { id: AGENT_ID, sid: SESSION_ID }
        } as never)
      ).resolves.toBeUndefined()
    })
  })

  // ── /agents/:id/sessions/:sid/messages ──────────────────────────────────

  describe('/agents/:id/sessions/:sid/messages', () => {
    it('delegates GET to sessionMessageService.listSessionMessages', async () => {
      listSessionMessagesMock.mockResolvedValueOnce({ messages: [] })

      await agentHandlers['/agents/:id/sessions/:sid/messages'].GET({
        params: { id: AGENT_ID, sid: SESSION_ID },
        query: { limit: 20 }
      } as never)

      expect(listSessionMessagesMock).toHaveBeenCalledWith(SESSION_ID, { limit: 20 })
    })
  })

  // ── /agents/:id/sessions/:sid/messages/:messageId ────────────────────────

  describe('/agents/:id/sessions/:sid/messages/:messageId', () => {
    it('delegates DELETE with numeric messageId', async () => {
      deleteSessionMessageMock.mockResolvedValueOnce(true)

      await expect(
        agentHandlers['/agents/:id/sessions/:sid/messages/:messageId'].DELETE({
          params: { id: AGENT_ID, sid: SESSION_ID, messageId: MESSAGE_ID }
        } as never)
      ).resolves.toBeUndefined()

      expect(deleteSessionMessageMock).toHaveBeenCalledWith(SESSION_ID, 42)
    })

    it('throws validation error for non-numeric messageId', async () => {
      await expect(
        agentHandlers['/agents/:id/sessions/:sid/messages/:messageId'].DELETE({
          params: { id: AGENT_ID, sid: SESSION_ID, messageId: 'not-a-number' }
        } as never)
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })

      expect(deleteSessionMessageMock).not.toHaveBeenCalled()
    })

    it('throws notFound when message does not exist', async () => {
      deleteSessionMessageMock.mockResolvedValueOnce(false)

      await expect(
        agentHandlers['/agents/:id/sessions/:sid/messages/:messageId'].DELETE({
          params: { id: AGENT_ID, sid: SESSION_ID, messageId: MESSAGE_ID }
        } as never)
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    })
  })

  // ── /agents/:id/tasks ────────────────────────────────────────────────────

  describe('/agents/:id/tasks', () => {
    it('delegates GET to taskService.listTasks', async () => {
      listTasksMock.mockResolvedValueOnce({ tasks: [mockTask], total: 1 })

      const result = await agentHandlers['/agents/:id/tasks'].GET({
        params: { id: AGENT_ID }
      } as never)

      expect(listTasksMock).toHaveBeenCalledWith(AGENT_ID)
      expect(result).toMatchObject({ data: [mockTask], total: 1 })
    })

    it('delegates POST to taskService.createTask', async () => {
      createTaskMock.mockResolvedValueOnce(mockTask)

      const result = await agentHandlers['/agents/:id/tasks'].POST({
        params: { id: AGENT_ID },
        body: { name: 'Daily', prompt: 'Hello', schedule_type: 'cron', schedule_value: '0 9 * * *' }
      } as never)

      expect(createTaskMock).toHaveBeenCalledOnce()
      expect(result).toMatchObject({ id: TASK_ID })
    })

    it('rejects POST when required task fields are missing', async () => {
      await expect(
        agentHandlers['/agents/:id/tasks'].POST({
          params: { id: AGENT_ID },
          body: { name: 'Daily' }
        } as never)
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })

      expect(createTaskMock).not.toHaveBeenCalled()
    })
  })

  // ── /agents/:id/tasks/:tid ───────────────────────────────────────────────

  describe('/agents/:id/tasks/:tid', () => {
    it('delegates GET and throws notFound when task is missing', async () => {
      getTaskMock.mockResolvedValueOnce(null)

      await expect(
        agentHandlers['/agents/:id/tasks/:tid'].GET({ params: { id: AGENT_ID, tid: TASK_ID } } as never)
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    })

    it('delegates DELETE', async () => {
      deleteTaskMock.mockResolvedValueOnce(true)

      await expect(
        agentHandlers['/agents/:id/tasks/:tid'].DELETE({ params: { id: AGENT_ID, tid: TASK_ID } } as never)
      ).resolves.toBeUndefined()

      expect(deleteTaskMock).toHaveBeenCalledWith(AGENT_ID, TASK_ID)
    })
  })

  // ── /skills ──────────────────────────────────────────────────────────────

  describe('/skills', () => {
    it('delegates GET to skillService.list and returns consistent shape', async () => {
      listSkillsMock.mockResolvedValueOnce([mockSkill])

      const result = await agentHandlers['/skills'].GET({} as never)

      expect(listSkillsMock).toHaveBeenCalledOnce()
      expect(result).toMatchObject({ data: [mockSkill], total: 1, offset: 0 })
    })
  })

  // ── /skills/:id ──────────────────────────────────────────────────────────

  describe('/skills/:id', () => {
    it('delegates GET to skillService.getById', async () => {
      getSkillByIdMock.mockResolvedValueOnce(mockSkill)

      const result = await agentHandlers['/skills/:id'].GET({ params: { id: SKILL_ID } } as never)

      expect(getSkillByIdMock).toHaveBeenCalledWith(SKILL_ID)
      expect(result).toMatchObject({ id: SKILL_ID })
    })

    it('throws notFound when skill does not exist', async () => {
      getSkillByIdMock.mockResolvedValueOnce(null)

      await expect(agentHandlers['/skills/:id'].GET({ params: { id: SKILL_ID } } as never)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })
})
