import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { remoteCommandTable } from '@data/db/schemas/remoteCommand'
import { agentSessionService } from '@data/services/AgentSessionService'
import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'

import type { RemoteMethod } from '../protocol'
import { RequestRouter } from '../requestRouter'

describe('remote workspace selection', () => {
  const database = setupTestDatabase()
  let router: RequestRouter
  let response: unknown
  let deviceId: string
  const firstWorkspace = { id: 'first', name: 'Project', path: '/projects/first', type: 'user' as const }
  const secondWorkspace = { id: 'second', name: 'Project', path: '/projects/second', type: 'user' as const }

  beforeEach(() => {
    const container = application.getContainer()
    const getService = container.get.bind(container)
    vi.spyOn(container, 'get').mockImplementation((token) => {
      if (token === 'AiStreamManager') {
        return { isWriteQuiesced: false, getTopicSnapshot: () => ({ status: 'idle', executions: [] }) }
      }
      if (token === 'AgentSessionRuntimeService') {
        return { isWriteQuiesced: false, listSessionInteractions: () => [] }
      }
      return getService(token)
    })
    database.db
      .insert(agentTable)
      .values({
        id: 'agent',
        name: 'Agent',
        instructions: '',
        type: 'claude-code',
        orderKey: 'a0'
      })
      .run()
    database.db
      .insert(agentWorkspaceTable)
      .values([
        { ...secondWorkspace, orderKey: 'a1' },
        { id: 'system', name: 'System', path: '/system/existing', type: 'system', orderKey: 'Zz' },
        { ...firstWorkspace, orderKey: 'a0' }
      ])
      .run()
    deviceId = apiGatewayPairedDeviceService.create({
      name: 'Phone',
      platform: 'android',
      tokenHash: randomUUID()
    }).id
    router = new RequestRouter(
      { deviceId },
      'desktop',
      (value) => {
        response = value
      },
      () => {}
    )
  })

  afterEach(() => {
    router.dispose()
    vi.restoreAllMocks()
  })

  async function request(method: RemoteMethod, params: Record<string, unknown> = {}) {
    response = undefined
    router.receive({ type: 'request', requestId: randomUUID(), method, params })
    await router.drain()
    return response
  }

  it('lists only selectable user workspaces in desktop order, with bounded pages', async () => {
    expect(await request('system.info')).toMatchObject({
      result: { capabilities: expect.arrayContaining(['workspaces']) }
    })
    expect(await request('workspaces.list', { limit: 1 })).toMatchObject({
      result: { items: [firstWorkspace], nextCursor: '1' }
    })
    expect(await request('workspaces.list', { limit: 1, cursor: '1' })).toMatchObject({
      result: { items: [secondWorkspace], nextCursor: null }
    })
    expect(await request('workspaces.list', { cursor: '2' })).toMatchObject({
      result: { items: [], nextCursor: null }
    })
  })

  it('uses the selected workspace and returns it in both session lists and snapshots', async () => {
    const command = { agentId: 'agent', workspaceId: 'second', commandId: randomUUID() }
    const created = await request('sessions.create', command)
    const sessions = database.db.select().from(agentSessionTable).all()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].workspaceId).toBe('second')
    expect(created).toMatchObject({ result: { status: 'accepted', sessionId: sessions[0].id } })
    const expectedSession = { id: sessions[0].id, workspaceId: 'second', workspace: secondWorkspace }
    expect(await request('sessions.list', { agentId: 'agent' })).toMatchObject({
      result: { items: [expect.objectContaining(expectedSession)] }
    })
    expect(await request('sessions.get', { sessionId: sessions[0].id })).toMatchObject({
      result: { session: expectedSession }
    })

    expect(await request('sessions.create', command)).toMatchObject({
      result: { status: 'accepted', sessionId: sessions[0].id }
    })
    expect(await request('sessions.create', { ...command, workspaceId: 'first' })).toMatchObject({
      error: { code: 'COMMAND_CONFLICT' }
    })
    expect(database.db.select().from(agentSessionTable).all()).toHaveLength(1)
    expect(database.db.select().from(remoteCommandTable).all()).toHaveLength(1)
    expect(database.db.select().from(agentWorkspaceTable).all()).toHaveLength(3)
  })

  it('keeps automatic, isolated system workspaces when workspaceId is omitted', async () => {
    for (let i = 0; i < 2; i++) {
      expect(await request('sessions.create', { agentId: 'agent', commandId: randomUUID() })).toMatchObject({
        result: { status: 'accepted' }
      })
    }
    const sessions = database.db.select().from(agentSessionTable).all()
    expect(sessions).toHaveLength(2)
    expect(sessions[0].workspaceId).not.toBe(sessions[1].workspaceId)
    for (const session of sessions) {
      const persisted = agentSessionService.getById(session.id)
      expect(persisted.workspace.type).toBe('system')
      expect(await request('sessions.get', { sessionId: session.id })).toMatchObject({
        result: {
          session: { workspaceId: session.workspaceId, workspace: { id: session.workspaceId, type: 'system' } }
        }
      })
    }
    expect(await request('workspaces.list')).toMatchObject({
      result: { items: [firstWorkspace, secondWorkspace], nextCursor: null }
    })
  })

  it.each(['unknown', 'system'])('rejects unavailable workspace %s without partial writes', async (workspaceId) => {
    expect(await request('sessions.create', { agentId: 'agent', workspaceId, commandId: randomUUID() })).toMatchObject({
      error: { code: 'RESOURCE_UNAVAILABLE' }
    })
    expect(database.db.select().from(agentSessionTable).all()).toHaveLength(0)
    expect(database.db.select().from(remoteCommandTable).all()).toHaveLength(0)
    expect(database.db.select().from(agentWorkspaceTable).all()).toHaveLength(3)
  })

  it('revokes workspace listing and session creation through the existing paired-device deletion', async () => {
    apiGatewayPairedDeviceService.delete(deviceId)
    expect(await request('workspaces.list')).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(
      await request('sessions.create', {
        agentId: 'agent',
        workspaceId: 'first',
        commandId: randomUUID()
      })
    ).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(database.db.select().from(agentSessionTable).all()).toHaveLength(0)
  })

  it.each([
    ['workspaces.list', { cursor: '-1' }],
    ['workspaces.list', { cursor: 'not-a-cursor' }],
    ['workspaces.list', { limit: 51 }],
    ['sessions.create', { agentId: 'agent', workspaceId: '', commandId: randomUUID() }],
    ['sessions.create', { agentId: 'agent', workspaceId: null, commandId: randomUUID() }],
    ['sessions.create', { agentId: 'agent', path: '/arbitrary/path', commandId: randomUUID() }]
  ] as const)('rejects invalid %s parameters %j', async (method, params) => {
    expect(await request(method, params)).toMatchObject({ error: { code: 'INVALID_REQUEST' } })
    expect(database.db.select().from(agentSessionTable).all()).toHaveLength(0)
  })
})
