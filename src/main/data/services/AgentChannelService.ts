import { application } from '@application'
import {
  type AgentChannelRow as ChannelRow,
  agentChannelTable as channelsTable,
  agentChannelTaskTable as channelTaskSubscriptionsTable,
  type InsertAgentChannelRow as InsertChannelRow
} from '@data/db/schemas/agentChannel'
import { nullsToUndefined, timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import type { ChannelConfig } from '@main/services/agents/services/channels/channelConfig'
import { DataApiErrorFactory } from '@shared/data/api'
import type { AgentChannelEntity, CreateAgentChannelDto } from '@shared/data/api/schemas/agentChannels'
import { and, eq, inArray } from 'drizzle-orm'

const logger = loggerService.withContext('ChannelService')

function normalizeChannelConfig(config: unknown): Record<string, unknown> {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {}
  const rest = { ...(config as Record<string, unknown>) }
  delete rest.type
  return rest
}

export class AgentChannelService {
  private rowToEntity(row: ChannelRow): AgentChannelEntity {
    const clean = nullsToUndefined(row)
    return {
      ...clean,
      type: row.type as AgentChannelEntity['type'],
      config: normalizeChannelConfig(row.config) as AgentChannelEntity['config'],
      permissionMode: (row.permissionMode ?? undefined) as AgentChannelEntity['permissionMode'],
      createdAt: timestampToISO(row.createdAt),
      updatedAt: timestampToISO(row.updatedAt)
    } as AgentChannelEntity
  }

  async createChannel(
    data:
      | CreateAgentChannelDto
      | {
          type: ChannelConfig['type']
          name: string
          agentId?: string | null
          config: ChannelConfig | Record<string, unknown>
          isActive?: boolean
          permissionMode?: string | null
        }
  ): Promise<AgentChannelEntity> {
    const database = application.get('DbService').getDb()

    const insertData: InsertChannelRow = {
      type: data.type,
      name: data.name,
      agentId: data.agentId,
      config: normalizeChannelConfig(data.config),
      isActive: data.isActive ?? true,
      permissionMode: data.permissionMode
    }

    const result = await database.insert(channelsTable).values(insertData).returning()

    if (!result[0]) {
      throw DataApiErrorFactory.invalidOperation('create channel', 'database insert returned no row')
    }

    logger.info('Channel created', { channelId: result[0].id, type: data.type })
    return this.rowToEntity(result[0])
  }

  async getChannel(id: string): Promise<AgentChannelEntity | null> {
    const database = application.get('DbService').getDb()
    const result = await database.select().from(channelsTable).where(eq(channelsTable.id, id)).limit(1)
    return result[0] ? this.rowToEntity(result[0]) : null
  }

  async findBySessionId(sessionId: string): Promise<AgentChannelEntity | null> {
    const database = application.get('DbService').getDb()
    const result = await database.select().from(channelsTable).where(eq(channelsTable.sessionId, sessionId)).limit(1)
    return result[0] ? this.rowToEntity(result[0]) : null
  }

  async listChannels(filters?: { agentId?: string; type?: string }): Promise<AgentChannelEntity[]> {
    const database = application.get('DbService').getDb()

    const agentCond = filters?.agentId ? eq(channelsTable.agentId, filters.agentId) : undefined
    const typeCond = filters?.type ? eq(channelsTable.type, filters.type) : undefined
    const where = agentCond && typeCond ? and(agentCond, typeCond) : (agentCond ?? typeCond)

    const rows = where
      ? await database.select().from(channelsTable).where(where)
      : await database.select().from(channelsTable)

    return rows.map((row) => this.rowToEntity(row))
  }

  /**
   * Add a chatId to the channel's activeChatIds if not already present.
   * Used to auto-track conversations when allowed_chat_ids is empty.
   */
  async addActiveChatId(channelId: string, chatId: string): Promise<void> {
    const channel = await this.getChannel(channelId)
    if (!channel) return

    const existing = channel.activeChatIds ?? []
    if (existing.includes(chatId)) return

    await this.updateChannel(channelId, { activeChatIds: [...existing, chatId] })
  }

  async updateChannel(
    id: string,
    updates: Partial<
      Pick<ChannelRow, 'name' | 'agentId' | 'sessionId' | 'config' | 'isActive' | 'activeChatIds' | 'permissionMode'>
    >
  ): Promise<AgentChannelEntity | null> {
    const database = application.get('DbService').getDb()
    const normalizedUpdates = {
      ...updates,
      ...(updates.config !== undefined ? { config: normalizeChannelConfig(updates.config) } : {})
    }
    const result = await database
      .update(channelsTable)
      .set(normalizedUpdates)
      .where(eq(channelsTable.id, id))
      .returning()

    if (!result[0]) {
      return null
    }

    logger.info('Channel updated', { channelId: id })
    return this.rowToEntity(result[0])
  }

  async deleteChannel(id: string): Promise<boolean> {
    const database = application.get('DbService').getDb()
    const result = await database.delete(channelsTable).where(eq(channelsTable.id, id)).returning()
    if (result.length > 0) {
      logger.info('Channel deleted', { channelId: id })
    }
    return result.length > 0
  }

  // ---- Task subscription methods ----

  async subscribeToTask(channelId: string, taskId: string): Promise<void> {
    const database = application.get('DbService').getDb()
    await database.insert(channelTaskSubscriptionsTable).values({ channelId, taskId }).onConflictDoNothing()
    logger.info('Channel subscribed to task', { channelId, taskId })
  }

  async unsubscribeFromTask(channelId: string, taskId: string): Promise<void> {
    const database = application.get('DbService').getDb()
    await database
      .delete(channelTaskSubscriptionsTable)
      .where(
        and(eq(channelTaskSubscriptionsTable.channelId, channelId), eq(channelTaskSubscriptionsTable.taskId, taskId))
      )
    logger.info('Channel unsubscribed from task', { channelId, taskId })
  }

  async getSubscribedChannels(taskId: string): Promise<AgentChannelEntity[]> {
    const database = application.get('DbService').getDb()
    const subs = await database
      .select({ channelId: channelTaskSubscriptionsTable.channelId })
      .from(channelTaskSubscriptionsTable)
      .where(eq(channelTaskSubscriptionsTable.taskId, taskId))

    if (subs.length === 0) return []

    const channelIds = subs.map((s) => s.channelId)
    const rows = await database.select().from(channelsTable).where(inArray(channelsTable.id, channelIds))
    return rows.map((row) => this.rowToEntity(row))
  }

  async getSubscribedTasks(channelId: string): Promise<string[]> {
    const database = application.get('DbService').getDb()
    const subs = await database
      .select({ taskId: channelTaskSubscriptionsTable.taskId })
      .from(channelTaskSubscriptionsTable)
      .where(eq(channelTaskSubscriptionsTable.channelId, channelId))
    return subs.map((s) => s.taskId)
  }
}

export const agentChannelService = new AgentChannelService()
