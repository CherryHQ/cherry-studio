import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock TaskService before importing ClawServer
const mockCreateTask = vi.fn()
const mockListTasks = vi.fn()
const mockDeleteTask = vi.fn()
const mockGetNotifyAdapters = vi.fn()
const mockSendMessage = vi.fn()
const mockSkillInstall = vi.fn()
const mockSkillUninstallByFolderName = vi.fn()
const mockSkillList = vi.fn()
const mockNetFetch = vi.fn()
const mockGetAgent = vi.fn()
const mockUpdateAgent = vi.fn()
const mockSyncAgent = vi.fn()
const mockWaitForQrUrl = vi.fn()
const mockQRCodeToDataURL = vi.fn()
const mockMkdir = vi.fn()
const mockWriteFile = vi.fn()
const mockRename = vi.fn()
const mockAppendFile = vi.fn()
const mockReadFile = vi.fn()
const mockReaddir = vi.fn()
const mockStat = vi.fn()
const mockListChannels = vi.fn()
const mockCreateChannel = vi.fn()
const mockGetChannel = vi.fn()
const mockUpdateChannel = vi.fn()
const mockDeleteChannel = vi.fn()

vi.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  rename: (...args: unknown[]) => mockRename(...args),
  appendFile: (...args: unknown[]) => mockAppendFile(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
  stat: (...args: unknown[]) => mockStat(...args)
}))

vi.mock('@main/services/agents/services/TaskService', () => ({
  taskService: {
    createTask: mockCreateTask,
    listTasks: mockListTasks,
    deleteTask: mockDeleteTask
  }
}))

vi.mock('@main/services/agents/services/AgentService', () => ({
  agentService: {
    getAgent: mockGetAgent,
    updateAgent: mockUpdateAgent
  }
}))

vi.mock('@main/services/agents/services/channels/ChannelManager', () => ({
  channelManager: {
    getNotifyAdapters: mockGetNotifyAdapters,
    getAgentAdapters: mockGetNotifyAdapters,
    getAdapterStatuses: vi.fn().mockReturnValue([]),
    syncAgent: mockSyncAgent,
    waitForQrUrl: mockWaitForQrUrl
  }
}))

vi.mock('qrcode', () => ({
  default: { toDataURL: mockQRCodeToDataURL }
}))

vi.mock('@main/services/agents/skills', () => ({
  skillService: {
    install: mockSkillInstall,
    uninstallByFolderName: mockSkillUninstallByFolderName,
    list: mockSkillList
  }
}))

vi.mock('@main/services/agents/services/ChannelService', () => ({
  channelService: {
    listChannels: mockListChannels,
    createChannel: mockCreateChannel,
    getChannel: mockGetChannel,
    updateChannel: mockUpdateChannel,
    deleteChannel: mockDeleteChannel
  }
}))

vi.mock('@main/services/WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn().mockReturnValue(null)
  }
}))

// Import after mocks — electron is mocked globally in main.setup.ts
// Override net.fetch with our local mock
const electron = await import('electron')
vi.mocked(electron.net.fetch).mockImplementation(mockNetFetch)

const { default: ClawServer } = await import('../claw')
type ClawServerInstance = InstanceType<typeof ClawServer>

function createServer(agentId = 'agent_test') {
  return new ClawServer(agentId)
}

