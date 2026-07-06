import { application } from '@application'
import {
  type AgentChannelRow as ChannelRow,
  agentChannelTable as channelsTable,
  agentChannelTaskTable as channelTaskSubscriptionsTable,
  type InsertAgentChannelRow as InsertChannelRow
} from '@data/db/schemas/agentChannel'
import type { DbOrTx } from '@data/db/types'
import { nullsToUndefined, timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { AgentChannelEntity, CreateAgentChannelDto } from '@shared/data/api/schemas/agentChannels'
import type { AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import type { ChannelConfig } from '@shared/data/types/channel'
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
      workspace: row.workspace,
      permissionMode: (row.permissionMode ?? undefined) as AgentChannelEntity['permissionMode'],
      createdAt: timestampToISO(row.createdAt),
      updatedAt: timestampToISO(row.updatedAt)
    } as AgentChannelEntity
  }

  createChannel(
    data:
      | CreateAgentChannelDto
      | {
          type: ChannelConfig['type']
          name: string
          agentId?: string | null
          workspace: AgentSessionWorkspaceSource
          config: ChannelConfig | Record<string, unknown>
          isActive?: boolean
          permissionMode?: string | null
        }
  ): AgentChannelEntity {
    const database = application.get('DbService').getDb()

    const insertData: InsertChannelRow = {
      type: data.type,
      name: data.name,
      agentId: data.agentId,
      workspace: data.workspace,
      config: normalizeChannelConfig(data.config),
      isActive: data.isActive ?? true,
      permissionMode: data.permissionMode
    }

    const result = database.insert(channelsTable).values(insertData).returning().all()

    if (!result[0]) {
      throw DataApiErrorFactory.invalidOperation('create channel', 'database insert returned no row')
    }

    logger.info('Channel created', { channelId: result[0].id, type: data.type })
    return this.rowToEntity(result[0])
  }

  getChannel(id: string): AgentChannelEntity | null {
    const database = application.get('DbService').getDb()
    const result = database.select().from(channelsTable).where(eq(channelsTable.id, id)).limit(1).all()
    return result[0] ? this.rowToEntity(result[0]) : null
  }

  findBySessionId(sessionId: string): AgentChannelEntity | null {
    const database = application.get('DbService').getDb()
    const result = database.select().from(channelsTable).where(eq(channelsTable.sessionId, sessionId)).limit(1).all()
    return result[0] ? this.rowToEntity(result[0]) : null
  }

  listChannels(filters?: { agentId?: string; type?: string }): AgentChannelEntity[] {
    const database = application.get('DbService').getDb()

    const agentCond = filters?.agentId ? eq(channelsTable.agentId, filters.agentId) : undefined
    const typeCond = filters?.type ? eq(channelsTable.type, filters.type) : undefined
    const where = agentCond && typeCond ? and(agentCond, typeCond) : (agentCond ?? typeCond)

    const rows = where
      ? database.select().from(channelsTable).where(where).all()
      : database.select().from(channelsTable).all()

    return rows.map((row) => this.rowToEntity(row))
  }

  /**
   * Add a chatId to the channel's activeChatIds if not already present.
   * Used to auto-track conversations when allowed_chat_ids is empty.
   */
  addActiveChatId(channelId: string, chatId: string): void {
    const channel = this.getChannel(channelId)
    if (!channel) return

    const existing = channel.activeChatIds ?? []
    if (existing.includes(chatId)) return

    this.updateChannel(channelId, { activeChatIds: [...existing, chatId] })
  }

  updateChannel(
    id: string,
    updates: Partial<
      Pick<
        ChannelRow,
        'name' | 'agentId' | 'sessionId' | 'config' | 'isActive' | 'activeChatIds' | 'permissionMode'
      > & { workspace: AgentSessionWorkspaceSource }
    >
  ): AgentChannelEntity | null {
    const database = application.get('DbService').getDb()
    const normalizedUpdates = {
      ...updates,
      ...(updates.config !== undefined ? { config: normalizeChannelConfig(updates.config) } : {})
    }
    const result = database
      .update(channelsTable)
      .set(normalizedUpdates)
      .where(eq(channelsTable.id, id))
      .returning()
      .all()

    if (!result[0]) {
      return null
    }

    logger.info('Channel updated', { channelId: id })
    return this.rowToEntity(result[0])
  }

  deleteChannel(id: string): boolean {
    const database = application.get('DbService').getDb()
    const result = database.delete(channelsTable).where(eq(channelsTable.id, id)).returning().all()
    if (result.length > 0) {
      logger.info('Channel deleted', { channelId: id })
    }
    return result.length > 0
  }

  // ---- Task subscription methods ----

  subscribeToTask(channelId: string, taskId: string): void {
    const database = application.get('DbService').getDb()
    database.insert(channelTaskSubscriptionsTable).values({ channelId, taskId }).onConflictDoNothing().run()
    logger.info('Channel subscribed to task', { channelId, taskId })
  }

  unsubscribeFromTask(channelId: string, taskId: string): void {
    const database = application.get('DbService').getDb()
    database
      .delete(channelTaskSubscriptionsTable)
      .where(
        and(eq(channelTaskSubscriptionsTable.channelId, channelId), eq(channelTaskSubscriptionsTable.taskId, taskId))
      )
      .run()
    logger.info('Channel unsubscribed from task', { channelId, taskId })
  }

  replaceTaskSubscriptions(taskId: string, channelIds: readonly string[]): void {
    application.get('DbService').withWriteTx((tx) => this.replaceTaskSubscriptionsTx(tx, taskId, channelIds))
    logger.info('Channel task subscriptions replaced', { taskId, channelCount: channelIds.length })
  }

  replaceTaskSubscriptionsTx(tx: DbOrTx, taskId: string, channelIds: readonly string[]): void {
    tx.delete(channelTaskSubscriptionsTable).where(eq(channelTaskSubscriptionsTable.taskId, taskId)).run()
    if (channelIds.length > 0) {
      tx.insert(channelTaskSubscriptionsTable)
        .values(channelIds.map((channelId) => ({ channelId, taskId })))
        .onConflictDoNothing()
        .run()
    }
  }

  getSubscribedChannels(taskId: string): AgentChannelEntity[] {
    const database = application.get('DbService').getDb()
    const subs = database
      .select({ channelId: channelTaskSubscriptionsTable.channelId })
      .from(channelTaskSubscriptionsTable)
      .where(eq(channelTaskSubscriptionsTable.taskId, taskId))
      .all()

    if (subs.length === 0) return []

    const channelIds = subs.map((s) => s.channelId)
    const rows = database.select().from(channelsTable).where(inArray(channelsTable.id, channelIds)).all()
    return rows.map((row) => this.rowToEntity(row))
  }

  getSubscribedTasks(channelId: string): string[] {
    const database = application.get('DbService').getDb()
    const subs = database
      .select({ taskId: channelTaskSubscriptionsTable.taskId })
      .from(channelTaskSubscriptionsTable)
      .where(eq(channelTaskSubscriptionsTable.channelId, channelId))
      .all()
    return subs.map((s) => s.taskId)
  }
}

export const agentChannelService = new AgentChannelService()
