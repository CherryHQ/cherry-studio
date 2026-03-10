import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock TaskService before importing ClawServer
const mockCreateTask = vi.fn()
const mockListTasks = vi.fn()
const mockDeleteTask = vi.fn()

vi.mock('@main/services/agents/services/TaskService', () => ({
  taskService: {
    createTask: mockCreateTask,
    listTasks: mockListTasks,
    deleteTask: mockDeleteTask
  }
}))

// Import after mocks
const { default: ClawServer } = await import('../claw')

function createServer(agentId = 'agent_test') {
  return new ClawServer(agentId)
}

// Helper to call tools via the Server's request handlers
async function callTool(server: ClawServer, args: Record<string, unknown>) {
  // Use the server's internal handler by simulating a CallTool request
  const handlers = (server.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }

  return callToolHandler(
    { method: 'tools/call', params: { name: 'cron', arguments: args } },
    {} // extra
  )
}

async function listTools(server: ClawServer) {
  const handlers = (server.server as any)._requestHandlers
  const listHandler = handlers?.get('tools/list')
  if (!listHandler) {
    throw new Error('No tools/list handler registered')
  }
  return listHandler({ method: 'tools/list', params: {} }, {})
}

describe('ClawServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should list the cron tool', async () => {
    const server = createServer()
    const result = await listTools(server)
    expect(result.tools).toHaveLength(1)
    expect(result.tools[0].name).toBe('cron')
  })

  describe('add action', () => {
    it('should create a task with cron schedule', async () => {
      const task = { id: 'task_1', name: 'test', schedule_type: 'cron', schedule_value: '0 9 * * 1-5' }
      mockCreateTask.mockResolvedValue(task)

      const server = createServer('agent_1')
      const result = await callTool(server, {
        action: 'add',
        name: 'Daily standup',
        message: 'Run standup check',
        cron: '0 9 * * 1-5'
      })

      expect(mockCreateTask).toHaveBeenCalledWith('agent_1', {
        name: 'Daily standup',
        prompt: 'Run standup check',
        schedule_type: 'cron',
        schedule_value: '0 9 * * 1-5',
        context_mode: 'session'
      })
      expect(result.content[0].text).toContain('Job created')
    })

    it('should create a task with interval schedule', async () => {
      const task = { id: 'task_2', name: 'check', schedule_type: 'interval', schedule_value: '30' }
      mockCreateTask.mockResolvedValue(task)

      const server = createServer('agent_2')
      await callTool(server, {
        action: 'add',
        name: 'Health check',
        message: 'Check system health',
        every: '30m'
      })

      expect(mockCreateTask).toHaveBeenCalledWith('agent_2', {
        name: 'Health check',
        prompt: 'Check system health',
        schedule_type: 'interval',
        schedule_value: '30',
        context_mode: 'session'
      })
    })

    it('should parse hour+minute durations', async () => {
      mockCreateTask.mockResolvedValue({ id: 'task_3' })

      const server = createServer()
      await callTool(server, {
        action: 'add',
        name: 'test',
        message: 'test',
        every: '1h30m'
      })

      expect(mockCreateTask).toHaveBeenCalledWith(
        'agent_test',
        expect.objectContaining({
          schedule_type: 'interval',
          schedule_value: '90'
        })
      )
    })

    it('should create a one-time task with at', async () => {
      mockCreateTask.mockResolvedValue({ id: 'task_4' })

      const server = createServer()
      await callTool(server, {
        action: 'add',
        name: 'Deploy',
        message: 'Deploy to prod',
        at: '2024-01-15T14:30:00+08:00'
      })

      expect(mockCreateTask).toHaveBeenCalledWith(
        'agent_test',
        expect.objectContaining({
          schedule_type: 'once'
        })
      )
    })

    it('should use isolated context mode when session_mode is new', async () => {
      mockCreateTask.mockResolvedValue({ id: 'task_5' })

      const server = createServer()
      await callTool(server, {
        action: 'add',
        name: 'test',
        message: 'test',
        cron: '* * * * *',
        session_mode: 'new'
      })

      expect(mockCreateTask).toHaveBeenCalledWith(
        'agent_test',
        expect.objectContaining({
          context_mode: 'isolated'
        })
      )
    })

    it('should reject when no schedule is provided', async () => {
      const server = createServer()
      const result = await callTool(server, {
        action: 'add',
        name: 'test',
        message: 'test'
      })

      expect(result.isError).toBe(true)
      expect(mockCreateTask).not.toHaveBeenCalled()
    })

    it('should reject when multiple schedules are provided', async () => {
      const server = createServer()
      const result = await callTool(server, {
        action: 'add',
        name: 'test',
        message: 'test',
        cron: '* * * * *',
        every: '30m'
      })

      expect(result.isError).toBe(true)
      expect(mockCreateTask).not.toHaveBeenCalled()
    })
  })

  describe('list action', () => {
    it('should list tasks', async () => {
      const tasks = [{ id: 'task_1', name: 'Job 1' }]
      mockListTasks.mockResolvedValue({ tasks, total: 1 })

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'list' })

      expect(mockListTasks).toHaveBeenCalledWith('agent_1', { limit: 100 })
      expect(result.content[0].text).toContain('Job 1')
    })

    it('should handle empty task list', async () => {
      mockListTasks.mockResolvedValue({ tasks: [], total: 0 })

      const server = createServer()
      const result = await callTool(server, { action: 'list' })

      expect(result.content[0].text).toBe('No scheduled jobs.')
    })
  })

  describe('remove action', () => {
    it('should remove a task', async () => {
      mockDeleteTask.mockResolvedValue(true)

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'remove', id: 'task_1' })

      expect(mockDeleteTask).toHaveBeenCalledWith('agent_1', 'task_1')
      expect(result.content[0].text).toContain('removed')
    })

    it('should error when task not found', async () => {
      mockDeleteTask.mockResolvedValue(false)

      const server = createServer()
      const result = await callTool(server, { action: 'remove', id: 'nonexistent' })

      expect(result.isError).toBe(true)
    })
  })
})