// Helper to call tools via the Server's request handlers
async function callTool(server: ClawServerInstance, args: Record<string, unknown>, toolName = 'cron') {
  // Use the server's internal handler by simulating a CallTool request
  const handlers = (server.mcpServer.server as any)._requestHandlers
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
  const handlers = (server.mcpServer.server as any)._requestHandlers
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

  it('should list all tools', async () => {
    const server = createServer()
    const result = await listTools(server)
    expect(result.tools).toHaveLength(5)
    expect(result.tools.map((t: any) => t.name)).toEqual(['cron', 'notify', 'skills', 'memory', 'config'])
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
        schedule_value: '0 9 * * 1-5'
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
        schedule_value: '30'
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

      expect(result.content[0].text).toContain('No connected channels found')
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
      mockSkillInstall.mockResolvedValue({
        id: 'skill-1',
        name: 'gh-create-pr',
        description: 'Create PRs',
        folderName: 'gh-create-pr',
        isEnabled: false
      })

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'install', identifier: 'owner/repo/gh-create-pr' }, 'skills')

      expect(mockSkillInstall).toHaveBeenCalledWith({
        installSource: 'claude-plugins:owner/repo/gh-create-pr'
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
      mockSkillUninstallByFolderName.mockResolvedValue(undefined)

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'remove', name: 'gh-create-pr' }, 'skills')

      expect(mockSkillUninstallByFolderName).toHaveBeenCalledWith('gh-create-pr')
      expect(result.content[0].text).toContain('removed')
    })

    it('should error when name is missing for remove', async () => {
      const server = createServer()
      const result = await callTool(server, { action: 'remove' }, 'skills')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'name' is required")
    })

    it('should list installed skills', async () => {
      mockSkillList.mockResolvedValue([
        { id: '1', name: 'gh-create-pr', description: 'Create PRs', folderName: 'gh-create-pr', isEnabled: true },
        { id: '2', name: 'code-review', description: 'Review code', folderName: 'code-review', isEnabled: true }
      ])

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'list' }, 'skills')

      expect(mockSkillList).toHaveBeenCalled()
      expect(result.content[0].text).toContain('gh-create-pr')
      expect(result.content[0].text).toContain('code-review')
    })

    it('should handle empty skills list', async () => {
      mockSkillList.mockResolvedValue([])

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

  describe('memory tool', () => {
    const agentWithWorkspace = { accessible_paths: ['/workspace/test'] }

    beforeEach(() => {
      mockGetAgent.mockResolvedValue(agentWithWorkspace)
      mockMkdir.mockResolvedValue(undefined)
      mockWriteFile.mockResolvedValue(undefined)
      mockRename.mockResolvedValue(undefined)
      mockAppendFile.mockResolvedValue(undefined)
      // resolveFileCI: exact path always found (case-sensitive match)
      mockStat.mockResolvedValue({ mtimeMs: 1000 })
    })

    it('should update FACT.md atomically', async () => {
      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'update', content: '# Facts\n\nNew knowledge' }, 'memory')

      expect(mockMkdir).toHaveBeenCalledWith('/workspace/test/memory', { recursive: true })
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('FACT.md.'),
        '# Facts\n\nNew knowledge',
        'utf-8'
      )
      expect(mockRename).toHaveBeenCalled()
      expect(result.content[0].text).toBe('Memory updated.')
    })

    it('should error when content is missing for update', async () => {
      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'update' }, 'memory')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'content' is required")
    })

    it('should append journal entry with tags', async () => {
      const server = createServer('agent_1')
      const result = await callTool(
        server,
        { action: 'append', text: 'Deployed v2.0', tags: ['deploy', 'release'] },
        'memory'
      )

      expect(mockAppendFile).toHaveBeenCalledWith(
        '/workspace/test/memory/JOURNAL.jsonl',
        expect.stringContaining('"text":"Deployed v2.0"'),
        'utf-8'
      )
      expect(result.content[0].text).toContain('Journal entry added')
    })

    it('should error when text is missing for append', async () => {
      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'append' }, 'memory')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'text' is required")
    })

    it('should search journal entries', async () => {
      const entries = [
        '{"ts":"2024-01-01T00:00:00Z","tags":["deploy"],"text":"Deployed v1.0"}',
        '{"ts":"2024-01-02T00:00:00Z","tags":["bugfix"],"text":"Fixed login bug"}',
        '{"ts":"2024-01-03T00:00:00Z","tags":["deploy"],"text":"Deployed v2.0"}'
      ].join('\n')
      mockReadFile.mockResolvedValue(entries)

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'search', tag: 'deploy' }, 'memory')

      const parsed = JSON.parse(result.content[0].text)
      expect(parsed).toHaveLength(2)
      expect(parsed[0].text).toBe('Deployed v2.0') // reverse chronological
    })

    it('should search journal with text query', async () => {
      const entries = [
        '{"ts":"2024-01-01T00:00:00Z","tags":[],"text":"Setup project"}',
        '{"ts":"2024-01-02T00:00:00Z","tags":[],"text":"Fixed login bug"}'
      ].join('\n')
      mockReadFile.mockResolvedValue(entries)

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'search', query: 'login' }, 'memory')

      const parsed = JSON.parse(result.content[0].text)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].text).toBe('Fixed login bug')
    })

    it('should return message when journal has no matches', async () => {
      mockReadFile.mockResolvedValue('{"ts":"2024-01-01T00:00:00Z","tags":[],"text":"hello"}\n')

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'search', query: 'nonexistent' }, 'memory')

      expect(result.content[0].text).toBe('No matching journal entries found.')
    })

    it('should return message when journal does not exist', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'))

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'search' }, 'memory')

      expect(result.content[0].text).toBe('No journal entries found.')
    })

    it('should error when agent has no workspace', async () => {
      mockGetAgent.mockResolvedValue({ accessible_paths: [] })

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'update', content: 'test' }, 'memory')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('no workspace path')
    })

    it('should handle unknown memory action', async () => {
      const server = createServer()
      const result = await callTool(server, { action: 'unknown' }, 'memory')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Unknown action')
    })
  })

  describe('config tool', () => {
    const telegramChannel = {
      id: 'ch_1',
      type: 'telegram',
      name: 'My Telegram',
      isActive: true,
      config: { type: 'telegram', bot_token: 'tok_123', allowed_chat_ids: ['100'] }
    }

    const agentWithConfig = {
      id: 'agent_1',
      name: 'CherryClaw',
      model: 'claude-sonnet-4-20250514',
      configuration: {
        soul_enabled: true,
        heartbeat_enabled: true
      },
      accessible_paths: ['/workspace/test']
    }

    const agentNoConfig = {
      id: 'agent_1',
      name: 'CherryClaw',
      model: 'claude-sonnet-4-20250514',
      configuration: { soul_enabled: false },
      accessible_paths: ['/workspace/test']
    }

    beforeEach(() => {
      mockSyncAgent.mockResolvedValue(undefined)
      mockListChannels.mockResolvedValue([])
      mockGetChannel.mockResolvedValue(null)
      mockDeleteChannel.mockResolvedValue(undefined)
      mockUpdateChannel.mockResolvedValue(undefined)
    })

    describe('status action', () => {
      it('should return agent status with channels and supported types', async () => {
        mockGetAgent.mockResolvedValue(agentWithConfig)
        mockListChannels.mockResolvedValue([telegramChannel])

        const server = createServer('agent_1')
        const result = await callTool(server, { action: 'status' }, 'config')

        const parsed = JSON.parse(result.content[0].text)
        expect(parsed.agent_id).toBe('agent_1')
        expect(parsed.model).toBe('claude-sonnet-4-20250514')
        expect(parsed.channels).toHaveLength(1)
        expect(parsed.channels[0].type).toBe('telegram')
        expect(parsed.supported_channel_types).toHaveLength(6)
        expect(parsed.supported_channel_types.map((t: any) => t.type)).toEqual([
          'telegram',
          'feishu',
          'qq',
          'wechat',
          'discord',
          'slack'
        ])
        expect(parsed.soul_enabled).toBe(true)
      })

      it('should return empty channels when none configured', async () => {
        mockGetAgent.mockResolvedValue(agentNoConfig)
        mockListChannels.mockResolvedValue([])

        const server = createServer('agent_1')
        const result = await callTool(server, { action: 'status' }, 'config')

        const parsed = JSON.parse(result.content[0].text)
        expect(parsed.channels).toHaveLength(0)
      })

      it('should error when agent not found', async () => {
        mockGetAgent.mockResolvedValue(null)

        const server = createServer('agent_1')
        const result = await callTool(server, { action: 'status' }, 'config')

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('Agent not found')
      })
    })

    describe('add_channel action', () => {
      it('should add a new channel and sync', async () => {
        mockCreateChannel.mockResolvedValue({ id: 'ch_new', type: 'telegram', name: 'Work Bot', isActive: true })

        const server = createServer('agent_1')
        const result = await callTool(
          server,
          {
            action: 'add_channel',
            type: 'telegram',
            name: 'Work Bot',
            config: { bot_token: 'tok_abc', allowed_chat_ids: ['42'] }
          },
          'config'
        )

        expect(result.content[0].text).toContain('Channel added')
        expect(mockCreateChannel).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'telegram',
            name: 'Work Bot',
            agentId: 'agent_1',
            isActive: true
          })
        )
        expect(mockSyncAgent).toHaveBeenCalledWith('agent_1')
      })

      it('should error when type is missing', async () => {
        const server = createServer('agent_1')
        const result = await callTool(server, { action: 'add_channel', name: 'test' }, 'config')

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain("'type' is required")
      })

      it('should error when name is missing', async () => {
        const server = createServer('agent_1')
        const result = await callTool(server, { action: 'add_channel', type: 'telegram' }, 'config')

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain("'name' is required")
      })

      it('should error when unsupported type is given', async () => {
        const server = createServer('agent_1')
        const result = await callTool(server, { action: 'add_channel', type: 'whatsapp', name: 'test' }, 'config')

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('Unknown channel type')
      })

      it('should add a wechat channel and return QR code image', async () => {
        mockCreateChannel.mockResolvedValue({ id: 'ch_wc1', type: 'wechat', name: 'My WeChat', isActive: true })
        mockWaitForQrUrl.mockResolvedValue('https://login.weixin.qq.com/l/abc123')
        mockQRCodeToDataURL.mockResolvedValue('data:image/png;base64,iVBORw0KGgo=')

        const server = createServer('agent_1')
        const result = await callTool(
          server,
          { action: 'add_channel', type: 'wechat', name: 'My WeChat', config: { token_path: '/tmp/wechat' } },
          'config'
        )

        expect(result.content).toHaveLength(2)
        expect(result.content[0].type).toBe('text')
        expect(result.content[0].text).toContain('WeChat channel created')
        expect(result.content[1].type).toBe('image')
        expect(result.content[1].data).toBe('iVBORw0KGgo=')
        expect(result.content[1].mimeType).toBe('image/png')
        expect(mockSyncAgent).toHaveBeenCalledWith('agent_1')
        expect(mockWaitForQrUrl).toHaveBeenCalledWith('agent_1', 'ch_wc1', 30_000)
      })

      it('should clean up orphan channel when wechat QR times out', async () => {
        mockCreateChannel.mockResolvedValue({ id: 'ch_wc2', type: 'wechat', name: 'My WeChat', isActive: true })
        mockWaitForQrUrl.mockRejectedValue(new Error('Timed out waiting for QR code'))

        const server = createServer('agent_1')
        const result = await callTool(
          server,
          { action: 'add_channel', type: 'wechat', name: 'My WeChat', config: { token_path: '/tmp/wechat' } },
          'config'
        )

        expect(result.isError).toBe(true)
        expect(result.content).toHaveLength(1)
        expect(result.content[0].text).toContain('Timed out')
        expect(result.content[0].text).toContain('not saved')
        // Should have deleted the orphan channel
        expect(mockDeleteChannel).toHaveBeenCalledWith('ch_wc2')
        // Should have synced twice: once for add (fire-and-forget), once for orphan cleanup
        expect(mockSyncAgent).toHaveBeenCalledTimes(2)
      })

      it('should error when required config field is missing', async () => {
        const server = createServer('agent_1')
        const result = await callTool(
          server,
          { action: 'add_channel', type: 'telegram', name: 'test', config: {} },
          'config'
        )

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('Missing required config field "bot_token"')
      })
    })

    describe('update_channel action', () => {
      it('should update an existing channel and sync', async () => {
        mockGetChannel.mockResolvedValue(telegramChannel)

        const server = createServer('agent_1')
        const result = await callTool(
          server,
          { action: 'update_channel', channel_id: 'ch_1', enabled: false },
          'config'
        )

        expect(result.content[0].text).toContain('updated and reloaded')
        expect(mockUpdateChannel).toHaveBeenCalledWith('ch_1', expect.objectContaining({ isActive: false }))
        expect(mockSyncAgent).toHaveBeenCalledWith('agent_1')
      })

      it('should error when channel_id is missing', async () => {
        const server = createServer('agent_1')
        const result = await callTool(server, { action: 'update_channel' }, 'config')

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain("'channel_id' is required")
      })

      it('should error when channel not found', async () => {
        mockGetChannel.mockResolvedValue(null)

        const server = createServer('agent_1')
        const result = await callTool(server, { action: 'update_channel', channel_id: 'ch_nonexistent' }, 'config')

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('not found')
      })
    })

    describe('remove_channel action', () => {
      it('should remove a channel and sync', async () => {
        mockGetChannel.mockResolvedValue(telegramChannel)

        const server = createServer('agent_1')
        const result = await callTool(server, { action: 'remove_channel', channel_id: 'ch_1' }, 'config')

        expect(result.content[0].text).toContain('removed')
        expect(result.content[0].text).toContain('My Telegram')
        expect(mockDeleteChannel).toHaveBeenCalledWith('ch_1')
        expect(mockSyncAgent).toHaveBeenCalledWith('agent_1')
      })

      it('should error when channel_id is missing', async () => {
        const server = createServer('agent_1')
        const result = await callTool(server, { action: 'remove_channel' }, 'config')

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain("'channel_id' is required")
      })

      it('should error when channel not found', async () => {
        mockGetChannel.mockResolvedValue(null)

        const server = createServer('agent_1')
        const result = await callTool(server, { action: 'remove_channel', channel_id: 'ch_999' }, 'config')

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('not found')
      })
    })

    it('should handle unknown config action', async () => {
      const server = createServer()
      const result = await callTool(server, { action: 'unknown' }, 'config')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Unknown action')
    })
  })
})
