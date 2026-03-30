/**
 * Agent Data Service - handles agent and session CRUD operations
 *
 * Provides business logic for:
 * - Agent CRUD with soft delete
 * - Session CRUD (auto-creates topic, snapshots agent config)
 * - Session messages retrieval (via topic FK)
 */

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateAgentDto, CreateAgentSessionDto, UpdateAgentDto } from '@shared/data/api/schemas/agents'
import type { Agent, AgentSession } from '@shared/data/types/agent'
import type { Message } from '@shared/data/types/message'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:AgentDataService')

function stripNulls<T extends Record<string, unknown>>(obj: T): { [K in keyof T]: Exclude<T[K], null> } {
  const result = {} as Record<string, unknown>
  for (const [key, value] of Object.entries(obj)) {
    result[key] = value === null ? undefined : value
  }
  return result as { [K in keyof T]: Exclude<T[K], null> }
}

function rowToAgent(row: typeof agentTable.$inferSelect): Agent {
  const clean = stripNulls(row)
  return {
    ...clean,
    type: clean.type as Agent['type'],
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
  }
}

function rowToSession(row: typeof agentSessionTable.$inferSelect): AgentSession {
  const clean = stripNulls(row)
  return {
    ...clean,
    agentType: clean.agentType as AgentSession['agentType'],
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
  }
}

function rowToMessage(row: typeof messageTable.$inferSelect): Message {
  const clean = stripNulls(row)
  return {
    ...clean,
    role: clean.role as Message['role'],
    status: clean.status as Message['status'],
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
  }
}

export class AgentDataService {
  private get db() {
    return application.get('DbService').getDb()
  }

  // ── Agent CRUD ──────────────────────────────────────

  async getAgent(id: string): Promise<Agent> {
    const [row] = await this.db
      .select()
      .from(agentTable)
      .where(and(eq(agentTable.id, id), isNull(agentTable.deletedAt)))
      .limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Agent', id)
    }

    return rowToAgent(row)
  }

  async listAgents(query?: { page?: number; limit?: number; type?: string }) {
    const page = query?.page ?? 1
    const limit = query?.limit ?? 50
    const offset = (page - 1) * limit

    const conditions = [isNull(agentTable.deletedAt)]
    if (query?.type) {
      conditions.push(eq(agentTable.type, query.type))
    }

    const [rows, [countRow]] = await Promise.all([
      this.db
        .select()
        .from(agentTable)
        .where(and(...conditions))
        .orderBy(asc(agentTable.sortOrder))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(agentTable)
        .where(and(...conditions))
    ])

    return { items: rows.map(rowToAgent), total: countRow?.count ?? 0, page }
  }

  async createAgent(dto: CreateAgentDto): Promise<Agent> {
    const [row] = await this.db.insert(agentTable).values(dto).returning()
    logger.info('Created agent', { id: row.id, name: row.name })
    return rowToAgent(row)
  }

  async updateAgent(id: string, dto: UpdateAgentDto): Promise<Agent> {
    await this.getAgent(id)

    const [row] = await this.db.update(agentTable).set(dto).where(eq(agentTable.id, id)).returning()

    logger.info('Updated agent', { id, changes: Object.keys(dto) })
    return rowToAgent(row)
  }

  async deleteAgent(id: string): Promise<void> {
    await this.getAgent(id)

    // Soft delete
    await this.db.update(agentTable).set({ deletedAt: Date.now() }).where(eq(agentTable.id, id))

    logger.info('Soft-deleted agent', { id })
  }

  async reorderAgents(orderedIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.update(agentTable).set({ sortOrder: i }).where(eq(agentTable.id, orderedIds[i]))
      }
    })
    logger.info('Reordered agents', { count: orderedIds.length })
  }

  // ── Session CRUD ────────────────────────────────────

  async getSession(agentId: string, id: string): Promise<AgentSession> {
    const [row] = await this.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, id)).limit(1)

    if (!row || row.agentId !== agentId) {
      throw DataApiErrorFactory.notFound('AgentSession', id)
    }

    return rowToSession(row)
  }

  async listSessions(agentId: string, query?: { page?: number; limit?: number }) {
    const page = query?.page ?? 1
    const limit = query?.limit ?? 50
    const offset = (page - 1) * limit

    const [rows, [countRow]] = await Promise.all([
      this.db
        .select()
        .from(agentSessionTable)
        .where(eq(agentSessionTable.agentId, agentId))
        .orderBy(asc(agentSessionTable.sortOrder))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(agentSessionTable)
        .where(eq(agentSessionTable.agentId, agentId))
    ])

    return { items: rows.map(rowToSession), total: countRow?.count ?? 0, page }
  }

  async createSession(agentId: string, dto: CreateAgentSessionDto): Promise<AgentSession> {
    const agent = await this.getAgent(agentId)

    return await this.db.transaction(async (tx) => {
      // 1. Create topic (message container)
      const [topic] = await tx
        .insert(topicTable)
        .values({
          name: agent.name,
          sourceType: 'agent',
          assistantId: null
        })
        .returning()

      // 2. Create session (config snapshot from agent)
      const [session] = await tx
        .insert(agentSessionTable)
        .values({
          agentId,
          agentType: agent.type,
          topicId: topic.id,
          model: dto.model ?? agent.model,
          planModel: dto.planModel ?? agent.planModel ?? null,
          smallModel: dto.smallModel ?? agent.smallModel ?? null,
          accessiblePaths: dto.accessiblePaths ?? agent.accessiblePaths ?? null,
          instructions: dto.instructions ?? agent.instructions ?? null,
          mcps: dto.mcps ?? agent.mcps ?? null,
          allowedTools: dto.allowedTools ?? agent.allowedTools ?? null,
          slashCommands: dto.slashCommands ?? null,
          configuration: dto.configuration ?? agent.configuration ?? null
        })
        .returning()

      logger.info('Created session', { id: session.id, agentId, topicId: topic.id })
      return rowToSession(session)
    })
  }

  async deleteSession(agentId: string, id: string): Promise<void> {
    const session = await this.getSession(agentId, id)

    // Delete session (CASCADE to topic → CASCADE to messages)
    await this.db.delete(agentSessionTable).where(eq(agentSessionTable.id, session.id))

    logger.info('Deleted session', { id })
  }

  async reorderSessions(agentId: string, orderedIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx
          .update(agentSessionTable)
          .set({ sortOrder: i })
          .where(and(eq(agentSessionTable.id, orderedIds[i]), eq(agentSessionTable.agentId, agentId)))
      }
    })
    logger.info('Reordered sessions', { agentId, count: orderedIds.length })
  }

  // ── Messages (via topic) ────────────────────────────

  async getSessionMessages(agentId: string, sessionId: string): Promise<Message[]> {
    const session = await this.getSession(agentId, sessionId)

    const rows = await this.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.topicId, session.topicId))
      .orderBy(asc(messageTable.createdAt))

    return rows.map(rowToMessage)
  }
}

export const agentDataService = new AgentDataService()
