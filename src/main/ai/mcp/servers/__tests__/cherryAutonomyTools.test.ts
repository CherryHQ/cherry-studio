import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock TaskService before importing CherryAutonomyTools
const mockCreateTask = vi.fn()
const mockListTasks = vi.fn()
const mockDeleteTask = vi.fn()
const mockGetNotifyAdapters = vi.fn()
const mockSendMessage = vi.fn()
const mockSendFile = vi.fn()
const mockGetAgent = vi.fn()
const mockUpdateAgent = vi.fn()
const mockSyncChannel = vi.fn()
const mockDisconnectChannel = vi.fn()
const mockWaitForQrUrl = vi.fn()
const mockQRCodeToDataURL = vi.fn()
const mockListChannels = vi.fn()
const mockCreateChannel = vi.fn()
const mockGetChannel = vi.fn()
const mockUpdateChannel = vi.fn()
const mockDeleteChannel = vi.fn()
const mockGetSession = vi.fn()
const mockListSessions = vi.fn()
const mockAcceptSessionDelivery = vi.fn()
const mockCreateSessionWithDelivery = vi.fn()
const mockListSessionDeliveries = vi.fn()
const mockDispatchSessionDelivery = vi.fn()

// Task reads stay on AgentTaskService; task commands (create / delete) go
// through the AgentJobsService routed via the application mock below.
vi.mock('@data/services/AgentTaskService', () => ({
  agentTaskService: {
    listTasks: mockListTasks
  }
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: {
    getAgent: mockGetAgent,
    updateAgent: mockUpdateAgent
  }
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: {
    getById: mockGetSession,
    listByCursor: mockListSessions
  }
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  AgentSessionDeliveryRoutingError: class extends Error {
    constructor(
      readonly code: string,
      message: string
    ) {
      super(message)
    }
  },
  agentSessionMessageService: {
    acceptSessionDelivery: mockAcceptSessionDelivery,
    createSessionWithDelivery: mockCreateSessionWithDelivery,
    listSessionDeliveries: mockListSessionDeliveries
  }
}))

vi.mock('@main/ai/streamManager', () => ({
  dispatchAcceptedAgentSessionDelivery: mockDispatchSessionDelivery
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    AgentJobsService: {
      createTask: mockCreateTask,
      deleteTask: mockDeleteTask
    },
    ChannelManager: {
      getNotifyAdapters: mockGetNotifyAdapters,
      getAgentAdapters: mockGetNotifyAdapters,
      getAdapterStatuses: vi.fn().mockReturnValue([]),
      syncChannel: mockSyncChannel,
      disconnectChannel: mockDisconnectChannel,
      waitForQrUrl: mockWaitForQrUrl
    }
  } as Parameters<typeof mockApplicationFactory>[0])
})

vi.mock('qrcode', () => ({
  default: { toDataURL: mockQRCodeToDataURL }
}))

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: {
    listChannels: mockListChannels,
    createChannel: mockCreateChannel,
    getChannel: mockGetChannel,
    updateChannel: mockUpdateChannel,
    deleteChannel: mockDeleteChannel
  }
}))

vi.mock('@data/services/AgentChannelWorkflowService', () => ({
  agentChannelWorkflowService: {
    createChannel: mockCreateChannel,
    updateChannel: mockUpdateChannel,
    deleteChannel: mockDeleteChannel
  }
}))

vi.mock('@main/services/MainWindowService', () => ({
  windowService: {
    getMainWindow: vi.fn().mockReturnValue(null)
  }
}))

const { CherryAutonomyTools } = await import('../cherryAutonomyTools')
type CherryAutonomyToolsInstance = InstanceType<typeof CherryAutonomyTools>
const WORKSPACE_SOURCE = { type: 'system' as const }
const WORKSPACE_PATH = '/tmp/cherry-test-workspace'

function createServer(agentId = 'agent_test', workspacePath = WORKSPACE_PATH) {
  // getKnowledgeBaseIds is required on CherryAgentContext but unused by the autonomy tools.
  return new CherryAutonomyTools({
    agentId,
    sessionId: 'session_test',
    workspaceSource: WORKSPACE_SOURCE,
    workspacePath,
    getKnowledgeBaseIds: () => []
  })
}

// Helper mirroring how CherryBuiltinToolsServer's CallTool handler routes autonomy calls
// (returns `any` so assertions can poke content items without narrowing the SDK union).
async function callTool(
  server: CherryAutonomyToolsInstance,
  args: Record<string, unknown>,
  toolName = 'cron'
): Promise<any> {
  return server.call(toolName, args)
}

