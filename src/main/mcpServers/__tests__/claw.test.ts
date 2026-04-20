import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock TaskService before importing ClawServer
const mockCreateTask = vi.fn()
const mockListTasks = vi.fn()
const mockDeleteTask = vi.fn()
const mockGetNotifyAdapters = vi.fn()
const mockSendMessage = vi.fn()
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
    syncChannel: mockSyncChannel,
    disconnectChannel: mockDisconnectChannel,
    waitForQrUrl: mockWaitForQrUrl
  }
}))

vi.mock('qrcode', () => ({
  default: { toDataURL: mockQRCodeToDataURL }
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
    expect(result.tools).toHaveLength(3)
    expect(result.tools.map((t: any) => t.name)).toEqual(['cron', 'notify', 'config'])
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

    it('should error when no payload is provided', async () => {
      const server = createServer()
      const result = await callTool(server, {}, 'notify')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain(
        "At least one of 'message', 'image_path', 'image_base64', or 'file_path'"
      )
    })

    it('should report partial failures', async () => {
      mockSendMessage.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('rate limited'))
      mockGetNotifyAdapters.mockReturnValue([makeAdapter('ch1', ['100', '200'])])

      const server = createServer('agent_1')
      const result = await callTool(server, { message: 'Test' }, 'notify')

      expect(result.content[0].text).toContain('1 chat(s)')
      expect(result.content[0].text).toContain('rate limited')
    })

    it('should send image via sendMedia when image_base64 is provided', async () => {
      const mockSendMedia = vi.fn().mockResolvedValue(undefined)
      const adapter = {
        channelId: 'wx1',
        notifyChatIds: ['wxid_abc'],
        sendMessage: mockSendMessage,
        sendMedia: mockSendMedia
      }
      mockGetNotifyAdapters.mockReturnValue([adapter])

      const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      const server = createServer('agent_1')
      const result = await callTool(server, { image_base64: pngBytes.toString('base64') }, 'notify')

      expect(mockSendMedia).toHaveBeenCalledTimes(1)
      expect(mockSendMedia).toHaveBeenCalledWith('wxid_abc', expect.any(Buffer), 'image')
      const [, bufferArg] = mockSendMedia.mock.calls[0]
      expect((bufferArg as Buffer).equals(pngBytes)).toBe(true)
      expect(mockSendMessage).not.toHaveBeenCalled()
      expect(result.content[0].text).toContain('Image sent to 1 chat(s)')
    })

    it('should reject when both image_path and image_base64 are supplied', async () => {
      mockGetNotifyAdapters.mockReturnValue([])

      const server = createServer('agent_1')
      const result = await callTool(
        server,
        { image_path: '/tmp/img.png', image_base64: Buffer.from('x').toString('base64') },
        'notify'
      )

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("only one of 'image_path' or 'image_base64'")
    })

    it('should require absolute path for image_path', async () => {
      mockGetNotifyAdapters.mockReturnValue([])

      const server = createServer('agent_1')
      const result = await callTool(server, { image_path: 'relative/img.png' }, 'notify')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('absolute path')
    })

    it('should send both image and message when provided together', async () => {
      const mockSendMedia = vi.fn().mockResolvedValue(undefined)
      const adapter = {
        channelId: 'wx1',
        notifyChatIds: ['wxid_abc'],
        sendMessage: mockSendMessage,
        sendMedia: mockSendMedia
      }
      mockSendMessage.mockResolvedValue(undefined)
      mockGetNotifyAdapters.mockReturnValue([adapter])

      const server = createServer('agent_1')
      const result = await callTool(
        server,
        { message: 'here is the pic', image_base64: Buffer.from('abc').toString('base64') },
        'notify'
      )

      expect(mockSendMedia).toHaveBeenCalledTimes(1)
      expect(mockSendMessage).toHaveBeenCalledWith('wxid_abc', 'here is the pic')
      expect(result.content[0].text).toContain('Notification sent to 1 chat(s)')
      expect(result.content[0].text).toContain('Image sent to 1 chat(s)')
    })

    it('should send file via sendMedia with basename when file_path is provided', async () => {
      const fs = await import('node:fs/promises')
      const nodePath = await import('node:path')

      const tmpFile = `/tmp/cherry-notify-test-${Date.now()}.pdf`
      const fileBytes = Buffer.from('%PDF-1.4\n%fake pdf\n')
      await fs.writeFile(tmpFile, fileBytes)

      try {
        const mockSendMedia = vi.fn().mockResolvedValue(undefined)
        const adapter = {
          channelId: 'wx1',
          notifyChatIds: ['wxid_abc'],
          sendMessage: mockSendMessage,
          sendMedia: mockSendMedia
        }
        mockGetNotifyAdapters.mockReturnValue([adapter])

        const server = createServer('agent_1')
        const result = await callTool(server, { file_path: tmpFile }, 'notify')

        expect(mockSendMedia).toHaveBeenCalledTimes(1)
        const [chatId, bufferArg, mediaType, fileName] = mockSendMedia.mock.calls[0]
        expect(chatId).toBe('wxid_abc')
        expect((bufferArg as Buffer).equals(fileBytes)).toBe(true)
        expect(mediaType).toBe('file')
        expect(fileName).toBe(nodePath.basename(tmpFile))
        expect(result.content[0].text).toContain('File sent to 1 chat(s)')
      } finally {
        await fs.rm(tmpFile, { force: true })
      }
    })

    it('should require absolute path for file_path', async () => {
      mockGetNotifyAdapters.mockReturnValue([])

      const server = createServer('agent_1')
      const result = await callTool(server, { file_path: 'relative/doc.pdf' }, 'notify')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('absolute path')
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
      mockSyncChannel.mockResolvedValue(undefined)
      mockDisconnectChannel.mockResolvedValue(undefined)
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
        expect(mockSyncChannel).toHaveBeenCalledWith('ch_new')
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
        expect(mockSyncChannel).toHaveBeenCalledWith('ch_wc1')
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
        // syncChannel for the initial add (fire-and-forget), disconnectChannel for orphan cleanup
        expect(mockSyncChannel).toHaveBeenCalledTimes(1)
        expect(mockDisconnectChannel).toHaveBeenCalledWith('ch_wc2')
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
        expect(mockSyncChannel).toHaveBeenCalledWith('ch_1')
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
        expect(mockDisconnectChannel).toHaveBeenCalledWith('ch_1')
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
