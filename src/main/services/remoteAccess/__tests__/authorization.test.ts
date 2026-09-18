import { createHash, randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'

import {
  authorizeSession,
  getInteraction,
  getMessagePart,
  listAgents,
  listMessageParts,
  readArtifact
} from '../agentAccess'

describe('remote Agent access through existing device pairing', () => {
  const database = setupTestDatabase()
  beforeEach(() => {
    database.db
      .insert(agentTable)
      .values(
        ['first', 'second'].map((id) => ({
          id,
          name: id,
          instructions: '',
          type: 'claude-code' as const,
          orderKey: id
        }))
      )
      .run()
    database.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', name: '', path: '/test', type: 'user', orderKey: 'a0' })
      .run()
    database.db
      .insert(agentSessionTable)
      .values(
        ['first', 'second'].map((id) => ({
          id: `session-${id}`,
          agentId: id,
          name: id,
          workspaceId: 'workspace',
          orderKey: id
        }))
      )
      .run()
  })

  function pair() {
    const token = `cs-dt-${randomUUID()}`
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const device = apiGatewayPairedDeviceService.create({ name: 'phone', platform: 'android', tokenHash })
    return { tokenHash, device, context: { deviceId: device.id } }
  }

  it('uses the existing pairing for all Agents without an additional grant', () => {
    const { tokenHash, device, context } = pair()
    expect(apiGatewayPairedDeviceService.findByTokenHash(tokenHash)?.id).toBe(device.id)
    expect(apiGatewayPairedDeviceService.hasTokenHash(tokenHash)).toBe(true)
    expect(listAgents(context, { limit: 20 }).items.map((agent) => agent.id)).toEqual(['first', 'second'])
    expect(authorizeSession(context, 'session-first').id).toBe('session-first')
    expect(authorizeSession(context, 'session-second').id).toBe('session-second')
    const firstPage = listAgents(context, { limit: 1 })
    expect(firstPage.items.map((agent) => agent.id)).toEqual(['first'])
    expect(listAgents(context, { limit: 1, cursor: firstPage.nextCursor! }).items.map((agent) => agent.id)).toEqual([
      'second'
    ])
  })

  it('revokes configuration export and every Agent read through the existing device deletion', async () => {
    const { tokenHash, device, context } = pair()
    apiGatewayPairedDeviceService.delete(device.id)
    expect(apiGatewayPairedDeviceService.hasTokenHash(tokenHash)).toBe(false)
    expect(apiGatewayPairedDeviceService.findByTokenHash(tokenHash)).toBeUndefined()
    expect(() => listAgents(context, { limit: 20 })).toThrow('FORBIDDEN')
    expect(() => authorizeSession(context, 'session-first')).toThrow('FORBIDDEN')
    expect(() => listMessageParts(context, { sessionId: 'session-first', messageId: 'known', limit: 20 })).toThrow(
      'FORBIDDEN'
    )
    expect(() =>
      getMessagePart(context, {
        sessionId: 'session-first',
        messageId: 'known',
        partIndex: 0,
        field: 'output',
        offset: 0,
        limitBytes: 16384
      })
    ).toThrow('FORBIDDEN')
    expect(() =>
      getInteraction(context, {
        sessionId: 'session-first',
        interactionId: 'known',
        offset: 0,
        limitBytes: 16384
      })
    ).toThrow('FORBIDDEN')
    await expect(
      readArtifact(context, {
        sessionId: 'session-first',
        messageId: 'known',
        partIndex: 0,
        artifactIndex: 0,
        offset: 0,
        limitBytes: 65536
      })
    ).rejects.toThrow('FORBIDDEN')
  })

  it('rejects unpaired devices and work admitted after a connection closes', () => {
    expect(() => listAgents({ deviceId: 'unknown' }, { limit: 20 })).toThrow('FORBIDDEN')
    const { context } = pair()
    expect(() => authorizeSession({ ...context, isActive: () => false }, 'session-first')).toThrow('FORBIDDEN')
  })
})
