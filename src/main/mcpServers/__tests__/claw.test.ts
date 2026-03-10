import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock TaskService before importing ClawServer
const mockCreateTask = vi.fn()
const mockListTasks = vi.fn()
const mockDeleteTask = vi.fn()
const mockGetNotifyAdapters = vi.fn()
const mockSendMessage = vi.fn()
const mockPluginInstall = vi.fn()
const mockPluginUninstall = vi.fn()
const mockPluginListInstalled = vi.fn()
const mockNetFetch = vi.fn()

vi.mock('@main/services/agents/services/TaskService', () => ({
  taskService: {
    createTask: mockCreateTask,
    listTasks: mockListTasks,
    deleteTask: mockDeleteTask
  }
}))

vi.mock('@main/services/agents/services/channels/ChannelManager', () => ({
  channelManager: {
    getNotifyAdapters: mockGetNotifyAdapters
  }
}))

vi.mock('@main/services/agents/plugins/PluginService', () => ({
  PluginService: {
    getInstance: () => ({
      install: mockPluginInstall,
      uninstall: mockPluginUninstall,
      listInstalled: mockPluginListInstalled
    })
  }
}))

vi.mock('electron', () => ({
  net: {
    fetch: mockNetFetch
  }
}))

// Import after mocks
const { default: ClawServer } = await import('../claw')
type ClawServerInstance = InstanceType<typeof ClawServer>

function createServer(agentId = 'agent_test') {
  return new ClawServer(agentId)
}

// Helper to call tools via the Server's request handlers
async function callTool(server: ClawServerInstance, args: Record<string, unknown>, toolName = 'cron') {
  // Use the server's internal handler by simulating a CallTool request
  const handlers = (server.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }

  return callToolHandler(
    { method: 'tools/call', params: { name: toolName, arguments: args } },
    {} // extra
  )
}

