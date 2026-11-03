import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { Client } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import { setupTestDatabase } from '@test-helpers/db'
import { connectMcpTestClient } from '@test-helpers/mcp/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentChannelTable } from '@data/db/schemas/agentChannel'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { jobScheduleTable } from '@data/db/schemas/job'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentChannelService } from '@data/services/AgentChannelService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { registerAutonomyTools } from '@main/ai/mcp/servers/cherryAutonomyTools'
import { type NotifyChannel, resolveAgentNotificationContext } from '@main/ai/runtime/agentMcpServers'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import { AgentChannelConfigSchemasByType } from '@shared/data/api/schemas/agentChannels'

import type { StreamListener } from '../../types'
import { AgentChatContextProvider } from '../AgentChatContextProvider'
import type { MainDispatchRequest } from '../dispatch'

const runtime = vi.hoisted(() => ({
  grant: undefined as readonly NotifyChannel[] | undefined,
  beginTurn: vi.fn(),
  getAgentAdapters: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    AgentSessionRuntimeService: {
      assertSessionWritable: vi.fn(),
      prepareBranch: vi.fn().mockResolvedValue(undefined),
      isSessionBusy: () => false,
      beginTurn: runtime.beginTurn,
      getTurnTrustedNotifyChannels: () => runtime.grant
    },
    ChannelManager: { getAgentAdapters: runtime.getAgentAdapters }
  } as Parameters<typeof mockApplicationFactory>[0])
})
vi.mock('@main/services/TopicNamingService', () => ({
  topicNamingService: { maybeRenameAgentSessionFromFirstUserMessage: vi.fn() }
}))

const subscriber: StreamListener = {
  id: 'notify-integration',
  onChunk: () => {},
  onDone: () => {},
  onPaused: () => {},
  onError: () => {},
  isAlive: () => true
}

