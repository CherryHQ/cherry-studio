/**
 * Assistant Service - handles assistant CRUD operations
 *
 * Provides business logic for:
 * - Assistant CRUD operations
 * - Listing with optional filters
 */

import { assistantTable } from '@data/db/schemas/assistant'
import {
  assistantKnowledgeBaseTable,
  assistantMcpServerTable,
  assistantModelTable
} from '@data/db/schemas/assistantRelations'
import type { DbType } from '@data/db/types'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateAssistantDto, ListAssistantsQuery, UpdateAssistantDto } from '@shared/data/api/schemas/assistants'
import type { Assistant } from '@shared/data/types/assistant'
import { and, asc, eq, inArray, isNull, type SQL } from 'drizzle-orm'

import { stripNulls } from './utils'

const logger = loggerService.withContext('DataApi:AssistantService')

type AssistantRow = typeof assistantTable.$inferSelect

type AssistantRelationIds = Pick<Assistant, 'modelIds' | 'mcpServerIds' | 'knowledgeBaseIds'>

function createEmptyRelations(): AssistantRelationIds {
  return {
    modelIds: [],
    mcpServerIds: [],
    knowledgeBaseIds: []
  }
}

/**
 * Convert database row to Assistant entity
 */
function rowToAssistant(row: AssistantRow, relations: AssistantRelationIds = createEmptyRelations()): Assistant {
  const clean = stripNulls(row)
  return {
    ...clean,
    settings: clean.settings ?? ({} as Assistant['settings']),
    modelIds: relations.modelIds,
    mcpServerIds: relations.mcpServerIds,
    knowledgeBaseIds: relations.knowledgeBaseIds,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
  }
}

export class AssistantDataService {
  private get db() {
    return application.get('DbService').getDb()
  }

  private async getActiveRowById(id: string): Promise<AssistantRow> {
    const [row] = await this.db
      .select()
      .from(assistantTable)
      .where(and(eq(assistantTable.id, id), isNull(assistantTable.deletedAt)))
      .limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Assistant', id)
    }