describe('CherryAutonomyTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockReturnValue({ id: 'session_test', agentId: 'agent_test' })
    mockListSessions.mockReturnValue({ items: [], nextCursor: undefined })
    mockListSessionDeliveries.mockReturnValue([])
  })

  it('should list all tools', () => {
    const server = createServer()
    const tools = server.tools()
    expect(tools).toHaveLength(7)
    expect(tools.map((t) => t.name)).toEqual([
      'cron',
      'notify',
      'config',
      'session_list',
      'session_create',
      'session_inbox',
      'session_send'
    ])
  })

  describe('session tools', () => {
    it('discovers active Session addresses without exposing workspace data', async () => {
      mockListSessions.mockReturnValue({
        items: [
          { id: 'session_test', agentId: 'agent_test', name: 'Current' },
          { id: 'session_b', agentId: 'agent_b', name: 'Build' }
        ]
      })
      mockGetAgent.mockImplementation((id: string) =>
        id === 'agent_test' ? { id, name: 'Agent A' } : { id, name: 'Agent B' }
      )

      const result = await callTool(createServer(), { limit: 10 }, 'session_list')
      const payload = JSON.parse(result.content[0].text)

      expect(payload.sessions).toEqual([
        {
          agentId: 'agent_test',
          agentName: 'Agent A',
          sessionId: 'session_test',
          sessionName: 'Current',
          isCurrent: true
        },
        {
          agentId: 'agent_b',
          agentName: 'Agent B',
          sessionId: 'session_b',
          sessionName: 'Build',
          isCurrent: false
        }
      ])
    })

    it('injects the trusted current identity when sending across Agents', async () => {
      const accepted = {
        id: 'message-1',
        sessionId: 'session_b',
        delivery: { id: 'delivery-1', status: 'accepted' }
      }
      mockAcceptSessionDelivery.mockReturnValue(accepted)
      mockDispatchSessionDelivery.mockResolvedValue('queued')

      const result = await callTool(
        createServer('agent_test'),
        { target_session_id: 'session_b', message: 'Implement this', mode: 'auto' },
        'session_send'
      )

      expect(mockAcceptSessionDelivery).toHaveBeenCalledWith({
        senderAgentId: 'agent_test',
        senderSessionId: 'session_test',
        receiverSessionId: 'session_b',
        content: 'Implement this',
        mode: 'auto'
      })
      expect(mockDispatchSessionDelivery).toHaveBeenCalledWith(accepted)
      expect(JSON.parse(result.content[0].text)).toMatchObject({
        ok: true,
        delivery: { id: 'delivery-1', status: 'queued' }
      })
    })

    it('creates a same-Agent Session with its first message before dispatching it', async () => {
      const message = {
        id: 'message-1',
        sessionId: 'session-new',
        delivery: { id: 'delivery-1', status: 'accepted' }
      }
      mockCreateSessionWithDelivery.mockReturnValue({
        session: { id: 'session-new', agentId: 'agent_test' },
        message
      })
      mockDispatchSessionDelivery.mockResolvedValue('delivering')

      const result = await callTool(createServer(), { message: 'Hello', title: 'English greeting' }, 'session_create')

      expect(mockCreateSessionWithDelivery).toHaveBeenCalledWith({
        senderAgentId: 'agent_test',
        senderSessionId: 'session_test',
        sessionName: 'English greeting',
        workspace: WORKSPACE_SOURCE,
        content: 'Hello'
      })
      expect(mockDispatchSessionDelivery).toHaveBeenCalledWith(message)
      expect(JSON.parse(result.content[0].text)).toMatchObject({
        ok: true,
        agentId: 'agent_test',
        sessionId: 'session-new',
        delivery: { id: 'delivery-1', status: 'delivering' }
      })
    })
  })

  describe('add action', () => {
    it('should create a task with cron schedule', async () => {
      const task = { id: 'task_1', name: 'test', scheduleType: 'cron', scheduleValue: '0 9 * * 1-5' }
      mockCreateTask.mockReturnValue(task)

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
        trigger: { kind: 'cron', expr: '0 9 * * 1-5' },
        workspace: WORKSPACE_SOURCE,
        timeoutMinutes: undefined,
        channelIds: undefined
      })
      expect(result.content[0].text).toContain('Job created')
    })

    it('should create a task with interval schedule', async () => {
      const task = { id: 'task_2', name: 'check', trigger: { kind: 'interval', ms: 30 * 60_000 } }
      mockCreateTask.mockReturnValue(task)

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
        trigger: { kind: 'interval', ms: 30 * 60_000 },
        workspace: WORKSPACE_SOURCE,
        timeoutMinutes: undefined,
        channelIds: undefined
      })
    })

    it('should parse hour+minute durations', async () => {
      mockCreateTask.mockReturnValue({ id: 'task_3' })

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
          trigger: { kind: 'interval', ms: 90 * 60_000 }
        })
      )
    })

    it('should create a one-time task with at', async () => {
      mockCreateTask.mockReturnValue({ id: 'task_4' })

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
          trigger: expect.objectContaining({ kind: 'once' })
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

    it('should subscribe explicit channel_ids owned by this agent', async () => {
      mockGetChannel.mockReturnValue({ id: 'ch_own', agentId: 'agent_1' })
      mockCreateTask.mockReturnValue({ id: 'task_ch' })

      const server = createServer('agent_1')
      await callTool(server, {
        action: 'add',
        name: 'test',
        message: 'test',
        cron: '* * * * *',
        channel_ids: ['ch_own']
      })

      expect(mockCreateTask).toHaveBeenCalledWith('agent_1', expect.objectContaining({ channelIds: ['ch_own'] }))
    })

    it('should reject channel_ids owned by another agent without leaking existence', async () => {
      mockGetChannel.mockReturnValue({ id: 'ch_foreign', agentId: 'agent_2' })

      const server = createServer('agent_1')
      const result = await callTool(server, {
        action: 'add',
        name: 'test',
        message: 'test',
        cron: '* * * * *',
        channel_ids: ['ch_foreign']
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Channel "ch_foreign" not found')
      expect(mockCreateTask).not.toHaveBeenCalled()
    })
  })

  describe('list action', () => {
    it('should list tasks', async () => {
      const tasks = [{ id: 'task_1', name: 'Job 1' }]
      mockListTasks.mockReturnValue({ tasks, total: 1 })

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'list' })

      expect(mockListTasks).toHaveBeenCalledWith('agent_1', { limit: 100 })
      expect(result.content[0].text).toContain('Job 1')
    })

    it('should handle empty task list', async () => {
      mockListTasks.mockReturnValue({ tasks: [], total: 0 })

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
        sendMessage: mockSendMessage,
        sendFile: mockSendFile
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
      expect(result.content[0].text).toContain('Message sent to 2 chat(s)')
    })

    it('should filter by channel_id when provided', async () => {
      mockSendMessage.mockResolvedValue(undefined)
      mockGetNotifyAdapters.mockReturnValue([makeAdapter('ch1', ['100']), makeAdapter('ch2', ['200'])])

      const server = createServer('agent_1')
      const result = await callTool(server, { message: 'Targeted', channel_id: 'ch2' }, 'notify')

      expect(mockSendMessage).toHaveBeenCalledTimes(1)
      expect(mockSendMessage).toHaveBeenCalledWith('200', 'Targeted')
      expect(result.content[0].text).toContain('Message sent to 1 chat(s)')
    })

    it('should return message when no notify channels found', async () => {
      mockGetNotifyAdapters.mockReturnValue([])

      const server = createServer('agent_1')
      const result = await callTool(server, { message: 'Hello' }, 'notify')

      expect(result.content[0].text).toContain('No connected channels found')
      expect(mockSendMessage).not.toHaveBeenCalled()
    })

    it('should send to no one when adapters have empty notifyChatIds', async () => {
      mockGetNotifyAdapters.mockReturnValue([makeAdapter('ch1', [])])

      const server = createServer('agent_1')
      const result = await callTool(server, { message: 'Hello' }, 'notify')

      expect(mockSendMessage).not.toHaveBeenCalled()
      expect(mockSendFile).not.toHaveBeenCalled()
      expect(result.content[0].text).toContain('Message sent to 0 chat(s)')
      // No failed attempts (nobody configured) is an informational result, not an error.
      expect(result.isError).toBeFalsy()
    })

    it('should error when both message and file_path are missing', async () => {
      const server = createServer()
      const result = await callTool(server, {}, 'notify')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("Provide 'message', 'file_path', or both")
    })

    it('should error when message and file_path are whitespace only', async () => {
      const server = createServer()
      const result = await callTool(server, { message: '   ', file_path: '   ' }, 'notify')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("Provide 'message', 'file_path', or both")
    })

    it('should report partial failures', async () => {
      mockSendMessage.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('rate limited'))
      mockGetNotifyAdapters.mockReturnValue([makeAdapter('ch1', ['100', '200'])])

      const server = createServer('agent_1')
      const result = await callTool(server, { message: 'Test' }, 'notify')

      expect(result.content[0].text).toContain('Message sent to 1 chat(s)')
      expect(result.content[0].text).toContain('rate limited')
      // Partial success (reached at least one chat) is not a failed call.
      expect(result.isError).toBeFalsy()
    })

    it('should mark isError when the message reaches no one', async () => {
      mockSendMessage.mockRejectedValue(new Error('rate limited'))
      mockGetNotifyAdapters.mockReturnValue([makeAdapter('ch1', ['100'])])

      const server = createServer('agent_1')
      const result = await callTool(server, { message: 'Test' }, 'notify')

      expect(result.content[0].text).toContain('Message sent to 0 chat(s)')
      expect(result.isError).toBe(true)
    })

    it('should sanitize the message before sending', async () => {
      mockSendMessage.mockResolvedValue(undefined)
      mockGetNotifyAdapters.mockReturnValue([makeAdapter('ch1', ['100'])])

      const server = createServer('agent_1')
      await callTool(server, { message: 'token sk-ant-api03-SECRETSECRETSECRET' }, 'notify')

      const sent = mockSendMessage.mock.calls[0][1] as string
      expect(sent).toContain('[REDACTED]')
      expect(sent).not.toContain('SECRETSECRETSECRET')
    })

    describe('file forwarding', () => {
      let workspace: string
      let outside: string

      beforeEach(async () => {
        workspace = await mkdtemp(path.join(tmpdir(), 'cherry-notify-'))
        outside = await mkdtemp(path.join(tmpdir(), 'cherry-outside-'))
      })

      afterEach(async () => {
        await rm(workspace, { recursive: true, force: true })
        await rm(outside, { recursive: true, force: true })
      })

      it('should forward a workspace file to each chat', async () => {
        mockSendFile.mockResolvedValue(undefined)
        mockGetNotifyAdapters.mockReturnValue([makeAdapter('ch1', ['100', '200'])])
        await writeFile(path.join(workspace, 'report.txt'), 'hello')

        const server = createServer('agent_1', workspace)
        const result = await callTool(server, { file_path: 'report.txt' }, 'notify')

        expect(mockSendFile).toHaveBeenCalledTimes(2)
        const [chatId, file] = mockSendFile.mock.calls[0]
        expect(chatId).toBe('100')
        expect(file.filename).toBe('report.txt')
        expect(file.media_type).toBe('text/plain')
        expect(Buffer.from(file.data, 'base64').toString()).toBe('hello')
        expect(result.content[0].text).toContain('File "report.txt" sent to 2 chat(s)')
      })

      it('should send both message and file independently', async () => {
        mockSendMessage.mockResolvedValue(undefined)
        mockSendFile.mockResolvedValue(undefined)
        mockGetNotifyAdapters.mockReturnValue([makeAdapter('ch1', ['100'])])
        await writeFile(path.join(workspace, 'a.txt'), 'x')

        const server = createServer('agent_1', workspace)
        const result = await callTool(server, { message: 'see attached', file_path: 'a.txt' }, 'notify')

        expect(mockSendMessage).toHaveBeenCalledWith('100', 'see attached')
        expect(mockSendFile).toHaveBeenCalledTimes(1)
        expect(result.content[0].text).toContain('Message sent to 1 chat(s)')
        expect(result.content[0].text).toContain('File "a.txt" sent to 1 chat(s)')
      })

      it('should mark isError when the message lands but the file reaches no one', async () => {
        mockSendMessage.mockResolvedValue(undefined)
        mockSendFile.mockRejectedValue(new Error('unsupported'))
        mockGetNotifyAdapters.mockReturnValue([makeAdapter('ch1', ['100'])])
        await writeFile(path.join(workspace, 'a.txt'), 'x')

        const server = createServer('agent_1', workspace)
        const result = await callTool(server, { message: 'see attached', file_path: 'a.txt' }, 'notify')

        expect(result.content[0].text).toContain('Message sent to 1 chat(s)')
        expect(result.content[0].text).toContain('File "a.txt" sent to 0 chat(s)')
        // A requested file that reached nobody is a failed delivery even though the message got through.
        expect(result.isError).toBe(true)
      })

      it('should reject a path outside the workspace before dispatch', async () => {
        mockGetNotifyAdapters.mockReturnValue([makeAdapter('ch1', ['100'])])
        // Use a real file in a sibling temp dir (not a fixed OS path like /etc/passwd)
        // so the assertion is deterministic across platforms and CI sandboxes.
        const secret = path.join(outside, 'secret.txt')
        await writeFile(secret, 'top secret')
        const escape = path.relative(workspace, secret)

        const server = createServer('agent_1', workspace)
        const result = await callTool(server, { file_path: escape }, 'notify')

        expect(result.isError).toBe(true)
        expect(mockSendFile).not.toHaveBeenCalled()
      })

      it('should error when the file does not exist', async () => {
        mockGetNotifyAdapters.mockReturnValue([makeAdapter('ch1', ['100'])])

        const server = createServer('agent_1', workspace)
        const result = await callTool(server, { file_path: 'missing.txt' }, 'notify')

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('not found')
        expect(mockSendFile).not.toHaveBeenCalled()
      })

      it('should tally a per-chat sendFile failure and mark the call as failed', async () => {
        mockSendFile.mockRejectedValue(new Error('unsupported'))
        mockGetNotifyAdapters.mockReturnValue([makeAdapter('ch1', ['100'])])
        await writeFile(path.join(workspace, 'a.txt'), 'x')

        const server = createServer('agent_1', workspace)
        const result = await callTool(server, { file_path: 'a.txt' }, 'notify')

        expect(result.content[0].text).toContain('File "a.txt" sent to 0 chat(s)')
        expect(result.content[0].text).toContain('unsupported')
        // The file reached nobody because every attempt failed — the agent must see an error.
        expect(result.isError).toBe(true)
      })

      it('should not mark isError when the file reaches at least one chat', async () => {
        mockSendFile.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('too big'))
        mockGetNotifyAdapters.mockReturnValue([makeAdapter('ch1', ['100', '200'])])
        await writeFile(path.join(workspace, 'a.txt'), 'x')

        const server = createServer('agent_1', workspace)
        const result = await callTool(server, { file_path: 'a.txt' }, 'notify')

        expect(result.content[0].text).toContain('File "a.txt" sent to 1 chat(s)')
        expect(result.isError).toBeFalsy()
      })
    })
  })

  describe('config tool', () => {
    const telegramChannel = {
      id: 'ch_1',
      type: 'telegram',
      name: 'My Telegram',
      agentId: 'agent_1',
      isActive: true,
      config: { type: 'telegram', bot_token: 'tok_123', allowed_chat_ids: ['100'] }
    }

    const feishuChannel = {
      id: 'ch_feishu',
      type: 'feishu',
      name: 'My Feishu',
      agentId: 'agent_1',
      isActive: true,
      config: {
        app_id: '',
        app_secret: '',
        encrypt_key: '',
        verification_token: '',
        allowed_chat_ids: [],
        domain: 'feishu'
      }
    }

    const agentWithConfig = {
      id: 'agent_1',
      name: 'Test Agent',
      model: 'claude-sonnet-4-20250514',
      configuration: {
        heartbeat_enabled: true
      }
    }

    const agentNoConfig = {
      id: 'agent_1',
      name: 'Test Agent',
      model: 'claude-sonnet-4-20250514',
      configuration: {}
    }

    beforeEach(() => {
      mockSyncChannel.mockResolvedValue(undefined)
      mockDisconnectChannel.mockResolvedValue(undefined)
      mockListChannels.mockReturnValue([])
      mockGetChannel.mockReturnValue(null)
      mockDeleteChannel.mockResolvedValue(undefined)
      mockUpdateChannel.mockResolvedValue(undefined)
    })

    describe('status action', () => {
      it('should return agent status with channels and supported types', async () => {
        mockGetAgent.mockReturnValue(agentWithConfig)
        mockListChannels.mockReturnValue([telegramChannel])

        const server = createServer('agent_1')
        const result = await callTool(server, { action: 'status' }, 'config')

        const parsed = JSON.parse(result.content[0].text)
        expect(parsed.agentId).toBe('agent_1')
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
        expect(parsed.soul_enabled).toBeUndefined()
        expect(parsed.heartbeat_enabled).toBe(true)
      })

      it('should return empty channels when none configured', async () => {
        mockGetAgent.mockReturnValue(agentNoConfig)
        mockListChannels.mockReturnValue([])

        const server = createServer('agent_1')
        const result = await callTool(server, { action: 'status' }, 'config')

        const parsed = JSON.parse(result.content[0].text)
        expect(parsed.channels).toHaveLength(0)
      })

      it('should error when agent not found', async () => {
        mockGetAgent.mockReturnValue(null)

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
            workspace: WORKSPACE_SOURCE,
            isActive: true
          })
        )
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

      it('should reject a non-object channel config', async () => {
        const server = createServer('agent_1')
        const result = await callTool(
          server,
          { action: 'add_channel', type: 'telegram', name: 'Work Bot', config: 'invalid' },
          'config'
        )

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain("'config' must be an object")
        expect(mockCreateChannel).not.toHaveBeenCalled()
      })

      it('should reject a non-string authentication mode', async () => {
        const server = createServer('agent_1')
        const result = await callTool(
          server,
          { action: 'add_channel', type: 'feishu', name: 'My Feishu', auth_mode: true },
          'config'
        )

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain("'auth_mode' must be a string")
        expect(mockCreateChannel).not.toHaveBeenCalled()
      })

      it('should error when unsupported type is given', async () => {
        const server = createServer('agent_1')
        const result = await callTool(server, { action: 'add_channel', type: 'whatsapp', name: 'test' }, 'config')

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('Unknown channel type')
      })

      it('should add a wechat channel without a token path and return QR code image', async () => {
        mockCreateChannel.mockReturnValue({ id: 'ch_wc1', type: 'wechat', name: 'My WeChat', isActive: true })
        mockWaitForQrUrl.mockResolvedValue('https://login.weixin.qq.com/l/abc123')
        mockQRCodeToDataURL.mockResolvedValue('data:image/png;base64,iVBORw0KGgo=')

        const server = createServer('agent_1')
        const result = await callTool(
          server,
          {
            action: 'add_channel',
            type: 'wechat',
            name: 'My WeChat',
            auth_mode: 'qr',
            config: { token_path: '/tmp/existing-token.json', allowed_chat_ids: ['chat-1'] }
          },
          'config'
        )

        expect(mockCreateChannel).toHaveBeenCalledWith(
          expect.objectContaining({
            config: { type: 'wechat', token_path: '', allowed_chat_ids: ['chat-1'] }
          })
        )
        expect(result.content).toHaveLength(2)
        expect(result.content[0].type).toBe('text')
        expect(result.content[0].text).toContain('WeChat channel created')
        expect(result.content[1].type).toBe('image')
        expect(result.content[1].data).toBe('iVBORw0KGgo=')
        expect(result.content[1].mimeType).toBe('image/png')
        expect(mockSyncChannel).toHaveBeenCalledWith('ch_wc1')
        expect(mockWaitForQrUrl).toHaveBeenCalledWith('agent_1', 'ch_wc1', 30_000)
      })

      it('should add a feishu channel without app credentials and return QR code image', async () => {
        mockCreateChannel.mockReturnValue({ id: 'ch_fs1', type: 'feishu', name: 'My Feishu', isActive: true })
        mockWaitForQrUrl.mockResolvedValue('https://accounts.feishu.cn/device/abc123')
        mockQRCodeToDataURL.mockResolvedValue('data:image/png;base64,iVBORw0KGgo=')

        const server = createServer('agent_1')
        const result = await callTool(
          server,
          {
            action: 'add_channel',
            type: 'feishu',
            name: 'My Feishu',
            auth_mode: 'qr',
            config: {
              app_id: 'old-app-id',
              app_secret: 'old-app-secret',
              encrypt_key: 'old-encrypt-key',
              verification_token: 'old-verification-token',
              allowed_chat_ids: ['chat-1'],
              domain: 'lark'
            }
          },
          'config'
        )

        expect(mockCreateChannel).toHaveBeenCalledWith(
          expect.objectContaining({
            config: {
              type: 'feishu',
              app_id: '',
              app_secret: '',
              encrypt_key: '',
              verification_token: '',
              allowed_chat_ids: ['chat-1'],
              domain: 'lark'
            }
          })
        )
        expect(result.content).toHaveLength(2)
        expect(result.content[0].text).toContain('Feishu channel created')
        expect(result.content[1]).toMatchObject({
          type: 'image',
          data: 'iVBORw0KGgo=',
          mimeType: 'image/png'
        })
        expect(mockSyncChannel).toHaveBeenCalledWith('ch_fs1')
        expect(mockWaitForQrUrl).toHaveBeenCalledWith('agent_1', 'ch_fs1', 30_000)
      })

      it('should allow adding another Feishu channel when one already exists', async () => {
        mockListChannels.mockReturnValue([
          {
            ...feishuChannel,
            id: 'ch_existing',
            config: { ...feishuChannel.config, app_id: 'app-id', app_secret: 'app-secret' }
          }
        ])
        mockCreateChannel.mockReturnValue({ id: 'ch_fs2', type: 'feishu', name: 'Second Feishu', isActive: true })
        mockWaitForQrUrl.mockResolvedValue('https://accounts.feishu.cn/device/abc123')
        mockQRCodeToDataURL.mockResolvedValue('data:image/png;base64,iVBORw0KGgo=')

        const server = createServer('agent_1')
        const result = await callTool(
          server,
          { action: 'add_channel', type: 'feishu', name: 'Second Feishu', auth_mode: 'qr' },
          'config'
        )

        expect(mockCreateChannel).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'feishu',
            name: 'Second Feishu',
            agentId: 'agent_1'
          })
        )
        expect(mockWaitForQrUrl).toHaveBeenCalledWith('agent_1', 'ch_fs2', 30_000)
        expect(result.content.filter((item: { type: string }) => item.type === 'image')).toHaveLength(1)
      })

      it('should reuse one unverified Feishu channel without losing the new setup options', async () => {
        const existingChannel = { ...feishuChannel, id: 'ch_existing', isActive: false }
        const updatedChannel = {
          ...existingChannel,
          name: 'Updated Feishu',
          isActive: true,
          config: {
            ...existingChannel.config,
            allowed_chat_ids: ['chat-1'],
            domain: 'lark'
          }
        }
        mockListChannels.mockReturnValue([
          {
            ...feishuChannel,
            id: 'ch_verified',
            config: { ...feishuChannel.config, app_id: 'app-id', app_secret: 'app-secret' }
          },
          existingChannel
        ])
        mockGetChannel.mockReturnValue(updatedChannel)
        mockWaitForQrUrl.mockResolvedValue('https://accounts.larksuite.com/device/abc123')
        mockQRCodeToDataURL.mockResolvedValue('data:image/png;base64,iVBORw0KGgo=')

        const server = createServer('agent_1')
        const result = await callTool(
          server,
          {
            action: 'add_channel',
            type: 'feishu',
            name: 'Updated Feishu',
            auth_mode: 'qr',
            config: {
              app_id: 'stale-app-id',
              app_secret: 'stale-app-secret',
              allowed_chat_ids: ['chat-1'],
              domain: 'lark'
            }
          },
          'config'
        )

        expect(mockCreateChannel).not.toHaveBeenCalled()
        expect(mockUpdateChannel).toHaveBeenCalledWith('ch_existing', {
          name: 'Updated Feishu',
          config: {
            type: 'feishu',
            app_id: '',
            app_secret: '',
            encrypt_key: '',
            verification_token: '',
            allowed_chat_ids: ['chat-1'],
            domain: 'lark'
          },
          isActive: true
        })
        expect(mockWaitForQrUrl).toHaveBeenCalledWith('agent_1', 'ch_existing', 30_000)
        expect(result.content.filter((item: { type: string }) => item.type === 'image')).toHaveLength(1)
      })

      it('should require an explicit channel when multiple unverified Feishu channels exist', async () => {
        mockListChannels.mockReturnValue([
          { ...feishuChannel, id: 'ch_pending_1' },
          { ...feishuChannel, id: 'ch_pending_2' },
          {
            ...feishuChannel,
            id: 'ch_verified',
            config: { ...feishuChannel.config, app_id: 'app-id', app_secret: 'app-secret' }
          }
        ])

        const server = createServer('agent_1')
        const result = await callTool(
          server,
          { action: 'add_channel', type: 'feishu', name: 'My Feishu', auth_mode: 'qr' },
          'config'
        )

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('Multiple unverified Feishu channels already exist')
        expect(result.content[0].text).toContain('reconnect_channel')
        expect(mockCreateChannel).not.toHaveBeenCalled()
        expect(mockWaitForQrUrl).not.toHaveBeenCalled()
      })

      it('should clean up orphan channel when wechat QR times out', async () => {
        mockCreateChannel.mockReturnValue({ id: 'ch_wc2', type: 'wechat', name: 'My WeChat', isActive: true })
        mockWaitForQrUrl.mockRejectedValue(new Error('Timed out waiting for QR code'))

        const server = createServer('agent_1')
        const result = await callTool(
          server,
          { action: 'add_channel', type: 'wechat', name: 'My WeChat', auth_mode: 'qr' },
          'config'
        )

        expect(result.isError).toBe(true)
        expect(result.content).toHaveLength(1)
        expect(result.content[0].text).toContain('Timed out')
        expect(result.content[0].text).toContain('not saved')
        // Should have deleted the orphan channel
        expect(mockDeleteChannel).toHaveBeenCalledWith('ch_wc2')
        // syncChannel runs once for the initial fire-and-forget add.
        expect(mockSyncChannel).toHaveBeenCalledTimes(1)
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

      it('should keep credential fields required unless QR authentication is explicit', async () => {
        const server = createServer('agent_1')
        const result = await callTool(
          server,
          { action: 'add_channel', type: 'feishu', name: 'My Feishu', config: {} },
          'config'
        )

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('Missing required config field "app_id"')
        expect(mockCreateChannel).not.toHaveBeenCalled()
      })

      it('should reject QR authentication for channels that do not support it', async () => {
        const server = createServer('agent_1')
        const result = await callTool(
          server,
          { action: 'add_channel', type: 'telegram', name: 'Work Bot', auth_mode: 'qr' },
          'config'
        )

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('QR authentication is not supported for telegram')
      })

      it('should reject QR authentication for a disabled channel', async () => {
        const server = createServer('agent_1')
        const result = await callTool(
          server,
          { action: 'add_channel', type: 'wechat', name: 'My WeChat', auth_mode: 'qr', enabled: false },
          'config'
        )

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('QR authentication requires the channel to be enabled')
        expect(mockCreateChannel).not.toHaveBeenCalled()
        expect(mockWaitForQrUrl).not.toHaveBeenCalled()
      })
    })

    describe('update_channel action', () => {
      it('should update an existing channel and sync', async () => {
        mockGetChannel.mockReturnValue(telegramChannel)

        const server = createServer('agent_1')
        const result = await callTool(
          server,
          { action: 'update_channel', channel_id: 'ch_1', enabled: false },
          'config'
        )

        expect(result.content[0].text).toContain('updated and reloaded')
        expect(mockUpdateChannel).toHaveBeenCalledWith('ch_1', expect.objectContaining({ isActive: false }))
      })

      it('should error when channel_id is missing', async () => {
        const server = createServer('agent_1')
        const result = await callTool(server, { action: 'update_channel' }, 'config')

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain("'channel_id' is required")
      })

      it('should error when channel not found', async () => {
        mockGetChannel.mockReturnValue(null)

        const server = createServer('agent_1')
        const result = await callTool(server, { action: 'update_channel', channel_id: 'ch_nonexistent' }, 'config')

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('not found')
      })

      it('should hide channels owned by another agent', async () => {
        mockGetChannel.mockReturnValue({ ...telegramChannel, agentId: 'agent_2' })

        const server = createServer('agent_1')
        const result = await callTool(
          server,
          { action: 'update_channel', channel_id: 'ch_1', enabled: false },
          'config'
        )

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('Channel "ch_1" not found')
        expect(mockUpdateChannel).not.toHaveBeenCalled()
      })
    })

    describe('remove_channel action', () => {
      it('should remove a channel and sync', async () => {
        mockGetChannel.mockReturnValue(telegramChannel)

        const server = createServer('agent_1')
        const result = await callTool(server, { action: 'remove_channel', channel_id: 'ch_1' }, 'config')

        expect(result.content[0].text).toContain('removed')
        expect(result.content[0].text).toContain('My Telegram')
        expect(mockDeleteChannel).toHaveBeenCalledWith('ch_1')
      })

      it('should error when channel_id is missing', async () => {
        const server = createServer('agent_1')
        const result = await callTool(server, { action: 'remove_channel' }, 'config')

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain("'channel_id' is required")
      })

      it('should error when channel not found', async () => {
        mockGetChannel.mockReturnValue(null)

        const server = createServer('agent_1')
        const result = await callTool(server, { action: 'remove_channel', channel_id: 'ch_999' }, 'config')

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('not found')
      })

      it('should hide channels owned by another agent', async () => {
        mockGetChannel.mockReturnValue({ ...telegramChannel, agentId: 'agent_2' })

        const server = createServer('agent_1')
        const result = await callTool(server, { action: 'remove_channel', channel_id: 'ch_1' }, 'config')

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('Channel "ch_1" not found')
        expect(mockDeleteChannel).not.toHaveBeenCalled()
      })
    })

    describe('reconnect_channel action', () => {
      it('should reconnect an existing non-QR channel', async () => {
        mockGetChannel.mockReturnValue(telegramChannel)

        const server = createServer('agent_1')
        const result = await callTool(server, { action: 'reconnect_channel', channel_id: 'ch_1' }, 'config')

        expect(result.content[0].text).toContain('reconnected')
        expect(mockSyncChannel).toHaveBeenCalledWith('ch_1')
      })

      it('should error when channel_id is missing', async () => {
        const server = createServer('agent_1')
        const result = await callTool(server, { action: 'reconnect_channel' }, 'config')

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain("'channel_id' is required")
      })

      it('should error when channel not found', async () => {
        mockGetChannel.mockReturnValue(null)

        const server = createServer('agent_1')
        const result = await callTool(server, { action: 'reconnect_channel', channel_id: 'ch_999' }, 'config')

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('not found')
      })

      it('should hide channels owned by another agent', async () => {
        mockGetChannel.mockReturnValue({ ...telegramChannel, agentId: 'agent_2' })

        const server = createServer('agent_1')
        const result = await callTool(server, { action: 'reconnect_channel', channel_id: 'ch_1' }, 'config')

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('Channel "ch_1" not found')
        expect(mockSyncChannel).not.toHaveBeenCalled()
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
