/**
 * Knowledge Base Service (DataApi v2).
 *
 * Handles CRUD operations for knowledge bases stored in SQLite.
 */

import { application } from '@application'
import { fileRefTable } from '@data/db/schemas/file'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import type {
  KnowledgeBaseListItem,
  ListKnowledgeBasesQuery,
  UpdateKnowledgeBaseDto
} from '@shared/data/api/schemas/knowledges'
import type { EntitySearchItem } from '@shared/data/api/schemas/search'
import { knowledgeItemSourceType } from '@shared/data/types/file/ref'
import {
  type CreateKnowledgeBaseDto,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
  DEFAULT_KNOWLEDGE_BASE_STATUS,
  DEFAULT_KNOWLEDGE_CHUNK_SEPARATOR,
  DEFAULT_KNOWLEDGE_CHUNK_STRATEGY,
  DEFAULT_KNOWLEDGE_SEARCH_MODE,
  type KnowledgeBase,
  KnowledgeBaseSchema
} from '@shared/data/types/knowledge'
import { and, asc, count as sqlCount, desc, eq, gte, ne, type SQL, sql } from 'drizzle-orm'

import { nullsToUndefined, timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:KnowledgeBaseService')

type KnowledgeBaseRow = typeof knowledgeBaseTable.$inferSelect
type KnowledgeBaseEntitySearchItem = Extract<EntitySearchItem, { type: 'knowledge-base' }>

function validateKnowledgeBaseConfig(config: {
  chunkSize: number
  chunkOverlap: number
  chunkStrategy?: string | null
  chunkSeparator?: string | null
  searchMode?: string | null
  hybridAlpha?: number | null
}): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {}

  if (config.chunkOverlap >= config.chunkSize) {
    fieldErrors.chunkOverlap = ['Chunk overlap must be smaller than chunk size']
  }

  if (config.chunkStrategy === 'delimiter' && !config.chunkSeparator) {
    fieldErrors.chunkSeparator = ['Separator is required when chunk strategy is delimiter']
  }

  if (config.hybridAlpha != null && config.searchMode !== 'hybrid') {
    fieldErrors.hybridAlpha = ['Hybrid alpha requires hybrid search mode']
  }

  return fieldErrors
}

function rowToKnowledgeBase(row: KnowledgeBaseRow): KnowledgeBase {
  const clean = nullsToUndefined(row)
  return KnowledgeBaseSchema.parse({
    ...clean,
    groupId: row.groupId,
    dimensions: row.dimensions,
    embeddingModelId: row.embeddingModelId,
    error: row.error,
    rerankModelId: row.rerankModelId,
    fileProcessorId: row.fileProcessorId,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  })
}

function buildSearchPredicate(search: string | undefined): SQL | undefined {
  const trimmed = search?.trim()
  if (!trimmed) return undefined

  const pattern = `%${trimmed.replace(/[\\%_]/g, '\\$&')}%`
  return sql`${knowledgeBaseTable.name} LIKE ${pattern} ESCAPE '\\'`
}

export class KnowledgeBaseService {
  private get db() {
    return application.get('DbService').getDb()
  }

  async search(query: { q: string; limit: number; updatedAtFrom?: number }): Promise<KnowledgeBaseEntitySearchItem[]> {
    const conditions: SQL[] = []
    const search = buildSearchPredicate(query.q)
    if (search) conditions.push(search)
    if (query.updatedAtFrom !== undefined) {
      conditions.push(gte(knowledgeBaseTable.updatedAt, query.updatedAtFrom))
    }

    const rows = await this.db
      .select({
        id: knowledgeBaseTable.id,
        name: knowledgeBaseTable.name,
        updatedAt: knowledgeBaseTable.updatedAt
      })
      .from(knowledgeBaseTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(knowledgeBaseTable.updatedAt), asc(knowledgeBaseTable.id))
      .limit(query.limit)

    return rows.map((row) => ({
      type: 'knowledge-base',
      id: row.id,
      title: row.name,
      updatedAt: timestampToISO(row.updatedAt),
      target: { knowledgeBaseId: row.id }
    }))
  }

