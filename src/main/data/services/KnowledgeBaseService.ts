/**
 * Knowledge Base Service (DataApi v2).
 *
 * Handles CRUD operations for knowledge bases stored in SQLite.
 */

import { application } from '@application'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import type { DbType } from '@data/db/types'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import { DataApiErrorFactory, toDataApiError } from '@shared/data/api/errors'
import type {
  KnowledgeBaseListItem,
  KnowledgeBaseListResponse,
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
  type KnowledgeBase,
  KnowledgeBaseSchema,
  KnowledgeBaseWriteSchema
} from '@shared/data/types/knowledge'
import { and, asc, count as sqlCount, desc, eq, gte, inArray, ne, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'

import { groupService } from './GroupService'
import { asNumericKey, asStringKey, decodeListCursor, encodeCursor, keysetOrdering } from './utils/keysetCursor'
import { nullsToUndefined, timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:KnowledgeBaseService')

type KnowledgeBaseRow = typeof knowledgeBaseTable.$inferSelect
type KnowledgeBaseEntitySearchItem = Extract<EntitySearchItem, { type: 'knowledge-base' }>
type KnowledgeBaseListSortBy = NonNullable<ListKnowledgeBasesQuery['sortBy']>
type KnowledgeBaseOffsetListQuery = Omit<ListKnowledgeBasesQuery, 'cursor'> & { page: number }
type KnowledgeBaseListFilters = {
  groupId?: string
  ids?: readonly string[]
  includeItemSourcesInSearch?: boolean
}

const sourceItemTable = alias(knowledgeItemTable, 'source_item')

function validateKnowledgeBaseGroupTx(tx: Pick<DbType, 'select'>, groupId: string | null | undefined): void {
  if (groupId == null) return

  const group = groupService.findByIdTx(tx, groupId)
  if (!group) {
    throw DataApiErrorFactory.validation({
      groupId: [`Knowledge base group not found: ${groupId}`]
    })
  }
  if (group.entityType !== 'knowledge') {
    throw DataApiErrorFactory.validation({
      groupId: [`Knowledge base group must have entityType 'knowledge': ${groupId}`]
    })
  }
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

function buildSearchPredicate(search: string | undefined, includeItemSources = false): SQL | undefined {
  const trimmed = search?.trim()
  if (!trimmed) return undefined

  const pattern = `%${trimmed.replace(/[\\%_]/g, '\\$&')}%`
  const nameMatch = sql`${knowledgeBaseTable.name} LIKE ${pattern} ESCAPE '\\'`
  if (!includeItemSources) return nameMatch

  const itemSourceMatch = sql`EXISTS (
    SELECT 1
    FROM ${knowledgeItemTable} AS ${sql.identifier('source_item')}
    WHERE ${sourceItemTable.baseId} = ${knowledgeBaseTable.id}
      AND ${sourceItemTable.groupId} IS NULL
      AND ${sourceItemTable.status} = 'completed'
      AND (
        json_extract(${sourceItemTable.data}, '$.source') LIKE ${pattern} ESCAPE '\\'
        OR json_extract(${sourceItemTable.data}, '$.url') LIKE ${pattern} ESCAPE '\\'
        OR json_extract(${sourceItemTable.data}, '$.relativePath') LIKE ${pattern} ESCAPE '\\'
        OR json_extract(${sourceItemTable.data}, '$.file.origin_name') LIKE ${pattern} ESCAPE '\\'
        OR json_extract(${sourceItemTable.data}, '$.file.name') LIKE ${pattern} ESCAPE '\\'
        OR json_extract(${sourceItemTable.data}, '$.content') LIKE ${pattern} ESCAPE '\\'
      )
  )`

  return sql`(${nameMatch} OR (${knowledgeBaseTable.status} = 'completed' AND ${itemSourceMatch}))`
}

function buildListFilterConditions(
  query: Pick<ListKnowledgeBasesQuery, 'search' | 'updatedAtFrom'>,
  filters: KnowledgeBaseListFilters = {}
): SQL[] {
  const conditions: SQL[] = []
  const search = buildSearchPredicate(query.search, filters.includeItemSourcesInSearch)
  if (search) conditions.push(search)
  if (query.updatedAtFrom !== undefined) {
    conditions.push(gte(knowledgeBaseTable.updatedAt, Date.parse(query.updatedAtFrom)))
  }
  if (filters.groupId !== undefined) {
    conditions.push(eq(knowledgeBaseTable.groupId, filters.groupId))
  }
  if (filters.ids !== undefined) {
    conditions.push(filters.ids.length > 0 ? inArray(knowledgeBaseTable.id, [...filters.ids]) : sql`0`)
  }
  return conditions
}

function getListSortColumn(sortBy: KnowledgeBaseListSortBy) {
  return {
    createdAt: knowledgeBaseTable.createdAt,
    updatedAt: knowledgeBaseTable.updatedAt,
    name: knowledgeBaseTable.name
  }[sortBy]
}

function getListSortValue(row: KnowledgeBaseRow, sortBy: KnowledgeBaseListSortBy): string | number {
  return sortBy === 'name' ? row.name : row[sortBy]
}

function rowToKnowledgeBaseListItem(row: { base: KnowledgeBaseRow; itemCount: number }): KnowledgeBaseListItem {
  return {
    ...rowToKnowledgeBase(row.base),
    itemCount: row.itemCount
  }
}

export class KnowledgeBaseService {
  private readonly embeddingModelsBeingRemoved = new Set<string>()

  private get db() {
    return application.get('DbService').getDb()
  }

  /** Prevents a reference from being added while an owner asynchronously removes a model's weights. */
  acquireEmbeddingModelRemovalGuard(modelId: string): (() => void) | undefined {
    if (this.embeddingModelsBeingRemoved.has(modelId)) {
      return undefined
    }

    this.embeddingModelsBeingRemoved.add(modelId)
    try {
      const [inUse] = this.db
        .select({ id: knowledgeBaseTable.id })
        .from(knowledgeBaseTable)
        .where(eq(knowledgeBaseTable.embeddingModelId, modelId))
        .limit(1)
        .all()
      if (inUse) {
        this.embeddingModelsBeingRemoved.delete(modelId)
        return undefined
      }
    } catch (error) {
      this.embeddingModelsBeingRemoved.delete(modelId)
      throw error
    }

    let released = false
    return () => {
      if (released) return
      released = true
      this.embeddingModelsBeingRemoved.delete(modelId)
    }
  }

  private assertEmbeddingModelIsNotBeingRemoved(modelId: string | null): void {
    if (modelId !== null && this.embeddingModelsBeingRemoved.has(modelId)) {
      throw DataApiErrorFactory.resourceLocked('EmbeddingModel', modelId, 'model weight removal')
    }
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

  listAllIds(): Set<string> {
    return new Set(
      this.db
        .select({ id: knowledgeBaseTable.id })
        .from(knowledgeBaseTable)
        .all()
        .map(({ id }) => id)
    )
  }

  list(query: KnowledgeBaseOffsetListQuery): OffsetPaginationResponse<KnowledgeBaseListItem> {
    const { page, limit } = query
    const offset = (page - 1) * limit
    const conditions = buildListFilterConditions(query)
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined
    const sortBy = query.sortBy ?? 'createdAt'
    const sortOrder = query.sortOrder ?? 'desc'
    const orderFn = sortOrder === 'asc' ? asc : desc
    const sortColumn = getListSortColumn(sortBy)
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
      items: rows.map(rowToKnowledgeBaseListItem),
      total: count,
      page
    }
  }

  listCursor(query: ListKnowledgeBasesQuery, filters: KnowledgeBaseListFilters = {}): KnowledgeBaseListResponse {
    const { limit } = query
    const filterConditions = buildListFilterConditions(query, filters)
    const sortBy = query.sortBy ?? 'createdAt'
    const sortOrder = query.sortOrder ?? 'desc'
    const sortColumn = getListSortColumn(sortBy)
    const ordering = keysetOrdering(sortColumn, knowledgeBaseTable.id, { major: sortOrder, tie: sortOrder })
    const cursor =
      sortBy === 'name'
        ? decodeListCursor(query.cursor, asStringKey, 'knowledge-base')
        : decodeListCursor(query.cursor, asNumericKey, 'knowledge-base')
    const conditions = [...filterConditions]
    if (cursor) conditions.push(ordering.where(cursor))

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined
    const filterWhereClause = filterConditions.length > 0 ? and(...filterConditions) : undefined
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
      .orderBy(...ordering.orderBy)
      .limit(limit + 1)
      .all()
    const [{ count }] = this.db
      .select({ count: sql<number>`count(*)` })
      .from(knowledgeBaseTable)
      .where(filterWhereClause)
      .all()
    const pageRows = rows.slice(0, limit)
    const tail = pageRows.at(-1)

    return {
      items: pageRows.map(rowToKnowledgeBaseListItem),
      total: count,
      nextCursor:
        rows.length > limit && tail ? encodeCursor(getListSortValue(tail.base, sortBy), tail.base.id) : undefined
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
      chunkSeparator: dto.chunkSeparator ?? DEFAULT_KNOWLEDGE_CHUNK_SEPARATOR
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
      documentCount: dto.documentCount ?? null
    }

    // threshold/documentCount are nullable in the insert values but optional in the
    // write schema, so nulls become undefined for validation.
    const createCandidate = {
      ...createValues,
      threshold: createValues.threshold ?? undefined,
      documentCount: createValues.documentCount ?? undefined
    }
    const createValidation = KnowledgeBaseWriteSchema.safeParse(createCandidate)
    if (!createValidation.success) {
      throw toDataApiError(createValidation.error, 'create knowledge base')
    }

    this.assertEmbeddingModelIsNotBeingRemoved(embeddingModelId)

    const row = application.get('DbService').withWriteTx((tx) => {
      validateKnowledgeBaseGroupTx(tx, dto.groupId)
      const [inserted] = tx.insert(knowledgeBaseTable).values(createValues).returning().all()
      return inserted
    })

    logger.info('Created knowledge base', { id: row.id, name: row.name })
    return rowToKnowledgeBase(row)
  }

  update(id: string, dto: UpdateKnowledgeBaseDto, options?: { allowEmbeddingModelBackfill?: boolean }): KnowledgeBase {
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
    //
    // The one exception is `allowEmbeddingModelBackfill`: a BM25-only base (no model
    // configured yet) has no vectors to invalidate, so its caller (KnowledgeService.
    // enableEmbeddingModel) may set a model in place and backfill embeddings for the
    // existing items instead of routing through restore-into-a-new-base. This flag is
    // internal-only — the public update route never passes it — and it never forgives
    // switching an already-configured model, only the null-to-a-model transition.
    if (embeddingModelChanged || dimensionsChanged) {
      const isFirstTimeEmbeddingSetup = existing.embeddingModelId === null && nextEmbeddingModelId !== null
      const skipItemCountGuard = options?.allowEmbeddingModelBackfill === true && isFirstTimeEmbeddingSetup

      if (!skipItemCountGuard) {
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
    }

    const nextConfig: {
      chunkSize: number
      chunkOverlap: number
      chunkStrategy: KnowledgeBase['chunkStrategy']
      chunkSeparator: KnowledgeBase['chunkSeparator']
    } = {
      chunkSize: dto.chunkSize !== undefined ? dto.chunkSize : existing.chunkSize,
      chunkOverlap: dto.chunkOverlap !== undefined ? dto.chunkOverlap : existing.chunkOverlap,
      chunkStrategy: dto.chunkStrategy !== undefined ? dto.chunkStrategy : existing.chunkStrategy,
      chunkSeparator: dto.chunkSeparator !== undefined ? dto.chunkSeparator : existing.chunkSeparator
    }

    // Validate the merged next-state (existing row + this PATCH) against the same
    // invariants as the read schema — a failed base's leftover-incompatible pairing
    // isn't governed by these invariants until it goes through restore, so
    // metadata-only updates (rename, move group) must not be blocked by them; that
    // gating lives inside `refineKnowledgeBaseInvariants` itself (only enforced
    // when `status === 'completed'`).
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...existingConfig } = existing
    void _id // Intentionally unused - excluding id/createdAt/updatedAt from the write candidate
    void _createdAt
    void _updatedAt
    const updateCandidate = {
      ...existingConfig,
      embeddingModelId: nextEmbeddingModelId,
      dimensions: nextDimensions,
      chunkSize: nextConfig.chunkSize,
      chunkOverlap: nextConfig.chunkOverlap,
      chunkStrategy: nextConfig.chunkStrategy,
      chunkSeparator: nextConfig.chunkSeparator
    }
    const updateValidation = KnowledgeBaseWriteSchema.safeParse(updateCandidate)
    if (!updateValidation.success) {
      throw toDataApiError(updateValidation.error, 'update knowledge base')
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

    if (Object.keys(updates).length === 0) {
      return existing
    }

    if (embeddingModelChanged) {
      this.assertEmbeddingModelIsNotBeingRemoved(nextEmbeddingModelId)
    }

    const row = application.get('DbService').withWriteTx((tx) => {
      if (dto.groupId !== undefined) {
        validateKnowledgeBaseGroupTx(tx, dto.groupId)
      }
      const [updated] = tx
        .update(knowledgeBaseTable)
        .set(updates)
        .where(eq(knowledgeBaseTable.id, id))
        .returning()
        .all()
      if (!updated) {
        throw DataApiErrorFactory.notFound('KnowledgeBase', id)
      }
      return updated
    })

    logger.info('Updated knowledge base', { id, changes: Object.keys(dto) })
    return rowToKnowledgeBase(row)
  }

  delete(id: string): void {
    // Verify knowledge base exists
    this.getById(id)

    let affectedAgentIds: string[] = []
    application.get('DbService').withWriteTx((tx) => {
      affectedAgentIds = agentService.removeKnowledgeBaseFromAllAgentsTx(tx, id)
      tx.delete(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, id)).run()
    })

    try {
      agentService.emitAgentUpdatedForIds(affectedAgentIds, 'knowledgeBaseIds')
    } catch (error) {
      logger.error('Knowledge base deleted but agent refresh failed; affected agents may retain stale tool scope', {
        knowledgeBaseId: id,
        affectedAgentIds,
        error
      })
    }

    logger.info('Deleted knowledge base', { id })
  }
}

export const knowledgeBaseService = new KnowledgeBaseService()
