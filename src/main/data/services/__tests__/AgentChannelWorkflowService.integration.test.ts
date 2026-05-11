/**
 * Integration test for AgentChannelWorkflowService.updateChannel rollback.
 *
 * Complements the unit tests in `AgentChannelWorkflowService.test.ts` (which
 * mock `agentChannelService` away) by asserting that, when `channelManager.syncChannel`
 * throws, the SQLite row is byte-for-byte equal to the pre-update snapshot —
 * i.e. the rollback contract holds end-to-end against the real DB layer, not
 * just at the call-graph level.
 */

import { agentTable } from '@data/db/schemas/agent'
import { agentChannelTable } from '@data/db/schemas/agentChannel'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { syncChannelMock, disconnectChannelMock } = vi.hoisted(() => ({
  syncChannelMock: vi.fn(),
  disconnectChannelMock: vi.fn()
}))

vi.mock('@main/services/agents/services/channels', () => ({
  channelManager: {
    syncChannel: syncChannelMock,
    disconnectChannel: disconnectChannelMock
  }
}))

// Import AFTER mocks
import { agentChannelWorkflowService } from '../AgentChannelWorkflowService'

const TELEGRAM_CONFIG = { bot_token: 'original-token-123', allowed_chat_ids: ['chat-1'] }

describe('AgentChannelWorkflowService.updateChannel — DB rollback integration', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function insertAgent(id: string): Promise<void> {
    await dbh.db.insert(agentTable).values({
      id,
      type: 'claude-code',
      name: `Agent ${id}`,
      instructions: 'test',
      model: null
    })
  }

  it('restores the SQLite row byte-for-byte when syncChannel throws', async () => {
    await insertAgent('agent-rollback-1')
    syncChannelMock.mockResolvedValue(undefined)

    // Seed the channel via the real workflow path so timestamps and id are realistic.
    const created = await agentChannelWorkflowService.createChannel({
      type: 'telegram',
      name: 'Original Name',
      agentId: 'agent-rollback-1',
      config: TELEGRAM_CONFIG,
      isActive: true,
      activeChatIds: ['chat-1', 'chat-2'],
      permissionMode: 'default'
    })

    // Snapshot the row state at the SQLite level (raw row, not rowToEntity output).
    const [snapshot] = await dbh.db.select().from(agentChannelTable).where(eq(agentChannelTable.id, created.id))
    expect(snapshot).toBeTruthy()

    // Arrange syncChannel to fail on the *update* (second call). The first call
    // (during create) already resolved above.
    syncChannelMock.mockRejectedValueOnce(new Error('sync failed during update'))
    // The post-rollback resync should succeed.
    syncChannelMock.mockResolvedValueOnce(undefined)

    await expect(
      agentChannelWorkflowService.updateChannel(created.id, {
        name: 'New Name',
        config: { bot_token: 'new-token-456', allowed_chat_ids: [] },
        activeChatIds: ['chat-99'],
        permissionMode: 'acceptEdits'
      })
    ).rejects.toThrow('sync failed during update')

    // After rollback the row must equal the snapshot for every field
    // *except* updatedAt, which the restore write necessarily refreshes.
    const [after] = await dbh.db.select().from(agentChannelTable).where(eq(agentChannelTable.id, created.id))
    expect(after).toBeTruthy()
    expect(after.id).toBe(snapshot.id)
    expect(after.name).toBe(snapshot.name)
    expect(after.type).toBe(snapshot.type)
    expect(after.agentId).toBe(snapshot.agentId)
    expect(after.sessionId).toBe(snapshot.sessionId)
    expect(after.config).toEqual(snapshot.config)
    expect(after.isActive).toBe(snapshot.isActive)
    expect(after.activeChatIds).toEqual(snapshot.activeChatIds)
    expect(after.permissionMode).toBe(snapshot.permissionMode)
    expect(after.createdAt).toBe(snapshot.createdAt)
  })

  it('restores nullable fields to NULL (not undefined-skip) when original was NULL', async () => {
    // Regression guard for the Drizzle "undefined = skip" pitfall in rollback:
    // the snapshot comes from rowToEntity (NULL → undefined). Without an explicit
    // ?? null in the restore payload, drizzle would skip those fields, leaving
    // the failed-update value in the DB.
    await insertAgent('agent-rollback-2')
    syncChannelMock.mockResolvedValue(undefined)

    const created = await agentChannelWorkflowService.createChannel({
      type: 'telegram',
      name: 'Null-Field Channel',
      // agentId / sessionId / activeChatIds / permissionMode left NULL
      config: TELEGRAM_CONFIG,
      isActive: true
    })

    syncChannelMock.mockRejectedValueOnce(new Error('sync failed'))
    syncChannelMock.mockResolvedValueOnce(undefined)

    await expect(
      agentChannelWorkflowService.updateChannel(created.id, {
        agentId: 'agent-rollback-2',
        activeChatIds: ['chat-1'],
        permissionMode: 'plan'
      })
    ).rejects.toThrow('sync failed')

    const [after] = await dbh.db.select().from(agentChannelTable).where(eq(agentChannelTable.id, created.id))
    // Columns without a DB DEFAULT (agentId, permissionMode) must roll back to NULL.
    expect(after.agentId).toBeNull()
    expect(after.permissionMode).toBeNull()
    // activeChatIds has DB DEFAULT [], so the original is [] not NULL.
    expect(after.activeChatIds).toEqual([])
  })
})
