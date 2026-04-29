/**
 * Assistant Service - handles assistant CRUD operations
 *
 * Provides business logic for:
 * - Assistant CRUD operations
 * - Listing with optional filters
 */

import { application } from '@application'
import { assistantTable } from '@data/db/schemas/assistant'
import { assistantKnowledgeBaseTable, assistantMcpServerTable } from '@data/db/schemas/assistantRelations'
import type { DbType } from '@data/db/types'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateAssistantDto, ListAssistantsQuery, UpdateAssistantDto } from '@shared/data/api/schemas/assistants'
import { type Assistant, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { UniqueModelId } from '@shared/data/types/model'
import { and, asc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'

import { tagService } from './TagService'
import { nullsToUndefined, timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:AssistantService')

type AssistantRow = typeof assistantTable.$inferSelect

type AssistantRelationIds = Pick<Assistant, 'mcpServerIds' | 'knowledgeBaseIds'>

function createEmptyRelations(): AssistantRelationIds {
  return {
    mcpServerIds: [],
    knowledgeBaseIds: []
  }
}

function rowToAssistant(row: AssistantRow, relations: AssistantRelationIds = createEmptyRelations()): Assistant {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    // Preserve the T | null contract: `modelId` is legitimately nullable (R3 exception).
    modelId: row.modelId as UniqueModelId | null,
    mcpServerIds: relations.mcpServerIds,
    knowledgeBaseIds: relations.knowledgeBaseIds,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
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

    const [mcpServerRows, knowledgeBaseRows] = await Promise.all([
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

    for (const row of mcpServerRows) {
      relationMap.get(row.assistantId)?.mcpServerIds.push(row.mcpServerId)
    }
    for (const row of knowledgeBaseRows) {
      relationMap.get(row.assistantId)?.knowledgeBaseIds.push(row.knowledgeBaseId)
    }

    return relationMap
  }

  /**
   * Get an assistant by ID.
   * @param options.includeDeleted - If true, also returns soft-deleted assistants (for historical display)
   */
  async getById(id: string, options?: { includeDeleted?: boolean }): Promise<Assistant> {
    const conditions = [eq(assistantTable.id, id)]
    if (!options?.includeDeleted) {
      conditions.push(isNull(assistantTable.deletedAt))
    }
    const [row] = await this.db
      .select()
      .from(assistantTable)
      .where(and(...conditions))
      .limit(1)
    if (!row) {
      throw DataApiErrorFactory.notFound('Assistant', id)
    }
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
    const page = query.page ?? 1
    const limit = Math.min(query.limit ?? 100, 500)
    const offset = (page - 1) * limit

    const [rows, [{ count }]] = await Promise.all([
      this.db
        .select()
        .from(assistantTable)
        .where(whereClause)
        .orderBy(asc(assistantTable.createdAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ count: sql<number>`count(*)` }).from(assistantTable).where(whereClause)
    ])

    const relations = await this.getRelationIdsByAssistantIds(rows.map((row) => row.id))
    const items = rows.map((row) => rowToAssistant(row, relations.get(row.id)))

    return {
      items,
      total: Number(count),
      page
    }
  }

  /**
   * Create a new assistant
   */
  async create(dto: CreateAssistantDto): Promise<Assistant> {
    this.validateName(dto.name)

    const row = await this.db.transaction(async (tx) => {
      // Split column fields from relation arrays — relations are synced via junction tables.
      // `prompt` / `description` stay omitted when undefined so the DB DEFAULT '' takes over.
      // `emoji` and `settings` are filled here — Service is the single source of truth for
      // their product-chosen / tunable defaults (spec § Decision Matrix 2).
      const { mcpServerIds, knowledgeBaseIds, ...columnDto } = dto
      const insertValues: typeof assistantTable.$inferInsert = {
        ...columnDto,
        emoji: dto.emoji ?? '🌟',
        settings: dto.settings ?? DEFAULT_ASSISTANT_SETTINGS
      }

      const [inserted] = await tx.insert(assistantTable).values(insertValues).returning()

      // Insert junction table rows
      await this.syncRelations(tx, inserted.id, { mcpServerIds, knowledgeBaseIds })

      return inserted
    })

    logger.info('Created assistant', { id: row.id, name: row.name })

    return rowToAssistant(row, {
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
    const { mcpServerIds, knowledgeBaseIds, ...columnFields } = dto
    const updates = Object.fromEntries(Object.entries(columnFields).filter(([, v]) => v !== undefined)) as Partial<
      typeof assistantTable.$inferInsert
    >
    const hasColumnUpdates = Object.keys(updates).length > 0
    const hasRelationUpdates = mcpServerIds !== undefined || knowledgeBaseIds !== undefined

    if (!hasColumnUpdates && !hasRelationUpdates) {
      return current
    }

    const nextRelations: AssistantRelationIds = {
      mcpServerIds: mcpServerIds ?? current.mcpServerIds,
      knowledgeBaseIds: knowledgeBaseIds ?? current.knowledgeBaseIds
    }

    const row = await this.db.transaction(async (tx) => {
      let updated: AssistantRow | undefined
      if (hasColumnUpdates) {
        ;[updated] = await tx.update(assistantTable).set(updates).where(eq(assistantTable.id, id)).returning()
      }

      // Sync junction table rows if relation fields are provided
      await this.syncRelations(tx, id, { mcpServerIds, knowledgeBaseIds })

      return updated
    })

    logger.info('Updated assistant', { id, changes: Object.keys(dto) })

    return row ? rowToAssistant(row, nextRelations) : { ...current, ...nextRelations }
  }

  /**
   * Soft-delete an assistant (sets deletedAt timestamp).
   * The row is preserved so topic.assistantId FK remains valid
   * and junction table data (mcpServers, knowledgeBases) is retained.
   * Tag bindings are intentionally removed during delete, so restoring a
   * soft-deleted assistant does not restore its previous tags.
   */
  async delete(id: string): Promise<void> {
    await this.getActiveRowById(id)

    await this.db.transaction(async (tx) => {
      await tx.update(assistantTable).set({ deletedAt: Date.now() }).where(eq(assistantTable.id, id))
      await tagService.purgeForEntity(tx, 'assistant', id)
    })

    logger.info('Soft-deleted assistant', { id })
  }

  /**
   * Sync junction table rows for an assistant.
   * If an array is provided, it replaces all existing rows (delete + insert).
   * If undefined, the existing rows are left unchanged.
   * Runs within the caller's transaction for atomicity.
   */
  private async syncRelations(
    tx: Pick<DbType, 'delete' | 'insert' | 'select'>,
    assistantId: string,
    dto: { mcpServerIds?: string[]; knowledgeBaseIds?: string[] }
  ): Promise<void> {
    if (dto.mcpServerIds !== undefined) {
      const existing = await tx
        .select({ mcpServerId: assistantMcpServerTable.mcpServerId })
        .from(assistantMcpServerTable)
        .where(eq(assistantMcpServerTable.assistantId, assistantId))
      const existingIds = new Set(existing.map((r) => r.mcpServerId))
      const desiredIds = new Set(dto.mcpServerIds)

      const removeIds = existing.filter((r) => !desiredIds.has(r.mcpServerId)).map((r) => r.mcpServerId)
      const toAdd = dto.mcpServerIds.filter((id) => !existingIds.has(id))

      if (removeIds.length > 0) {
        await tx
          .delete(assistantMcpServerTable)
          .where(
            and(
              eq(assistantMcpServerTable.assistantId, assistantId),
              inArray(assistantMcpServerTable.mcpServerId, removeIds)
            )
          )
      }
      if (toAdd.length > 0) {
        await tx.insert(assistantMcpServerTable).values(toAdd.map((mcpServerId) => ({ assistantId, mcpServerId })))
      }
    }

    if (dto.knowledgeBaseIds !== undefined) {
      const existing = await tx
        .select({ knowledgeBaseId: assistantKnowledgeBaseTable.knowledgeBaseId })
        .from(assistantKnowledgeBaseTable)
        .where(eq(assistantKnowledgeBaseTable.assistantId, assistantId))
      const existingIds = new Set(existing.map((r) => r.knowledgeBaseId))
      const desiredIds = new Set(dto.knowledgeBaseIds)

      const removeIds = existing.filter((r) => !desiredIds.has(r.knowledgeBaseId)).map((r) => r.knowledgeBaseId)
      const toAdd = dto.knowledgeBaseIds.filter((id) => !existingIds.has(id))

      if (removeIds.length > 0) {
        await tx
          .delete(assistantKnowledgeBaseTable)
          .where(
            and(
              eq(assistantKnowledgeBaseTable.assistantId, assistantId),
              inArray(assistantKnowledgeBaseTable.knowledgeBaseId, removeIds)
            )
          )
      }
      if (toAdd.length > 0) {
        await tx
          .insert(assistantKnowledgeBaseTable)
          .values(toAdd.map((knowledgeBaseId) => ({ assistantId, knowledgeBaseId })))
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
