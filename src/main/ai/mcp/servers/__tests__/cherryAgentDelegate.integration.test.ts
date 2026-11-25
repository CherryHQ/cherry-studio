import { McpServer } from '@modelcontextprotocol/server'
import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { AgentSessionDeliveryService } from '@main/ai/agentSession/AgentSessionDeliveryService'
import { LocalRuntimeDriver } from '@main/ai/runtime/localAgent/LocalRuntimeDriver'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import { BaseService } from '@main/core/lifecycle/BaseService'

import { registerAutonomyTools, type AutonomyToolsContext } from '../cherryAutonomyTools'
import { callBuiltinTool, toolText } from './builtinMcpClient'

describe('agent_delegate project and admission contract', () => {
  const dbh = setupTestDatabase()
  const getInteractionState = vi.fn()
  let context: AutonomyToolsContext

  function createServer() {
    const server = new McpServer({ name: 'cherry-tools', version: '1.0.0' })
    registerAutonomyTools(server, context)
    return server
  }

  async function delegate(args: Record<string, unknown> = {}) {
    return callBuiltinTool(createServer, 'agent_delegate', {
      target_agent_id: 'local-target',
      message: 'Inspect this project',
      ...args
    })
  }

  beforeEach(() => {
    BaseService.resetInstances()
    MockApplicationUtils.setService('AiStreamManager', { isWriteQuiesced: false })
    getInteractionState.mockReturnValue({ currentTurn: 'interactive', userResponse: 'stream' })
    MockApplicationUtils.setService('AgentSessionRuntimeService', {
      getInteractionState,
      getExecutionHead: () => undefined
    })
    const delivery = new AgentSessionDeliveryService()
    vi.spyOn(delivery, 'kick').mockImplementation(() => {})
    MockApplicationUtils.setService('AgentSessionDeliveryService', delivery)
    runtimeDriverRegistry.register(new LocalRuntimeDriver())
    dbh.db
      .insert(agentTable)
      .values([
        { id: 'caller', type: 'claude-code', name: 'Caller', instructions: '', orderKey: 'a' },
        {
          id: 'local-target',
          type: 'local',
          name: 'Codex',
          instructions: '',
          orderKey: 'b',
          configuration: { localRuntime: { protocol: 'codex', enabled: true, args: [], env: {} } }
        },
        {
          id: 'disabled',
          type: 'local',
          name: 'Disabled',
          instructions: '',
          orderKey: 'c',
          configuration: { localRuntime: { protocol: 'acp', enabled: false, args: [], env: {} } }
        }
      ])
      .run()
    const workspace = agentWorkspaceService.findOrCreateByPath('/tmp/delegate-caller-project')
    const session = agentSessionService.create({
      agentId: 'caller',
      name: 'Caller',
      workspace: { type: 'user', workspaceId: workspace.id }
    })
    context = {
      agentId: 'caller',
      sessionId: session.id,
      workspaceSource: { type: 'user', workspaceId: workspace.id },
      workspacePath: workspace.path,
      trustedNotifyChannels: [],
      allowAnyOwnedNotifyChannel: false
    }
    const other = agentWorkspaceService.findOrCreateByPath('/tmp/delegate-target-previous-project')
    agentSessionService.create({
      agentId: 'local-target',
      name: 'Previous',
      workspace: { type: 'user', workspaceId: other.id }
    })
  })

  afterEach(() => {
    BaseService.resetInstances()
    vi.restoreAllMocks()
    runtimeDriverRegistry.clearForTest()
    MockApplicationUtils.resetServices()
  })

  it('discovers enabled local targets without claiming their CLI is ready or requiring a Cherry model', async () => {
    const result = await callBuiltinTool(createServer, 'agent_list', {})
    const { agents } = JSON.parse(toolText(result))
    expect(agents.map((agent: { id: string }) => agent.id)).toContain('local-target')
    expect(agents.map((agent: { id: string }) => agent.id)).not.toContain('disabled')
    expect(agents.find((agent: { id: string }) => agent.id === 'local-target')).toMatchObject({
      readiness: 'unchecked'
    })
    expect(agents.find((agent: { id: string }) => agent.id === 'local-target')).not.toHaveProperty('modelConfigured')
  })

  it('persists a dedicated task in the caller project with a durable completion request', async () => {
    const result = await delegate()
    expect(result.isError, toolText(result)).not.toBe(true)
    const receipt = JSON.parse(toolText(result))
    expect(agentSessionService.getById(receipt.sessionId)).toMatchObject({
      agentId: 'local-target',
      workspaceId: context.workspaceSource.type === 'user' ? context.workspaceSource.workspaceId : ''
    })
    expect(agentSessionMessageService.getSessionMessage(receipt.sessionId, receipt.requestId).delivery).toMatchObject({
      delegation: true,
      replyPolicy: 'completion',
      status: 'accepted',
      sender: { agentId: 'caller', sessionId: context.sessionId },
      receiver: { agentId: 'local-target', sessionId: receipt.sessionId }
    })
    const second = JSON.parse(toolText(await delegate()))
    expect(second.sessionId).not.toBe(receipt.sessionId)
    expect(second.requestId).not.toBe(receipt.requestId)
  })

  it('honors an explicit project and keeps ordinary cross-Agent session defaults', async () => {
    const selected = agentWorkspaceService.findOrCreateByPath('/tmp/delegate-explicit-project')
    const result = JSON.parse(toolText(await delegate({ workspace_id: selected.id })))
    expect(agentSessionService.getById(result.sessionId).workspaceId).toBe(selected.id)
    const ordinary = await callBuiltinTool(createServer, 'session_create', {
      target_agent_id: 'local-target',
      message: 'Continue'
    })
    const receipt = JSON.parse(toolText(ordinary))
    expect(agentSessionService.getById(receipt.sessionId).workspaceId).toBe(selected.id)
    expect(receipt.delivery).not.toHaveProperty('delegation')
  })

  it('rejects a missing project atomically instead of falling back or leaving an empty session', async () => {
    const before = dbh.db.select().from(agentSessionTable).all().length
    expect((await delegate({ workspace_id: 'deleted-project' })).isError).toBe(true)
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(before)
  })

  it('rechecks enablement after discovery and refuses nonlocal targets', async () => {
    await callBuiltinTool(createServer, 'agent_list', {})
    dbh.db
      .update(agentTable)
      .set({ configuration: { localRuntime: { protocol: 'codex', enabled: false, args: [], env: {} } } })
      .where(eq(agentTable.id, 'local-target'))
      .run()
    const before = dbh.db.select().from(agentSessionTable).all().length
    expect((await delegate()).isError).toBe(true)
    expect((await delegate({ target_agent_id: 'caller' })).isError).toBe(true)
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(before)
  })

  it('does not delegate from headless work or without a user responder', async () => {
    const before = dbh.db.select().from(agentSessionTable).all().length
    for (const state of [
      { currentTurn: 'headless', userResponse: 'unavailable' },
      { currentTurn: 'interactive', userResponse: 'unavailable' }
    ]) {
      getInteractionState.mockReturnValue(state)
      expect((await delegate()).isError).toBe(true)
    }
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(before)
  })

  it('uses a fresh managed workspace when the caller has no user project', async () => {
    context.workspaceSource = { type: 'system' }
    const first = JSON.parse(toolText(await delegate()))
    const second = JSON.parse(toolText(await delegate()))
    expect(first.workspace.type).toBe('system')
    expect(second.workspace.type).toBe('system')
    expect(first.workspace.id).not.toBe(second.workspace.id)
  })
})