async function listTools(server: ClawServerInstance) {
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

  it('should list the cron, notify, and skills tools', async () => {
    const server = createServer()
    const result = await listTools(server)
    expect(result.tools).toHaveLength(3)
    expect(result.tools.map((t: any) => t.name)).toEqual(['cron', 'notify', 'skills'])
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

  describe('notify tool', () => {
    function makeAdapter(channelId: string, chatIds: string[]) {
      return {
        channelId,
        notifyChatIds: chatIds,
        sendMessage: mockSendMessage
      }
    }

    it('should send notification to all notify adapters', async () => {
      mockSendMessage.mockResolvedValue(undefined)
      mockGetNotifyAdapters.mockReturnValue([makeAdapter('ch1', ['100', '200'])])

      const server = createServer('agent_1')
      const result = await callTool(server, { message: 'Hello user!' }, 'notify')

      expect(mockGetNotifyAdapters).toHaveBeenCalledWith('agent_1')
      expect(mockSendMessage).toHaveBeenCalledTimes(2)
      expect(mockSendMessage).toHaveBeenCalledWith('100', 'Hello user!')
      expect(mockSendMessage).toHaveBeenCalledWith('200', 'Hello user!')
      expect(result.content[0].text).toContain('2 chat(s)')
    })

    it('should filter by channel_id when provided', async () => {
      mockSendMessage.mockResolvedValue(undefined)
      mockGetNotifyAdapters.mockReturnValue([makeAdapter('ch1', ['100']), makeAdapter('ch2', ['200'])])

      const server = createServer('agent_1')
      const result = await callTool(server, { message: 'Targeted', channel_id: 'ch2' }, 'notify')

      expect(mockSendMessage).toHaveBeenCalledTimes(1)
      expect(mockSendMessage).toHaveBeenCalledWith('200', 'Targeted')
      expect(result.content[0].text).toContain('1 chat(s)')
    })

    it('should return message when no notify channels found', async () => {
      mockGetNotifyAdapters.mockReturnValue([])

      const server = createServer('agent_1')
      const result = await callTool(server, { message: 'Hello' }, 'notify')

      expect(result.content[0].text).toContain('No notify-enabled channels')
      expect(mockSendMessage).not.toHaveBeenCalled()
    })

    it('should error when message is missing', async () => {
      const server = createServer()
      const result = await callTool(server, {}, 'notify')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'message' is required")
    })

    it('should report partial failures', async () => {
      mockSendMessage.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('rate limited'))
      mockGetNotifyAdapters.mockReturnValue([makeAdapter('ch1', ['100', '200'])])

      const server = createServer('agent_1')
      const result = await callTool(server, { message: 'Test' }, 'notify')

      expect(result.content[0].text).toContain('1 chat(s)')
      expect(result.content[0].text).toContain('rate limited')
    })
  })

  describe('skills tool', () => {
    it('should search marketplace skills', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          skills: [
            {
              name: 'gh-create-pr',
              description: 'Create GitHub PRs',
              author: 'test-author',
              namespace: '@test-owner/test-repo',
              installs: 42,
              metadata: { repoOwner: 'test-owner', repoName: 'test-repo' }
            }
          ],
          total: 1
        })
      }
      mockNetFetch.mockResolvedValue(mockResponse)

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'search', query: 'github pr' }, 'skills')

      expect(mockNetFetch).toHaveBeenCalledWith(expect.stringContaining('/api/skills'), { method: 'GET' })
      expect(result.content[0].text).toContain('gh-create-pr')
      expect(result.content[0].text).toContain('test-owner/test-repo/gh-create-pr')
    })

    it('should handle empty search results', async () => {
      mockNetFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ skills: [], total: 0 })
      })

      const server = createServer()
      const result = await callTool(server, { action: 'search', query: 'nonexistent' }, 'skills')

      expect(result.content[0].text).toContain('No skills found')
    })

    it('should error when query is missing for search', async () => {
      const server = createServer()
      const result = await callTool(server, { action: 'search' }, 'skills')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'query' is required")
    })

    it('should install a marketplace skill', async () => {
      mockPluginInstall.mockResolvedValue({
        name: 'gh-create-pr',
        description: 'Create PRs',
        filename: 'gh-create-pr'
      })

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'install', identifier: 'owner/repo/gh-create-pr' }, 'skills')

      expect(mockPluginInstall).toHaveBeenCalledWith({
        agentId: 'agent_1',
        sourcePath: 'marketplace:skill:owner/repo/gh-create-pr',
        type: 'skill'
      })
      expect(result.content[0].text).toContain('Skill installed')
      expect(result.content[0].text).toContain('gh-create-pr')
    })

    it('should error when identifier is missing for install', async () => {
      const server = createServer()
      const result = await callTool(server, { action: 'install' }, 'skills')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'identifier' is required")
    })

    it('should remove an installed skill', async () => {
      mockPluginUninstall.mockResolvedValue(undefined)

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'remove', name: 'gh-create-pr' }, 'skills')

      expect(mockPluginUninstall).toHaveBeenCalledWith({
        agentId: 'agent_1',
        filename: 'gh-create-pr',
        type: 'skill'
      })
      expect(result.content[0].text).toContain('removed')
    })

    it('should error when name is missing for remove', async () => {
      const server = createServer()
      const result = await callTool(server, { action: 'remove' }, 'skills')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'name' is required")
    })

    it('should list installed skills', async () => {
      mockPluginListInstalled.mockResolvedValue([
        { type: 'skill', filename: 'gh-create-pr', metadata: { name: 'gh-create-pr', description: 'Create PRs' } },
        { type: 'agent', filename: 'some-agent.md', metadata: { name: 'some-agent', description: 'An agent' } },
        { type: 'skill', filename: 'code-review', metadata: { name: 'code-review', description: 'Review code' } }
      ])

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'list' }, 'skills')

      expect(mockPluginListInstalled).toHaveBeenCalledWith('agent_1')
      expect(result.content[0].text).toContain('gh-create-pr')
      expect(result.content[0].text).toContain('code-review')
      // Should not include the agent
      expect(result.content[0].text).not.toContain('some-agent')
    })

    it('should handle empty skills list', async () => {
      mockPluginListInstalled.mockResolvedValue([])

      const server = createServer()
      const result = await callTool(server, { action: 'list' }, 'skills')

      expect(result.content[0].text).toBe('No skills installed.')
    })

    it('should handle unknown skills action', async () => {
      const server = createServer()
      const result = await callTool(server, { action: 'unknown' }, 'skills')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Unknown action')
    })
  })
})