  async list(query: ListKnowledgeBasesQuery): Promise<OffsetPaginationResponse<KnowledgeBaseListItem>> {
    const { page, limit } = query
    const offset = (page - 1) * limit
    const conditions: SQL[] = []
    const search = buildSearchPredicate(query.search)
    if (search) conditions.push(search)
    if (query.updatedAtFrom !== undefined) {
      conditions.push(gte(knowledgeBaseTable.updatedAt, Date.parse(query.updatedAtFrom)))
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined
    const sortBy = query.sortBy ?? 'createdAt'
    const sortOrder = query.sortOrder ?? 'desc'
    const orderFn = sortOrder === 'asc' ? asc : desc
    const sortByToColumn = {
      createdAt: knowledgeBaseTable.createdAt,
      updatedAt: knowledgeBaseTable.updatedAt,
      name: knowledgeBaseTable.name
    } as const
    const sortColumn = sortByToColumn[sortBy]
    const [rows, [{ count }]] = await Promise.all([
      this.db
        .select({
          base: knowledgeBaseTable,
          itemCount: sqlCount(knowledgeItemTable.id)
        })
        .from(knowledgeBaseTable)
        .leftJoin(
          knowledgeItemTable,
          and(eq(knowledgeItemTable.baseId, knowledgeBaseTable.id), ne(knowledgeItemTable.status, 'deleting'))
        )
        .groupBy(knowledgeBaseTable.id)
        .where(whereClause)
        .orderBy(orderFn(sortColumn), orderFn(knowledgeBaseTable.id))
        .limit(limit)
        .offset(offset),
      this.db.select({ count: sql<number>`count(*)` }).from(knowledgeBaseTable).where(whereClause)
    ])

    return {
      items: rows.map((row) => ({
        ...rowToKnowledgeBase(row.base),
        itemCount: row.itemCount
      })),
      total: count,
      page
    }
  }

  async getById(id: string): Promise<KnowledgeBase> {
    const [row] = await this.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('KnowledgeBase', id)
    }

    return rowToKnowledgeBase(row)
  }

  async create(dto: CreateKnowledgeBaseDto): Promise<KnowledgeBase> {
    const createConfig = {
      chunkSize: dto.chunkSize ?? DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
      chunkOverlap: dto.chunkOverlap ?? DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
      chunkStrategy: dto.chunkStrategy ?? DEFAULT_KNOWLEDGE_CHUNK_STRATEGY,
      chunkSeparator: dto.chunkSeparator ?? DEFAULT_KNOWLEDGE_CHUNK_SEPARATOR,
      searchMode: dto.searchMode ?? DEFAULT_KNOWLEDGE_SEARCH_MODE,
      hybridAlpha: dto.hybridAlpha
    }
    const createFieldErrors = validateKnowledgeBaseConfig(createConfig)
    if (Object.keys(createFieldErrors).length > 0) {
      throw DataApiErrorFactory.validation(createFieldErrors)
    }

    const createValues: Omit<typeof knowledgeBaseTable.$inferInsert, 'id' | 'createdAt' | 'updatedAt'> = {
      name: dto.name.trim(),
      groupId: dto.groupId ?? null,
      dimensions: dto.dimensions,
      embeddingModelId: dto.embeddingModelId.trim(),
      status: DEFAULT_KNOWLEDGE_BASE_STATUS,
      error: null,
      rerankModelId: dto.rerankModelId ?? null,
      fileProcessorId: dto.fileProcessorId ?? null,
      chunkSize: createConfig.chunkSize,
      chunkOverlap: createConfig.chunkOverlap,
      chunkStrategy: createConfig.chunkStrategy,
      chunkSeparator: createConfig.chunkSeparator,
      threshold: dto.threshold ?? null,
      documentCount: dto.documentCount ?? null,
      searchMode: createConfig.searchMode,
      hybridAlpha: createConfig.hybridAlpha ?? null
    }

    const dbService = application.get('DbService')
    const row = await dbService.withWriteTx(async (tx) => {
      const [inserted] = await tx.insert(knowledgeBaseTable).values(createValues).returning()
      return inserted
    })

    logger.info('Created knowledge base', { id: row.id, name: row.name })
    return rowToKnowledgeBase(row)
  }