    return row
  }

  private async getRelationIdsByAssistantIds(assistantIds: string[]): Promise<Map<string, AssistantRelationIds>> {
    const relationMap = new Map<string, AssistantRelationIds>()

    if (assistantIds.length === 0) {
      return relationMap
    }

    for (const assistantId of assistantIds) {
      relationMap.set(assistantId, createEmptyRelations())
    }

    const [modelRows, mcpServerRows, knowledgeBaseRows] = await Promise.all([
      this.db
        .select({ assistantId: assistantModelTable.assistantId, modelId: assistantModelTable.modelId })
        .from(assistantModelTable)
        .where(inArray(assistantModelTable.assistantId, assistantIds))
        .orderBy(asc(assistantModelTable.assistantId), asc(assistantModelTable.createdAt)),
      this.db
        .select({ assistantId: assistantMcpServerTable.assistantId, mcpServerId: assistantMcpServerTable.mcpServerId })
        .from(assistantMcpServerTable)
        .where(inArray(assistantMcpServerTable.assistantId, assistantIds))
        .orderBy(asc(assistantMcpServerTable.assistantId), asc(assistantMcpServerTable.createdAt)),
      this.db
        .select({
          assistantId: assistantKnowledgeBaseTable.assistantId,
          knowledgeBaseId: assistantKnowledgeBaseTable.knowledgeBaseId
        })
        .from(assistantKnowledgeBaseTable)
        .where(inArray(assistantKnowledgeBaseTable.assistantId, assistantIds))
        .orderBy(asc(assistantKnowledgeBaseTable.assistantId), asc(assistantKnowledgeBaseTable.createdAt))
    ])

    for (const row of modelRows) {
      relationMap.get(row.assistantId)?.modelIds.push(row.modelId)
    }
    for (const row of mcpServerRows) {
      relationMap.get(row.assistantId)?.mcpServerIds.push(row.mcpServerId)
    }
    for (const row of knowledgeBaseRows) {
      relationMap.get(row.assistantId)?.knowledgeBaseIds.push(row.knowledgeBaseId)
    }

    return relationMap
  }

  /**
   * Get an assistant by ID
   */
  async getById(id: string): Promise<Assistant> {
    const row = await this.getActiveRowById(id)
    const relations = await this.getRelationIdsByAssistantIds([id])
    return rowToAssistant(row, relations.get(id))
  }

  /**
   * List assistants with optional filters
   */
  async list(query: ListAssistantsQuery): Promise<{ items: Assistant[]; total: number; page: number }> {
    const conditions: SQL[] = [isNull(assistantTable.deletedAt)]
    if (query.id !== undefined) {
      conditions.push(eq(assistantTable.id, query.id))
    }

    const whereClause = and(...conditions)

    // No LIMIT/OFFSET — assistant count is small enough to return all at once.
    // total is derived from result length; page is always 1.
    const rows = await this.db.select().from(assistantTable).where(whereClause).orderBy(asc(assistantTable.createdAt))
    const relations = await this.getRelationIdsByAssistantIds(rows.map((row) => row.id))
    const items = rows.map((row) => rowToAssistant(row, relations.get(row.id)))

    return {
      items,
      total: items.length,
      page: 1
    }
  }

  /**
   * Create a new assistant
   */
  async create(dto: CreateAssistantDto): Promise<Assistant> {
    this.validateName(dto.name)

    const row = await this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(assistantTable)
        .values({
          name: dto.name,
          prompt: dto.prompt,
          emoji: dto.emoji,
          description: dto.description,
          settings: dto.settings
        })
        .returning()

      // Insert junction table rows
      await this.syncRelations(tx, inserted.id, dto)

      return inserted
    })

    logger.info('Created assistant', { id: row.id, name: row.name })

    return rowToAssistant(row, {
      modelIds: dto.modelIds ?? [],
      mcpServerIds: dto.mcpServerIds ?? [],
      knowledgeBaseIds: dto.knowledgeBaseIds ?? []
    })
  }

  /**
   * Update an existing assistant
   */
  async update(id: string, dto: UpdateAssistantDto): Promise<Assistant> {
    const current = await this.getById(id)

    if (dto.name !== undefined) {
      this.validateName(dto.name)
    }

    // Strip relation fields — these are synced to junction tables, not assistant columns
    const { modelIds, mcpServerIds, knowledgeBaseIds, ...columnFields } = dto
    const updates = Object.fromEntries(Object.entries(columnFields).filter(([, v]) => v !== undefined)) as Partial<
      typeof assistantTable.$inferInsert
    >
    const hasColumnUpdates = Object.keys(updates).length > 0
    const hasRelationUpdates = modelIds !== undefined || mcpServerIds !== undefined || knowledgeBaseIds !== undefined

    if (!hasColumnUpdates && !hasRelationUpdates) {
      return current
    }

    const nextRelations: AssistantRelationIds = {
      modelIds: modelIds ?? current.modelIds,
      mcpServerIds: mcpServerIds ?? current.mcpServerIds,
      knowledgeBaseIds: knowledgeBaseIds ?? current.knowledgeBaseIds
    }

    const row = await this.db.transaction(async (tx) => {
      let updated: AssistantRow | undefined
      if (hasColumnUpdates) {
        ;[updated] = await tx.update(assistantTable).set(updates).where(eq(assistantTable.id, id)).returning()
      }

      // Sync junction table rows if relation fields are provided
      await this.syncRelations(tx, id, { modelIds, mcpServerIds, knowledgeBaseIds })

      return updated
    })

    logger.info('Updated assistant', { id, changes: Object.keys(dto) })

    return row ? rowToAssistant(row, nextRelations) : { ...current, ...nextRelations }
  }

  /**
   * Soft-delete an assistant (sets deletedAt timestamp).
   * The row is preserved so topic.assistantId FK remains valid
   * and junction table data (models, mcpServers, knowledgeBases) is retained.
   */
  async delete(id: string): Promise<void> {
    await this.getActiveRowById(id)

    await this.db.update(assistantTable).set({ deletedAt: Date.now() }).where(eq(assistantTable.id, id))

    logger.info('Soft-deleted assistant', { id })
  }

  /**
   * Sync junction table rows for an assistant.
   * If an array is provided, it replaces all existing rows (delete + insert).
   * If undefined, the existing rows are left unchanged.
   * Runs within the caller's transaction for atomicity.
   */
  private async syncRelations(
    tx: Pick<DbType, 'delete' | 'insert'>,
    assistantId: string,
    dto: { modelIds?: string[]; mcpServerIds?: string[]; knowledgeBaseIds?: string[] }
  ): Promise<void> {
    if (dto.modelIds !== undefined) {
      await tx.delete(assistantModelTable).where(eq(assistantModelTable.assistantId, assistantId))
      if (dto.modelIds.length > 0) {
        await tx.insert(assistantModelTable).values(dto.modelIds.map((modelId) => ({ assistantId, modelId })))
      }
    }

    if (dto.mcpServerIds !== undefined) {
      await tx.delete(assistantMcpServerTable).where(eq(assistantMcpServerTable.assistantId, assistantId))
      if (dto.mcpServerIds.length > 0) {
        await tx
          .insert(assistantMcpServerTable)
          .values(dto.mcpServerIds.map((mcpServerId) => ({ assistantId, mcpServerId })))
      }
    }

    if (dto.knowledgeBaseIds !== undefined) {
      await tx.delete(assistantKnowledgeBaseTable).where(eq(assistantKnowledgeBaseTable.assistantId, assistantId))
      if (dto.knowledgeBaseIds.length > 0) {
        await tx
          .insert(assistantKnowledgeBaseTable)
          .values(dto.knowledgeBaseIds.map((knowledgeBaseId) => ({ assistantId, knowledgeBaseId })))
      }
    }
  }

  private validateName(name: string): void {
    if (!name?.trim()) {
      throw DataApiErrorFactory.validation({ name: ['Name is required'] })
    }
  }
}

export const assistantDataService = new AssistantDataService()
