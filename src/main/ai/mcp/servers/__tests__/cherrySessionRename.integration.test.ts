import { McpServer } from '@modelcontextprotocol/server'
import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'

import { registerAutonomyTools, type AutonomyToolsContext } from '../cherryAutonomyTools'
import { callBuiltinTool, listBuiltinTools, toolText } from './builtinMcpClient'

describe('session_rename persisted contract', () => {
  const dbh = setupTestDatabase()
  const getInteractionState = vi.fn()
  let context: AutonomyToolsContext

  function createServer() {
    const server = new McpServer({ name: 'cherry-tools', version: '1.0.0' })
    registerAutonomyTools(server, context)
    return server
  }

  function createSession(agentId = 'rename-owner') {
    const workspace = agentWorkspaceService.findOrCreateByPath('/tmp/cherry-session-rename-test')
    return agentSessionService.create({
      agentId,
      name: 'Original title',
      workspace: { type: 'user', workspaceId: workspace.id }
    })
  }

  beforeEach(() => {
    getInteractionState.mockReturnValue({ currentTurn: 'interactive', userResponse: 'stream' })
    MockApplicationUtils.setService('AgentSessionRuntimeService', { getInteractionState })
    dbh.db
      .insert(agentTable)
      .values(
        ['rename-owner', 'rename-other'].map((id) => ({
          id,
          type: 'claude-code' as const,
          name: id,
          instructions: '',
          orderKey: id
        }))
      )
      .run()
    const session = createSession()
    context = {
      agentId: 'rename-owner',
      sessionId: session.id,
      workspaceSource: { type: 'user', workspaceId: session.workspaceId },
      workspacePath: session.workspace.path,
      trustedNotifyChannels: [],
      allowAnyOwnedNotifyChannel: false
    }
  })

  afterEach(() => MockApplicationUtils.resetServices())

  it('advertises the title and optional target to Agent runtimes', async () => {
    const tool = (await listBuiltinTools(createServer)).find((entry) => entry.name === 'session_rename')
    expect(tool?.inputSchema.required).toEqual(['title'])
    expect(tool?.inputSchema.properties?.title).toMatchObject({ type: 'string', minLength: 1, maxLength: 255 })
    expect(tool?.inputSchema.properties).toHaveProperty('session_id')
  })

  it('persists a trimmed current-session title and protects it from automatic naming', async () => {
    const before = agentSessionService.getById(context.sessionId)
    const result = await callBuiltinTool(createServer, 'session_rename', { title: '  会话重命名  ' })

    expect(result.isError, toolText(result)).not.toBe(true)
    expect(JSON.parse(toolText(result))).toEqual({ sessionId: before.id, sessionName: '会话重命名' })
    expect(agentSessionService.getById(before.id)).toMatchObject({
      name: '会话重命名',
      isNameManuallyEdited: true,
      agentId: before.agentId,
      workspaceId: before.workspaceId,
      lastActivityAt: before.lastActivityAt
    })
    expect(agentSessionService.listAddressableByCursor({}).items).toContainEqual(
      expect.objectContaining({ sessionId: before.id, sessionName: '会话重命名' })
    )
  })

  it('renames an explicit same-Agent Session without changing the current Session', async () => {
    const target = createSession()
    const result = await callBuiltinTool(createServer, 'session_rename', {
      session_id: ` ${target.id} `,
      title: 'x'.repeat(255)
    })

    expect(result.isError, toolText(result)).not.toBe(true)
    expect(agentSessionService.getById(target.id)).toMatchObject({ name: 'x'.repeat(255), isNameManuallyEdited: true })
    expect(agentSessionService.getById(context.sessionId).name).toBe('Original title')
  })

  it.each([
    {},
    { title: '' },
    { title: ' \n\t ' },
    { title: 'x'.repeat(256) },
    { title: 12 },
    { title: 'New', session_id: ' ' },
    { title: 'New', agent_id: 'rename-other' },
    { title: 'New', isNameManuallyEdited: false }
  ])('rejects invalid arguments without modifying the Session: %j', async (args) => {
    const result = await callBuiltinTool(createServer, 'session_rename', args)

    expect(result.isError).toBe(true)
    expect(agentSessionService.getById(context.sessionId)).toMatchObject({
      name: 'Original title',
      isNameManuallyEdited: false
    })
  })

  it('renames another Agent’s Session without changing its ownership or the current Session', async () => {
    const target = createSession('rename-other')
    const result = await callBuiltinTool(createServer, 'session_rename', { session_id: target.id, title: 'New' })

    expect(result.isError, toolText(result)).not.toBe(true)
    expect(JSON.parse(toolText(result))).toEqual({ sessionId: target.id, sessionName: 'New' })
    expect(agentSessionService.getById(target.id)).toMatchObject({
      name: 'New',
      isNameManuallyEdited: true,
      agentId: target.agentId,
      workspaceId: target.workspaceId,
      lastActivityAt: target.lastActivityAt
    })
    expect(agentSessionService.getById(context.sessionId)).toMatchObject({
      name: 'Original title',
      isNameManuallyEdited: false
    })
  })

  it.each(['missing', 'trashed'])('rejects a %s target without modifying the current Session', async (kind) => {
    const target = createSession()
    if (kind === 'trashed') {
      dbh.db.update(agentSessionTable).set({ deletedAt: Date.now() }).where(eq(agentSessionTable.id, target.id)).run()
    }
    const result = await callBuiltinTool(createServer, 'session_rename', {
      session_id: kind === 'missing' ? 'missing-session' : target.id,
      title: 'New'
    })

    expect(result.isError).toBe(true)
    const [row] = dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, target.id)).all()
    expect(row.name).toBe('Original title')
    expect(agentSessionService.getById(context.sessionId).name).toBe('Original title')
  })

  it.each([
    { currentTurn: 'headless', userResponse: 'unavailable' },
    { currentTurn: 'interactive', userResponse: 'unavailable' }
  ])('denies renaming without an interactive responder: %j', async (interaction) => {
    getInteractionState.mockReturnValue(interaction)
    const target = createSession('rename-other')
    const result = await callBuiltinTool(createServer, 'session_rename', { session_id: target.id, title: 'New' })

    expect(result.isError).toBe(true)
    expect(JSON.parse(toolText(result))).toMatchObject({ error: { code: 'SESSION_TOOL_FORBIDDEN' } })
    expect(agentSessionService.getById(target.id).name).toBe('Original title')
    expect(agentSessionService.getById(context.sessionId).name).toBe('Original title')
  })

  it('rejects a runtime whose current Session has been reassigned', async () => {
    const target = createSession('rename-other')
    agentSessionService.update(context.sessionId, { agentId: 'rename-other' })
    const result = await callBuiltinTool(createServer, 'session_rename', { session_id: target.id, title: 'New' })

    expect(result.isError).toBe(true)
    expect(JSON.parse(toolText(result))).toMatchObject({ error: { code: 'SENDER_FORBIDDEN' } })
    expect(agentSessionService.getById(target.id).name).toBe('Original title')
    expect(agentSessionService.getById(context.sessionId).name).toBe('Original title')
  })
})