  async update(id: string, dto: UpdateKnowledgeBaseDto): Promise<KnowledgeBase> {
    const existing = await this.getById(id)

    const nextConfig: {
      chunkSize: number
      chunkOverlap: number
      chunkStrategy: KnowledgeBase['chunkStrategy']
      chunkSeparator: KnowledgeBase['chunkSeparator']
      searchMode: KnowledgeBase['searchMode']
      hybridAlpha: number | null | undefined
    } = {
      chunkSize: dto.chunkSize !== undefined ? dto.chunkSize : existing.chunkSize,
      chunkOverlap: dto.chunkOverlap !== undefined ? dto.chunkOverlap : existing.chunkOverlap,
      chunkStrategy: dto.chunkStrategy !== undefined ? dto.chunkStrategy : existing.chunkStrategy,
      chunkSeparator: dto.chunkSeparator !== undefined ? dto.chunkSeparator : existing.chunkSeparator,
      searchMode: dto.searchMode !== undefined ? dto.searchMode : existing.searchMode,
      hybridAlpha: dto.hybridAlpha !== undefined ? dto.hybridAlpha : existing.hybridAlpha
    }

    if (dto.searchMode !== undefined && dto.searchMode !== 'hybrid' && dto.hybridAlpha === undefined) {
      nextConfig.hybridAlpha = null
    }

    const updateFieldErrors = validateKnowledgeBaseConfig(nextConfig)
    if (Object.keys(updateFieldErrors).length > 0) {
      throw DataApiErrorFactory.validation(updateFieldErrors)
    }

    const updates: Partial<typeof knowledgeBaseTable.$inferInsert> = {}
    if (dto.name !== undefined) {
      const nextName = dto.name.trim()
      if (nextName !== existing.name) updates.name = nextName
    }
    if (dto.groupId !== undefined && dto.groupId !== existing.groupId) {
      updates.groupId = dto.groupId
    }
    if (dto.rerankModelId !== undefined && dto.rerankModelId !== existing.rerankModelId) {
      updates.rerankModelId = dto.rerankModelId
    }
    if (dto.fileProcessorId !== undefined && dto.fileProcessorId !== existing.fileProcessorId) {
      updates.fileProcessorId = dto.fileProcessorId
    }
    if (nextConfig.chunkSize !== existing.chunkSize) {
      updates.chunkSize = nextConfig.chunkSize
    }
    if (nextConfig.chunkOverlap !== existing.chunkOverlap) {
      updates.chunkOverlap = nextConfig.chunkOverlap
    }
    if (nextConfig.chunkStrategy !== existing.chunkStrategy) {
      updates.chunkStrategy = nextConfig.chunkStrategy
    }
    if (nextConfig.chunkSeparator !== existing.chunkSeparator) {
      updates.chunkSeparator = nextConfig.chunkSeparator
    }
    if (dto.threshold !== undefined && dto.threshold !== existing.threshold) {
      updates.threshold = dto.threshold
    }
    if (dto.documentCount !== undefined && dto.documentCount !== existing.documentCount) {
      updates.documentCount = dto.documentCount
    }
    if (nextConfig.searchMode !== existing.searchMode) {
      updates.searchMode = nextConfig.searchMode
    }
    if ((nextConfig.hybridAlpha ?? undefined) !== existing.hybridAlpha) {
      updates.hybridAlpha = nextConfig.hybridAlpha
    }

    if (Object.keys(updates).length === 0) {
      return existing
    }

    const dbService = application.get('DbService')
    const row = await dbService.withWriteTx(async (tx) => {
      const [updated] = await tx
        .update(knowledgeBaseTable)
        .set(updates)
        .where(eq(knowledgeBaseTable.id, id))
        .returning()
      return updated
    })

    logger.info('Updated knowledge base', { id, changes: Object.keys(dto) })
    return rowToKnowledgeBase(row)
  }

  async delete(id: string): Promise<void> {
    // Verify knowledge base exists
    await this.getById(id)

    const dbService = application.get('DbService')
    await dbService.withWriteTx(async (tx) => {
      await tx.run(sql`
        DELETE FROM ${fileRefTable}
        WHERE ${fileRefTable.sourceType} = ${knowledgeItemSourceType}
          AND ${fileRefTable.sourceId} IN (
            SELECT ${knowledgeItemTable.id}
            FROM ${knowledgeItemTable}
            WHERE ${knowledgeItemTable.baseId} = ${id}
          )
      `)
      await tx.delete(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, id))
    })

    logger.info('Deleted knowledge base', { id })
  }
}

export const knowledgeBaseService = new KnowledgeBaseService()