// Catch lost follow-up grants through real admission, MCP registration, and distinct adapter sinks.
describe('task scheduled-admission → follow-up notification delivery', () => {
  const dbh = setupTestDatabase()
  const provider = new AgentChatContextProvider()
  let workspace: string
  const clients: Client[] = []
  const taskSendFile = vi.fn()
  const otherSendFile = vi.fn()

  beforeEach(async () => {
    vi.clearAllMocks()
    workspace = await mkdtemp(path.join(tmpdir(), 'task-followup-notify-'))
    runtime.grant = undefined
    runtime.beginTurn.mockImplementation((input: { trustedNotifyChannels?: readonly NotifyChannel[] }) => {
      // The resolver sees only the grant admitted by the real provider for this turn.
      runtime.grant = input.trustedNotifyChannels
      return { turnId: 'integration-turn', listeners: [] }
    })
    vi.mocked(application.get('DbService').withWriteTx).mockImplementation((fn) => dbh.db.transaction(fn))
    runtimeDriverRegistry.clearForTest()
    runtimeDriverRegistry.register({
      type: 'claude-code',
      capabilities: ['agent-session'],
      connect: vi.fn(),
      validateSession: async () => {},
      listAvailableTools: async () => []
    })
    dbh.db.insert(userProviderTable).values({ providerId: 'anthropic', name: 'Anthropic', orderKey: 'a0' }).run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'anthropic::claude-sonnet',
        providerId: 'anthropic',
        modelId: 'claude-sonnet',
        name: 'Claude Sonnet',
        capabilities: [],
        supportsStreaming: true,
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(agentTable)
      .values({
        id: 'agent-task',
        type: 'claude-code',
        name: 'Task agent',
        instructions: '',
        model: 'anthropic::claude-sonnet',
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({
        id: 'workspace-task',
        type: 'user',
        path: workspace,
        name: 'Task workspace',
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values([
        { id: 'session-task', agentId: 'agent-task', name: 'Task', workspaceId: 'workspace-task', orderKey: 'a0' },
        { id: 'session-unbound', agentId: 'agent-task', name: 'Unbound', workspaceId: 'workspace-task', orderKey: 'a1' }
      ])
      .run()
    dbh.db
      .insert(jobScheduleTable)
      .values({
        id: 'schedule-task',
        type: 'agent.task',
        name: 'Task',
        trigger: { kind: 'interval', ms: 60_000 },
        jobInputTemplate: {
          agentId: 'agent-task',
          prompt: 'Send report',
          timeoutMinutes: 0,
          workspace: { type: 'system' }
        },
        catchUpPolicy: { kind: 'skip-missed' },
        metadata: { reuse: { enabled: true, revision: 0 } }
      })
      .run()
    dbh.db.transaction((tx) =>
      agentSessionService.bindTaskScheduleTx(tx, {
        sessionId: 'session-task',
        taskScheduleId: 'schedule-task',
        expectedAgentId: 'agent-task'
      })
    )
    dbh.db
      .insert(agentChannelTable)
      .values([
        {
          id: 'channel-task',
          agentId: 'agent-task',
          type: 'telegram',
          name: 'Task recipients',
          workspace: { type: 'system' },
          config: { bot_token: 'test-task-token', allowed_chat_ids: ['chat-task'] }
        },
        {
          id: 'channel-other',
          agentId: 'agent-task',
          type: 'telegram',
          name: 'Other recipients',
          workspace: { type: 'system' },
          config: { bot_token: 'test-other-token', allowed_chat_ids: ['chat-other'] }
        }
      ])
      .run()
    agentChannelService.subscribeToTask('channel-task', 'schedule-task')
    taskSendFile.mockResolvedValue(undefined)
    otherSendFile.mockResolvedValue(undefined)
    runtime.getAgentAdapters.mockReturnValue([
      {
        channelId: 'channel-task',
        connected: true,
        notifyChatIds: AgentChannelConfigSchemasByType.telegram.parse(
          agentChannelService.getChannel('channel-task')!.config
        ).allowed_chat_ids,
        sendMessage: vi.fn(),
        sendFile: taskSendFile
      },
      {
        channelId: 'channel-other',
        connected: true,
        notifyChatIds: AgentChannelConfigSchemasByType.telegram.parse(
          agentChannelService.getChannel('channel-other')!.config
        ).allowed_chat_ids,
        sendMessage: vi.fn(),
        sendFile: otherSendFile
      }
    ])
  })

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()))
    runtimeDriverRegistry.clearForTest()
    vi.mocked(application.get('DbService').withWriteTx).mockReset()
    await rm(workspace, { recursive: true, force: true })
  })

  function request(sessionId = 'session-task', headless = false): MainDispatchRequest {
    return {
      topicId: `agent-session:${sessionId}`,
      trigger: 'submit-message',
      headless,
      userMessageParts: [{ type: 'text', text: 'Send the corrected report' }]
    }
  }

  function finishTurn(assistantMessageId: string) {
    agentSessionMessageService.saveMessage({
      sessionId: 'session-task',
      message: { id: assistantMessageId, role: 'assistant', status: 'success', data: { parts: [] } }
    })
    runtime.grant = undefined
  }

  async function notificationTools(sessionId = 'session-task') {
    const context = resolveAgentNotificationContext(sessionId, 'agent-task')
    const client = await connectMcpTestClient(() => {
      const server = new McpServer({ name: 'task-followup-notify', version: '1.0.0' })
      registerAutonomyTools(server, {
        agentId: 'agent-task',
        sessionId,
        workspacePath: workspace,
        workspaceSource: { type: 'system' },
        trustedNotifyChannels: context.channels,
        allowAnyOwnedNotifyChannel: context.allowAnyOwnedChannel
      })
      return server
    })
    clients.push(client)
    return { client, context }
  }

  async function scheduledAdmissionThenCorrection() {
    await writeFile(path.join(workspace, 'scheduled.txt'), 'original report')
    const scheduledDispatch = await provider.prepareAgentSessionDispatch(subscriber, request('session-task', true), {
      trustedNotifyChannels: [{ id: 'channel-task', type: 'telegram' }]
    })
    const scheduled = await notificationTools()
    expect(scheduled.context).toEqual({
      sourceChannel: null,
      channels: [{ id: 'channel-task', type: 'telegram' }],
      allowAnyOwnedChannel: false
    })
    const result = await scheduled.client.callTool({ name: 'notify', arguments: { file_path: 'scheduled.txt' } })
    expect(result.isError).not.toBe(true)
    expect(taskSendFile.mock.calls).toEqual([
      [
        'chat-task',
        {
          filename: 'scheduled.txt',
          size: 15,
          media_type: 'text/plain',
          data: Buffer.from('original report').toString('base64')
        }
      ]
    ])
    expect(otherSendFile.mock.calls).toEqual([])
    finishTurn(scheduledDispatch.models[0].request.messageId!)
    taskSendFile.mockClear()
    await writeFile(path.join(workspace, 'corrected.txt'), 'corrected report')
    await provider.prepareDispatch(subscriber, request())
    return notificationTools()
  }

  it('resolves the follow-up context from the grant actually passed to beginTurn', async () => {
    const { context } = await scheduledAdmissionThenCorrection()
    expect(runtime.beginTurn.mock.lastCall?.[0].trustedNotifyChannels).toEqual([
      { id: 'channel-task', type: 'telegram' }
    ])
    expect(context).toEqual({
      sourceChannel: null,
      channels: [{ id: 'channel-task', type: 'telegram' }],
      allowAnyOwnedChannel: false
    })
  })

  it('registers notify for the interactive correction', async () => {
    const { client } = await scheduledAdmissionThenCorrection()
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('notify')
  })

  it('delivers the corrected file only to the subscribed adapter at its configured chat', async () => {
    const { client } = await scheduledAdmissionThenCorrection()
    const result = await client.callTool({ name: 'notify', arguments: { file_path: 'corrected.txt' } })
    expect(result.isError).not.toBe(true)
    expect(taskSendFile.mock.calls).toEqual([
      [
        'chat-task',
        {
          filename: 'corrected.txt',
          size: 16,
          media_type: 'text/plain',
          data: Buffer.from('corrected report').toString('base64')
        }
      ]
    ])
    expect(otherSendFile.mock.calls).toEqual([])
  })

  it.each(['session-task', 'session-unbound'])(
    'does not elevate omitted headless authority for %s',
    async (sessionId) => {
      await provider.prepareDispatch(subscriber, request(sessionId, true))
      const { client, context } = await notificationTools(sessionId)
      expect(context).toEqual({ sourceChannel: null, channels: [], allowAnyOwnedChannel: false })
      expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain('notify')
      await expect(client.callTool({ name: 'notify', arguments: { file_path: 'corrected.txt' } })).rejects.toThrow(
        'notify'
      )
      expect(taskSendFile.mock.calls).toEqual([])
      expect(otherSendFile.mock.calls).toEqual([])
    }
  )
})
