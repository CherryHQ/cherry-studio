/**
 * Knowledge Base Service (DataApi v2).
 *
 * Handles CRUD operations for knowledge bases stored in SQLite.
 */

import { application } from '@application'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type {
  KnowledgeBaseListItem,
  ListKnowledgeBasesQuery,
  UpdateKnowledgeBaseDto
} from '@shared/data/api/schemas/knowledges'
import type { EntitySearchItem } from '@shared/data/api/schemas/search'
import type { OffsetPaginationResponse } from '@shared/data/api/types'
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

// Vector and hybrid retrieval need an embedding model; without one a base is
// BM25-only and cannot run a non-bm25 search mode. Mirrors the `completed`-only
// gate in `KnowledgeBaseSchema.superRefine`: a failed base's leftover searchMode
// isn't governed by this invariant until it goes through restore, so callers
// must only apply it to a base that is (or will become) completed. Only
// update() calls this: create() always coerces searchMode to 'bm25' up front
// when there is no model, so the invariant already holds by construction there.
function validateSearchModeNeedsEmbedding(
  embeddingModelId: string | null,
  searchMode: string | null | undefined
): Record<string, string[]> {
  if (embeddingModelId == null && searchMode != null && searchMode !== 'bm25') {
    return { searchMode: ['A knowledge base without an embedding model can only use bm25 search'] }
  }
  return {}
}

