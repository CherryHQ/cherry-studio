import { agentChannelService } from '@data/services/AgentChannelService'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

const TELEGRAM_CONFIG = { bot_token: 'test-token-123', allowed_chat_ids: [] }

describe('AgentChannelService', () => {
  setupTestDatabase()

  describe('createChannel', () => {
    it('creates a channel and returns the entity', async () => {
      const channel = await agentChannelService.createChannel({
        type: 'telegram',
        name: 'My Bot',
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
      const channel = await agentChannelService.createChannel({
        type: 'telegram',
        name: 'Draft Bot',
        config: TELEGRAM_CONFIG,
        isActive: false
      })

      expect(channel.isActive).toBe(false)
    })
  })

  describe('getChannel', () => {
    it('returns channel by id', async () => {
      const created = await agentChannelService.createChannel({
        type: 'telegram',
        name: 'Get Test',
        config: TELEGRAM_CONFIG
      })

      const found = await agentChannelService.getChannel(created.id)
      expect(found).not.toBeNull()
      expect(found!.id).toBe(created.id)
    })

    it('returns null for unknown id', async () => {
      const result = await agentChannelService.getChannel('nonexistent-id')
      expect(result).toBeNull()
    })
  })

  describe('listChannels', () => {
    it('lists all channels when no filters applied', async () => {
      await agentChannelService.createChannel({ type: 'telegram', name: 'TG', config: TELEGRAM_CONFIG })
      await agentChannelService.createChannel({ type: 'discord', name: 'DC', config: { bot_token: 'dc-token' } })

      const channels = await agentChannelService.listChannels()
      expect(channels.length).toBeGreaterThanOrEqual(2)
    })

    it('filters by type', async () => {
      await agentChannelService.createChannel({ type: 'telegram', name: 'TG Filter', config: TELEGRAM_CONFIG })

      const channels = await agentChannelService.listChannels({ type: 'telegram' })
      expect(channels.every((c) => c.type === 'telegram')).toBe(true)
    })
  })

  describe('updateChannel', () => {
    it('updates channel name', async () => {
      const channel = await agentChannelService.createChannel({
        type: 'telegram',
        name: 'Before',
        config: TELEGRAM_CONFIG
      })

      const updated = await agentChannelService.updateChannel(channel.id, { name: 'After' })
      expect(updated!.name).toBe('After')
    })

    it('returns null when channel does not exist', async () => {
      const result = await agentChannelService.updateChannel('nonexistent', { name: 'x' })
      expect(result).toBeNull()
    })

    it('toggles isActive', async () => {
      const channel = await agentChannelService.createChannel({
        type: 'telegram',
        name: 'Toggle',
        config: TELEGRAM_CONFIG,
        isActive: true
      })

      const updated = await agentChannelService.updateChannel(channel.id, { isActive: false })
      expect(updated!.isActive).toBe(false)
    })
  })

  describe('deleteChannel', () => {
    it('deletes a channel and returns true', async () => {
      const channel = await agentChannelService.createChannel({
        type: 'telegram',
        name: 'To Delete',
        config: TELEGRAM_CONFIG
      })

      const deleted = await agentChannelService.deleteChannel(channel.id)
      expect(deleted).toBe(true)

      const found = await agentChannelService.getChannel(channel.id)
      expect(found).toBeNull()
    })

    it('returns false when channel does not exist', async () => {
      const result = await agentChannelService.deleteChannel('nonexistent')
      expect(result).toBe(false)
    })
  })
})
