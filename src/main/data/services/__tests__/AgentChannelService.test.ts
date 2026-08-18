import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { AgentChannelService, agentChannelService } from '@data/services/AgentChannelService'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

const TELEGRAM_CONFIG = { bot_token: 'test-token-123', allowed_chat_ids: [] }
const SYSTEM_WORKSPACE = { type: 'system' as const }

describe('AgentChannelService', () => {
  const dbh = setupTestDatabase()

  /** Insert a minimal agent row directly so agentId FK constraints are satisfied. */
  async function insertAgent(id: string): Promise<void> {
    await dbh.db.insert(agentTable).values({
      id,
      type: 'claude-code',
      name: `Agent ${id}`,
      instructions: 'test',
      model: null,
      orderKey: 'a0'
    })
  }

  describe('createChannel', () => {
    it('creates a channel and returns the entity', async () => {
      const channel = agentChannelService.createChannel({
        type: 'telegram',
        name: 'My Bot',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG,
        isActive: true
      })

      expect(channel.id).toBeTruthy()
      expect(channel.type).toBe('telegram')
      expect(channel.name).toBe('My Bot')
      expect(channel.isActive).toBe(true)
      expect(channel.config).toMatchObject({ bot_token: 'test-token-123' })
    })

    it('creates an inactive channel', async () => {
      const channel = agentChannelService.createChannel({
        type: 'telegram',
        name: 'Draft Bot',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG,
        isActive: false
      })

      expect(channel.isActive).toBe(false)
    })

    it('returns ISO 8601 timestamps (rowToEntity converts SQLite integer timestamps)', async () => {
      const channel = agentChannelService.createChannel({
        type: 'telegram',
        name: 'Timestamp Test',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG
      })

      expect(channel.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      expect(channel.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })
  })

  describe('getChannel', () => {
    it('returns channel by id', async () => {
      const created = agentChannelService.createChannel({
        type: 'telegram',
        name: 'Get Test',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG
      })

      const found = agentChannelService.getChannel(created.id)
      expect(found).not.toBeNull()
      expect(found!.id).toBe(created.id)
    })

    it('returns null for unknown id', async () => {
      const result = agentChannelService.getChannel('nonexistent-id')
      expect(result).toBeNull()
    })
  })

  describe('listChannels', () => {
    it('lists all channels when no filters applied', async () => {
      agentChannelService.createChannel({
        type: 'telegram',
        name: 'TG',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG
      })
      agentChannelService.createChannel({
        type: 'discord',
        name: 'DC',
        workspace: SYSTEM_WORKSPACE,
        config: { bot_token: 'dc-token' }
      })

      const channels = agentChannelService.listChannels()
      expect(channels.length).toBeGreaterThanOrEqual(2)
    })

    it('filters by type', async () => {
      agentChannelService.createChannel({
        type: 'telegram',
        name: 'TG Filter',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG
      })

      const channels = agentChannelService.listChannels({ type: 'telegram' })
      expect(channels.every((c) => c.type === 'telegram')).toBe(true)
    })

    it('filters by agentId alone', async () => {
      const agentId = `agent-filter-${Date.now()}`
      await insertAgent(agentId)
      agentChannelService.createChannel({
        type: 'telegram',
        name: 'AgentA Bot',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG,
        agentId
      })
      agentChannelService.createChannel({
        type: 'telegram',
        name: 'No-Agent Bot',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG
        // agentId intentionally omitted
      })

      const channels = agentChannelService.listChannels({ agentId })
      expect(channels.length).toBeGreaterThanOrEqual(1)
      expect(channels.every((c) => c.agentId === agentId)).toBe(true)
    })

    it('filters by agentId AND type combined (both eq predicates compose)', async () => {
      const agentId = `agent-combo-${Date.now()}`
      await insertAgent(agentId)
      agentChannelService.createChannel({
        type: 'telegram',
        name: 'TG Agent Bot',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG,
        agentId
      })
      agentChannelService.createChannel({
        type: 'discord',
        name: 'DC Agent Bot',
        workspace: SYSTEM_WORKSPACE,
        config: { bot_token: 'dc-tok' },
        agentId
      })
      // telegram channel for a different agent — must NOT appear
      agentChannelService.createChannel({
        type: 'telegram',
        name: 'TG Other Bot',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG
      })

      const channels = agentChannelService.listChannels({ agentId, type: 'telegram' })
      expect(channels.length).toBeGreaterThanOrEqual(1)
      expect(channels.every((c) => c.agentId === agentId && c.type === 'telegram')).toBe(true)
    })
  })

  describe('updateChannel', () => {
    it('updates channel name', async () => {
      const channel = agentChannelService.createChannel({
        type: 'telegram',
        name: 'Before',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG
      })

      const updated = agentChannelService.updateChannel(channel.id, { name: 'After' })
      expect(updated!.name).toBe('After')
    })

    it('returns null when channel does not exist', async () => {
      const result = agentChannelService.updateChannel('nonexistent', { name: 'x' })
      expect(result).toBeNull()
    })

    it('toggles isActive', async () => {
      const channel = agentChannelService.createChannel({
        type: 'telegram',
        name: 'Toggle',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG,
        isActive: true
      })

      const updated = agentChannelService.updateChannel(channel.id, { isActive: false })
      expect(updated!.isActive).toBe(false)
    })
  })

  describe('normalizeChannelConfig (via createChannel)', () => {
    it('strips the type key from the stored config', async () => {
      const channel = agentChannelService.createChannel({
        type: 'telegram',
        name: 'Norm Test',
        workspace: SYSTEM_WORKSPACE,
        config: { bot_token: 'tok', type: 'telegram' } as any
      })

      expect(channel.config).not.toHaveProperty('type')
      expect((channel.config as any).bot_token).toBe('tok')
    })

    it('stores an empty object when config is a non-object value', async () => {
      const channel = agentChannelService.createChannel({
        type: 'telegram',
        name: 'Non-obj Config',
        workspace: SYSTEM_WORKSPACE,
        config: 'bad-value' as any
      })

      expect(channel.config).toEqual({})
    })
  })

  describe('deleteChannel', () => {
    it('deletes a channel and returns true', async () => {
      const channel = agentChannelService.createChannel({
        type: 'telegram',
        name: 'To Delete',
        workspace: SYSTEM_WORKSPACE,
        config: TELEGRAM_CONFIG
      })

      const deleted = agentChannelService.deleteChannel(channel.id)
      expect(deleted).toBe(true)

      const found = agentChannelService.getChannel(channel.id)
      expect(found).toBeNull()
    })

    it('returns false when channel does not exist', async () => {
      const result = agentChannelService.deleteChannel('nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('conversation sessions', () => {
    it('persists separate private-sender bindings and resolves every mapped session after restart', async () => {
      await insertAgent('agent-conversation-test')
      dbh.db
        .insert(agentWorkspaceTable)
        .values({
          id: 'workspace-conversation-test',
          name: 'Conversation workspace',
          path: '/tmp/conversation-workspace',
          type: 'user',
          orderKey: 'a0'
        })
        .run()
      dbh.db
        .insert(agentSessionTable)
        .values([
          {
            id: 'session-user-1',
            agentId: 'agent-conversation-test',
            name: 'User 1',
            workspaceId: 'workspace-conversation-test',
            orderKey: 'a0'
          },
          {
            id: 'session-user-2',
            agentId: 'agent-conversation-test',
            name: 'User 2',
            workspaceId: 'workspace-conversation-test',
            orderKey: 'a1'
          }
        ])
        .run()
      const channel = agentChannelService.createChannel({
        type: 'feishu',
        name: 'Feishu',
        agentId: 'agent-conversation-test',
        workspace: { type: 'user', workspaceId: 'workspace-conversation-test' },
        config: {}
      })

      dbh.db.transaction((tx) => {
        agentChannelService.linkConversationSessionTx(tx, channel.id, 'ou_user_1', 'session-user-1')
        agentChannelService.linkConversationSessionTx(tx, channel.id, 'ou_user_2', 'session-user-2')
      })

      const restartedService = new AgentChannelService()
      expect(restartedService.getConversationSessionId(channel.id, 'ou_user_1')).toBe('session-user-1')
      expect(restartedService.getConversationSessionId(channel.id, 'ou_user_2')).toBe('session-user-2')
      expect(restartedService.findBySessionId('session-user-1')?.id).toBe(channel.id)
      expect(restartedService.findBySessionId('session-user-2')?.id).toBe(channel.id)
    })
  })
})
