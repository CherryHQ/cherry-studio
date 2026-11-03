import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it } from 'vitest'

import { agentHandlers } from '@data/api/handlers/agents'
import { agentTable } from '@data/db/schemas/agent'
import { agentMcpServerTable } from '@data/db/schemas/assistantRelations'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { agentService } from '@data/services/AgentService'
import { resolveAgentUserMcpIds } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { ErrorCode } from '@shared/data/api/errors'

describe('Agent MCP bindings remain stored independently of runtime policy', () => {
  const dbh = setupTestDatabase()
  const doctorAgentId = 'doctor-agent'
  const ordinaryAgentId = 'ordinary-agent'
  const realMcpServerId = 'user-server'

  beforeEach(() => {
    dbh.db.insert(mcpServerTable).values({ id: realMcpServerId, name: 'User server' }).run()
    dbh.db
      .insert(agentTable)
      .values([
        {
          id: doctorAgentId,
          type: 'claude-code',
          name: 'Doctor',
          instructions: '',
          orderKey: 'a0',
          configuration: { builtin_role: 'doctor' }
        },
        { id: ordinaryAgentId, type: 'claude-code', name: 'Ordinary', instructions: '', orderKey: 'a1' }
      ])
      .run()
  })

  it('persists PATCHed Doctor bindings while runtime projection leaves the saved row untouched', async () => {
    const doctor = await agentHandlers['/agents/:agentId'].PATCH({
      params: { agentId: doctorAgentId },
      body: { mcps: [realMcpServerId] }
    })
    expect(doctor).toMatchObject({ mcps: [realMcpServerId], configuration: { builtin_role: 'doctor' } })
    const rows = dbh.db.select().from(agentMcpServerTable).all()
    expect(rows).toEqual([expect.objectContaining({ agentId: doctorAgentId, mcpServerId: realMcpServerId })])
    if ('data' in doctor) throw new Error('Expected the default handler response shape')
    expect(resolveAgentUserMcpIds(doctor)).toEqual([])
    expect(dbh.db.select().from(agentMcpServerTable).all()).toEqual(rows)
    expect(agentService.getAgent(doctorAgentId)).toMatchObject({
      mcps: [realMcpServerId],
      configuration: { builtin_role: 'doctor' }
    })
  })

  it('PATCHes ordinary bindings without attaching any relation to Doctor', async () => {
    const ordinary = await agentHandlers['/agents/:agentId'].PATCH({
      params: { agentId: ordinaryAgentId },
      body: { mcps: [realMcpServerId] }
    })
    if ('data' in ordinary) throw new Error('Expected the default handler response shape')
    expect(resolveAgentUserMcpIds(ordinary)).toEqual([realMcpServerId])
    expect(dbh.db.select().from(agentMcpServerTable).all()).toEqual([
      expect.objectContaining({ agentId: ordinaryAgentId, mcpServerId: realMcpServerId })
    ])
    expect(agentService.getAgent(doctorAgentId)).toMatchObject({ mcps: [], configuration: { builtin_role: 'doctor' } })
  })

  it.each([ordinaryAgentId, doctorAgentId])(
    'rejects forged builtin_role PATCHes on %s without writing bindings',
    async (agentId) => {
      await expect(
        agentHandlers['/agents/:agentId'].PATCH({
          params: { agentId },
          body: { mcps: [realMcpServerId], configuration: { builtin_role: 'assistant' } }
        })
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_OPERATION })
      expect(dbh.db.select().from(agentMcpServerTable).all()).toEqual([])
      expect(agentService.getAgent(doctorAgentId)?.configuration?.builtin_role).toBe('doctor')
      expect(agentService.getAgent(ordinaryAgentId)?.configuration?.builtin_role).toBeUndefined()
    }
  )
})