// The vector arm of the DB CHECK requires a positive dimensions alongside the model;
// a no-model base always persists a null dimensions regardless of what is passed. The
// IPC boundary already rejects a model without dimensions via CreateKnowledgeBaseSchema's
// refine, so this guards internal callers (e.g. restoreBase) that build a DTO directly,
// before the write reaches the DB CHECK as an untranslated constraint violation.
function validateDimensionsForEmbeddingModel(
  embeddingModelId: string | null,
  dimensions: number | null | undefined
): Record<string, string[]> {
  if (embeddingModelId != null && !(typeof dimensions === 'number' && Number.isInteger(dimensions) && dimensions > 0)) {
    return { dimensions: ['A knowledge base with an embedding model requires positive dimensions'] }
  }
  return {}
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

  search(query: { q: string; limit: number; updatedAtFrom?: number }): KnowledgeBaseEntitySearchItem[] {
    const conditions: SQL[] = []
    const search = buildSearchPredicate(query.q)
    if (search) conditions.push(search)
    if (query.updatedAtFrom !== undefined) {
      conditions.push(gte(knowledgeBaseTable.updatedAt, query.updatedAtFrom))
    }

    const rows = this.db
      .select({
        id: knowledgeBaseTable.id,
        name: knowledgeBaseTable.name,
        updatedAt: knowledgeBaseTable.updatedAt
      })
      .from(knowledgeBaseTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(knowledgeBaseTable.updatedAt), asc(knowledgeBaseTable.id))
      .limit(query.limit)
      .all()

    return rows.map((row) => ({
      type: 'knowledge-base',
      id: row.id,
      title: row.name,
      updatedAt: timestampToISO(row.updatedAt),
      target: { knowledgeBaseId: row.id }
    }))
  }

  list(query: ListKnowledgeBasesQuery): OffsetPaginationResponse<KnowledgeBaseListItem> {
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
    const rows = this.db
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
      .offset(offset)
      .all()
    const [{ count }] = this.db
      .select({ count: sql<number>`count(*)` })
      .from(knowledgeBaseTable)
      .where(whereClause)
      .all()

    return {
      items: rows.map((row) => ({
        ...rowToKnowledgeBase(row.base),
        itemCount: row.itemCount
      })),
      total: count,
      page
    }
  }

  getById(id: string): KnowledgeBase {
    const [row] = this.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, id)).limit(1).all()

    if (!row) {
      throw DataApiErrorFactory.notFound('KnowledgeBase', id)
    }

    return rowToKnowledgeBase(row)
  }

  create(dto: CreateKnowledgeBaseDto): KnowledgeBase {
    // An embedding model is optional. Without one the base is BM25-only: it stores
    // no dimensions and is forced to lexical search regardless of any requested mode.
    const embeddingModelId = dto.embeddingModelId?.trim() || null
    const usesEmbeddings = embeddingModelId !== null
    const createConfig = {
      chunkSize: dto.chunkSize ?? DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
      chunkOverlap: dto.chunkOverlap ?? DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
      chunkStrategy: dto.chunkStrategy ?? DEFAULT_KNOWLEDGE_CHUNK_STRATEGY,
      chunkSeparator: dto.chunkSeparator ?? DEFAULT_KNOWLEDGE_CHUNK_SEPARATOR,
      searchMode: usesEmbeddings ? (dto.searchMode ?? DEFAULT_KNOWLEDGE_SEARCH_MODE) : 'bm25',
      hybridAlpha: usesEmbeddings ? dto.hybridAlpha : undefined
    }
    const createFieldErrors = {
      // Validated against the raw dto.hybridAlpha, not the coerced createConfig value
      // below, so an explicit hybridAlpha on a no-model base is rejected instead of
      // silently discarded — create() and update() reject the same input shape.
      ...validateKnowledgeBaseConfig({ ...createConfig, hybridAlpha: dto.hybridAlpha }),
      ...validateDimensionsForEmbeddingModel(embeddingModelId, dto.dimensions)
    }
    if (Object.keys(createFieldErrors).length > 0) {
      throw DataApiErrorFactory.validation(createFieldErrors)
    }

    const createValues: Omit<typeof knowledgeBaseTable.$inferInsert, 'id' | 'createdAt' | 'updatedAt'> = {
      name: dto.name.trim(),
      groupId: dto.groupId ?? null,
      dimensions: usesEmbeddings ? (dto.dimensions ?? null) : null,
      embeddingModelId,
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

    const db = application.get('DbService').getDb()
    const [row] = db.insert(knowledgeBaseTable).values(createValues).returning().all()

    logger.info('Created knowledge base', { id: row.id, name: row.name })
    return rowToKnowledgeBase(row)
  }

  update(id: string, dto: UpdateKnowledgeBaseDto): KnowledgeBase {
    const existing = this.getById(id)

    const nextEmbeddingModelId =
      dto.embeddingModelId !== undefined ? dto.embeddingModelId?.trim() || null : existing.embeddingModelId
    const nextDimensions = dto.dimensions !== undefined ? dto.dimensions : existing.dimensions
    const embeddingModelChanged = nextEmbeddingModelId !== existing.embeddingModelId
    const dimensionsChanged = nextDimensions !== existing.dimensions

    // Changing the embedding model or its vector width invalidates any vectors
    // already written for this base's items, so it is only allowed while the base
    // is still empty — a base with items must go through restore-into-a-new-base
    // instead (see the mutable fields comment in UpdateKnowledgeBaseSchema).
    if (embeddingModelChanged || dimensionsChanged) {
      const [{ count: itemCount }] = this.db
        .select({ count: sqlCount(knowledgeItemTable.id) })
        .from(knowledgeItemTable)
        .where(and(eq(knowledgeItemTable.baseId, id), ne(knowledgeItemTable.status, 'deleting')))
        .all()

      if (itemCount > 0) {
        throw DataApiErrorFactory.validation({
          embeddingModelId: ['Cannot change the embedding model of a knowledge base that already has items']
        })
      }
    }

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

    // Only a completed base is governed by the no-model=>bm25 invariant (mirrors
    // KnowledgeBaseSchema.superRefine's own completed-only gate): a failed base
    // may carry a leftover incompatible searchMode from before it failed/migrated,
    // and metadata-only updates (rename, move group) must not be blocked by it.
    const updateFieldErrors = {
      ...validateKnowledgeBaseConfig(nextConfig),
      ...validateDimensionsForEmbeddingModel(nextEmbeddingModelId, nextDimensions),
      ...(existing.status === 'completed'
        ? validateSearchModeNeedsEmbedding(nextEmbeddingModelId, nextConfig.searchMode)
        : {})
    }
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
    if (embeddingModelChanged) {
      updates.embeddingModelId = nextEmbeddingModelId
    }
    if (dimensionsChanged) {
      updates.dimensions = nextDimensions
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

    const db = application.get('DbService').getDb()
    const [row] = db.update(knowledgeBaseTable).set(updates).where(eq(knowledgeBaseTable.id, id)).returning().all()

    logger.info('Updated knowledge base', { id, changes: Object.keys(dto) })
    return rowToKnowledgeBase(row)
  }

  delete(id: string): void {
    // Verify knowledge base exists
    this.getById(id)

    const db = application.get('DbService').getDb()
    db.delete(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, id)).run()

    logger.info('Deleted knowledge base', { id })
  }
}

export const knowledgeBaseService = new KnowledgeBaseService()
