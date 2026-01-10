/**
 * Knowledge Service (DataApi v2)
 *
 * Handles CRUD operations for knowledge bases and items stored in SQLite,
 * and bridges vector operations via KnowledgeServiceV2.
 */

import { dbService } from '@data/db/DbService'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { loggerService } from '@logger'
import { knowledgeServiceV2 } from '@main/services/knowledge/KnowledgeServiceV2'
import { reduxService } from '@main/services/ReduxService'
import { DataApiErrorFactory, ErrorCode } from '@shared/data/api'
import type {
  BatchCreateItemsDto,
  CreateKnowledgeBaseDto,
  CreateKnowledgeItemDto,
  KnowledgeSearchRequest,
  UpdateKnowledgeBaseDto,
  UpdateKnowledgeItemDto
} from '@shared/data/api/schemas/knowledge'
import type {
  EmbeddingModelMeta,
  ItemStatus,
  KnowledgeBase,
  KnowledgeItem,
  KnowledgeItemData,
  KnowledgeItemType,
  KnowledgeSearchResult
} from '@shared/data/types/knowledge'
import type { ModelMeta } from '@shared/data/types/meta'
import type { ApiClient, KnowledgeBaseParams, KnowledgeItem as ServiceKnowledgeItem, Provider } from '@types'
import { SystemProviderIds } from '@types'
import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:KnowledgeService')

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

const SEARCH_ENDPOINTS = ['chat/completions', 'responses', 'messages', 'generateContent', 'streamGenerateContent']

type KnowledgeBaseRow = typeof knowledgeBaseTable.$inferSelect
type KnowledgeItemRow = typeof knowledgeItemTable.$inferSelect

type PaginatedQuery = {
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  search?: string
}

const parseJson = <T>(value: T | string | null | undefined): T | undefined => {
  if (value == null) return undefined
  if (typeof value === 'string') return JSON.parse(value) as T
  return value
}

const toIsoString = (value?: number | null): string => {
  return value ? new Date(value).toISOString() : new Date().toISOString()
}

const normalizePagination = (params: PaginatedQuery = {}): { page: number; limit: number; offset: number } => {
  const page = Math.max(DEFAULT_PAGE, Math.floor(params.page ?? DEFAULT_PAGE))
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(params.limit ?? DEFAULT_LIMIT)))
  return { page, limit, offset: (page - 1) * limit }
}

const normalizeSearchPattern = (search?: string): string | undefined => {
  if (!search || !search.trim()) return undefined
  return `%${search.trim()}%`
}

const withoutTrailingSlash = (value: string): string => value.replace(/\/+$/, '')

const resolveBaseUrl = (apiHost: string): string => {
  const trimmedHost = apiHost.trim()
  if (!trimmedHost) return ''
  if (!trimmedHost.endsWith('#')) {
    return withoutTrailingSlash(trimmedHost)
  }

  const host = trimmedHost.slice(0, -1)
  const endpointMatch = SEARCH_ENDPOINTS.find((endpoint) => host.endsWith(endpoint))
  const baseSegment = endpointMatch ? host.slice(0, host.length - endpointMatch.length) : host
  return withoutTrailingSlash(baseSegment).replace(/:$/, '')
}

const toKnowledgeBase = (row: KnowledgeBaseRow): KnowledgeBase => {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    embeddingModelId: row.embeddingModelId,
    embeddingModelMeta: parseJson(row.embeddingModelMeta),
    rerankModelId: row.rerankModelId ?? undefined,
    rerankModelMeta: parseJson(row.rerankModelMeta),
    preprocessProviderId: row.preprocessProviderId ?? undefined,
    chunkSize: row.chunkSize ?? undefined,
    chunkOverlap: row.chunkOverlap ?? undefined,
    threshold: row.threshold ?? undefined,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  }
}

const toKnowledgeItem = (row: KnowledgeItemRow): KnowledgeItem => {
  return {
    id: row.id,
    baseId: row.baseId,
    type: row.type,
    data: parseJson(row.data) as KnowledgeItemData,
    status: row.status ?? 'idle',
    error: row.error ?? undefined,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  }
}

const isAzureProvider = (provider: Provider): boolean => provider.type === 'azure-openai'
const isGeminiProvider = (provider: Provider): boolean => provider.type === 'gemini'

export class KnowledgeService {
  private static instance: KnowledgeService

  private constructor() {}

  public static getInstance(): KnowledgeService {
    if (!KnowledgeService.instance) {
      KnowledgeService.instance = new KnowledgeService()
    }
    return KnowledgeService.instance
  }

  async listBases(query: PaginatedQuery = {}) {
    const db = dbService.getDb()
    const { page, limit, offset } = normalizePagination(query)
    const searchPattern = normalizeSearchPattern(query.search)

    const whereClause = searchPattern
      ? or(like(knowledgeBaseTable.name, searchPattern), like(knowledgeBaseTable.description, searchPattern))
      : undefined

    const orderBy = this.buildBaseOrderBy(query)

    const listQuery = db.select().from(knowledgeBaseTable).orderBy(orderBy).limit(limit).offset(offset)
    const countQuery = db.select({ count: sql<number>`count(*)` }).from(knowledgeBaseTable)

    if (whereClause) {
      listQuery.where(whereClause)
      countQuery.where(whereClause)
    }

    const [rows, countResult] = await Promise.all([listQuery, countQuery])
    const total = Number(countResult[0]?.count ?? 0)

    return {
      items: rows.map(toKnowledgeBase),
      total,
      page
    }
  }

  async getBaseById(id: string): Promise<KnowledgeBase> {
    const db = dbService.getDb()
    const [row] = await db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('KnowledgeBase', id)
    }

    return toKnowledgeBase(row)
  }

  async createBase(dto: CreateKnowledgeBaseDto): Promise<KnowledgeBase> {
    const db = dbService.getDb()
    const fieldErrors: Record<string, string[]> = {}

    if (!dto.name?.trim()) {
      fieldErrors.name = ['Name is required']
    }
    if (!dto.embeddingModelId?.trim()) {
      fieldErrors.embeddingModelId = ['Embedding model is required']
    }
    if (dto.chunkSize !== undefined && dto.chunkSize <= 0) {
      fieldErrors.chunkSize = ['Chunk size must be greater than 0']
    }
    if (dto.chunkOverlap !== undefined && dto.chunkOverlap < 0) {
      fieldErrors.chunkOverlap = ['Chunk overlap must be 0 or greater']
    }
    if (dto.threshold !== undefined && (dto.threshold < 0 || dto.threshold > 1)) {
      fieldErrors.threshold = ['Threshold must be between 0 and 1']
    }

    if (Object.keys(fieldErrors).length > 0) {
      throw DataApiErrorFactory.validation(fieldErrors)
    }

    const [row] = await db
      .insert(knowledgeBaseTable)
      .values({
        name: dto.name.trim(),
        description: dto.description,
        embeddingModelId: dto.embeddingModelId,
        embeddingModelMeta: dto.embeddingModelMeta,
        rerankModelId: dto.rerankModelId,
        rerankModelMeta: dto.rerankModelMeta,
        preprocessProviderId: dto.preprocessProviderId,
        chunkSize: dto.chunkSize,
        chunkOverlap: dto.chunkOverlap,
        threshold: dto.threshold
      })
      .returning()

    const base = toKnowledgeBase(row)

    // Initialize vector store
    try {
      const baseParams = await this.buildBaseParams(base, 'embeddingModelId')
      await knowledgeServiceV2.create(baseParams)
      logger.info('Created knowledge base with vector store', { id: base.id, name: base.name })
    } catch (error) {
      logger.error('Failed to initialize vector store, cleaning up', error as Error, { id: base.id })
      // Rollback: delete the SQLite record if vector store initialization fails
      await db.delete(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, base.id))
      throw DataApiErrorFactory.create(
        ErrorCode.SERVICE_UNAVAILABLE,
        `Failed to initialize vector store: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    return base
  }

  async updateBase(id: string, dto: UpdateKnowledgeBaseDto): Promise<KnowledgeBase> {
    const db = dbService.getDb()

    await this.getBaseById(id)

    const updates: Partial<typeof knowledgeBaseTable.$inferInsert> = {}

    if (dto.name !== undefined) updates.name = dto.name
    if (dto.description !== undefined) updates.description = dto.description
    if (dto.embeddingModelId !== undefined) updates.embeddingModelId = dto.embeddingModelId
    if (dto.embeddingModelMeta !== undefined) updates.embeddingModelMeta = dto.embeddingModelMeta
    if (dto.rerankModelId !== undefined) updates.rerankModelId = dto.rerankModelId
    if (dto.rerankModelMeta !== undefined) updates.rerankModelMeta = dto.rerankModelMeta
    if (dto.preprocessProviderId !== undefined) updates.preprocessProviderId = dto.preprocessProviderId
    if (dto.chunkSize !== undefined) updates.chunkSize = dto.chunkSize
    if (dto.chunkOverlap !== undefined) updates.chunkOverlap = dto.chunkOverlap
    if (dto.threshold !== undefined) updates.threshold = dto.threshold

    const [row] = await db.update(knowledgeBaseTable).set(updates).where(eq(knowledgeBaseTable.id, id)).returning()

    logger.info('Updated knowledge base', { id, changes: Object.keys(dto) })

    return toKnowledgeBase(row)
  }

  async deleteBase(id: string): Promise<void> {
    const db = dbService.getDb()

    await this.getBaseById(id)

    await db.delete(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, id))

    await knowledgeServiceV2.delete(id)

    logger.info('Deleted knowledge base', { id })
  }

  async listItems(baseId: string, query: PaginatedQuery & { type?: KnowledgeItemType; status?: ItemStatus } = {}) {
    const db = dbService.getDb()
    const { page, limit, offset } = normalizePagination(query)
    const searchPattern = normalizeSearchPattern(query.search)

    await this.getBaseById(baseId)

    const whereClause = and(
      eq(knowledgeItemTable.baseId, baseId),
      query.type ? eq(knowledgeItemTable.type, query.type) : undefined,
      query.status ? eq(knowledgeItemTable.status, query.status) : undefined,
      searchPattern ? like(knowledgeItemTable.data, searchPattern) : undefined
    )

    const orderBy = this.buildItemOrderBy(query)

    const listQuery = db
      .select()
      .from(knowledgeItemTable)
      .where(whereClause)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset)
    const countQuery = db.select({ count: sql<number>`count(*)` }).from(knowledgeItemTable).where(whereClause)

    const [rows, countResult] = await Promise.all([listQuery, countQuery])
    const total = Number(countResult[0]?.count ?? 0)

    return {
      items: rows.map(toKnowledgeItem),
      total,
      page
    }
  }

  async createItem(baseId: string, dto: CreateKnowledgeItemDto): Promise<KnowledgeItem> {
    const db = dbService.getDb()

    const base = await this.getBaseById(baseId)
    this.validateItemPayload(dto)

    const [row] = await db
      .insert(knowledgeItemTable)
      .values({
        baseId,
        type: dto.type,
        data: dto.data,
        status: 'pending',
        error: null
      })
      .returning()

    const item = toKnowledgeItem(row)

    void this.processItem(base, item, { forceReload: false })

    return item
  }

  async createItemsBatch(baseId: string, dto: BatchCreateItemsDto): Promise<KnowledgeItem[]> {
    const db = dbService.getDb()

    if (!dto.items || dto.items.length === 0) {
      throw DataApiErrorFactory.validation({ items: ['At least one item is required'] })
    }

    const base = await this.getBaseById(baseId)

    const fieldErrors: Record<string, string[]> = {}

    dto.items.forEach((item, index) => {
      try {
        this.validateItemPayload(item)
      } catch (error) {
        fieldErrors[`items.${index}`] = ['Invalid item payload']
      }
    })

    if (Object.keys(fieldErrors).length > 0) {
      throw DataApiErrorFactory.validation(fieldErrors)
    }

    const values = dto.items.map((item) => ({
      baseId,
      type: item.type,
      data: item.data,
      status: 'pending' as ItemStatus,
      error: null
    }))

    const rows = await db.insert(knowledgeItemTable).values(values).returning()
    const items = rows.map(toKnowledgeItem)

    items.forEach((item) => {
      void this.processItem(base, item, { forceReload: false })
    })

    return items
  }

  async getItemById(id: string): Promise<KnowledgeItem> {
    const db = dbService.getDb()
    const [row] = await db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('KnowledgeItem', id)
    }

    return toKnowledgeItem(row)
  }

  async updateItem(id: string, dto: UpdateKnowledgeItemDto): Promise<KnowledgeItem> {
    const db = dbService.getDb()

    const existing = await this.getItemById(id)

    if (dto.data) {
      this.validateItemData(existing.type, dto.data)
    }

    const updates: Partial<typeof knowledgeItemTable.$inferInsert> = {}

    if (dto.data !== undefined) updates.data = dto.data
    if (dto.status !== undefined) updates.status = dto.status
    if (dto.error !== undefined) updates.error = dto.error

    const [row] = await db.update(knowledgeItemTable).set(updates).where(eq(knowledgeItemTable.id, id)).returning()

    logger.info('Updated knowledge item', { id, changes: Object.keys(dto) })

    return toKnowledgeItem(row)
  }

  async deleteItem(id: string): Promise<void> {
    const db = dbService.getDb()

    const item = await this.getItemById(id)
    const base = await this.getBaseById(item.baseId)

    await this.removeItemVectors(base, item)
    await db.delete(knowledgeItemTable).where(eq(knowledgeItemTable.id, id))

    logger.info('Deleted knowledge item', { id })
  }

  async refreshItem(id: string): Promise<KnowledgeItem> {
    const db = dbService.getDb()

    const item = await this.getItemById(id)
    const base = await this.getBaseById(item.baseId)

    await db.update(knowledgeItemTable).set({ status: 'pending', error: null }).where(eq(knowledgeItemTable.id, id))

    const pendingItem = await this.getItemById(id)

    void this.processItem(base, pendingItem, { forceReload: true })

    return pendingItem
  }

  async cancelItem(id: string): Promise<{ status: 'cancelled' | 'ignored' }> {
    const item = await this.getItemById(id)

    const result = await knowledgeServiceV2.cancel(id)

    if (result.status === 'cancelled') {
      await dbService
        .getDb()
        .update(knowledgeItemTable)
        .set({ status: 'failed', error: 'Cancelled' })
        .where(eq(knowledgeItemTable.id, id))

      logger.info('Cancelled knowledge item', { id })
    } else {
      logger.debug('Cancel ignored for knowledge item', { id, status: item.status })
    }

    return result
  }

  async search(baseId: string, request: KnowledgeSearchRequest): Promise<KnowledgeSearchResult[]> {
    const base = await this.getBaseById(baseId)

    if (!request.search?.trim()) {
      throw DataApiErrorFactory.validation({ search: ['Search query is required'] })
    }

    const baseParams = await this.buildBaseParams(base, 'embeddingModelId')
    const mode = request.mode === 'vector' ? 'default' : request.mode

    let results = await knowledgeServiceV2.search({
      search: request.search,
      base: baseParams,
      mode,
      alpha: request.alpha
    })

    if (request.rerank && base.rerankModelId) {
      const rerankBase = await this.buildBaseParams(base, 'rerankModelId')
      results = await knowledgeServiceV2.rerank({
        search: request.search,
        base: rerankBase,
        results
      })
    }

    if (request.limit && request.limit > 0) {
      results = results.slice(0, request.limit)
    }

    return results as KnowledgeSearchResult[]
  }

  private buildBaseOrderBy(query: PaginatedQuery) {
    const columns = {
      name: knowledgeBaseTable.name,
      createdAt: knowledgeBaseTable.createdAt,
      updatedAt: knowledgeBaseTable.updatedAt
    }

    const sortBy = query.sortBy && query.sortBy in columns ? query.sortBy : 'updatedAt'
    const column = columns[sortBy as keyof typeof columns] ?? knowledgeBaseTable.updatedAt

    return query.sortOrder === 'asc' ? asc(column) : desc(column)
  }

  private buildItemOrderBy(query: PaginatedQuery) {
    const columns = {
      createdAt: knowledgeItemTable.createdAt,
      updatedAt: knowledgeItemTable.updatedAt,
      type: knowledgeItemTable.type,
      status: knowledgeItemTable.status
    }

    const sortBy = query.sortBy && query.sortBy in columns ? query.sortBy : 'updatedAt'
    const column = columns[sortBy as keyof typeof columns] ?? knowledgeItemTable.updatedAt

    return query.sortOrder === 'asc' ? asc(column) : desc(column)
  }

  private validateItemPayload(item: CreateKnowledgeItemDto): void {
    if (item.type !== item.data.type) {
      throw DataApiErrorFactory.validation({ type: ['Item type does not match data.type'] })
    }

    this.validateItemData(item.type, item.data)
  }

  private validateItemData(type: KnowledgeItemType, data: KnowledgeItemData): void {
    const fieldErrors: Record<string, string[]> = {}

    if (type !== data.type) {
      fieldErrors.type = ['Item type does not match data.type']
    }

    switch (data.type) {
      case 'file':
        if (!data.file || !data.file.id) {
          fieldErrors['data.file'] = ['File metadata is required']
        }
        break
      case 'url':
        if (!data.url?.trim()) {
          fieldErrors['data.url'] = ['URL is required']
        }
        if (!data.name?.trim()) {
          fieldErrors['data.name'] = ['Name is required']
        }
        break
      case 'note':
        if (!data.content?.trim()) {
          fieldErrors['data.content'] = ['Note content is required']
        }
        break
      case 'sitemap':
        if (!data.url?.trim()) {
          fieldErrors['data.url'] = ['Sitemap URL is required']
        }
        if (!data.name?.trim()) {
          fieldErrors['data.name'] = ['Name is required']
        }
        break
      case 'directory':
        if (!data.path?.trim()) {
          fieldErrors['data.path'] = ['Directory path is required']
        }
        break
      default:
        fieldErrors.type = ['Unsupported knowledge item type']
    }

    if (Object.keys(fieldErrors).length > 0) {
      throw DataApiErrorFactory.validation(fieldErrors)
    }
  }

  private async processItem(
    base: KnowledgeBase,
    item: KnowledgeItem,
    options: { forceReload: boolean }
  ): Promise<void> {
    try {
      const baseParams = await this.buildBaseParams(base, 'embeddingModelId')
      const serviceItem = this.toServiceItem(item)

      if (options.forceReload) {
        await this.removeItemVectors(base, item)
      }

      const result = await knowledgeServiceV2.add({
        base: baseParams,
        item: serviceItem,
        forceReload: options.forceReload
      })

      if (result.status === 'failed') {
        await this.updateItemStatus(item.id, 'failed', result.message ?? null)
      } else {
        await this.updateItemStatus(item.id, 'completed', null)
      }
    } catch (error) {
      logger.error('Knowledge item processing failed', error as Error, { itemId: item.id, baseId: base.id })
      await this.updateItemStatus(item.id, 'failed', error instanceof Error ? error.message : String(error))
    }
  }

  private async updateItemStatus(id: string, status: ItemStatus, errorMessage: string | null): Promise<void> {
    const db = dbService.getDb()

    await db.update(knowledgeItemTable).set({ status, error: errorMessage }).where(eq(knowledgeItemTable.id, id))
  }

  private toServiceItem(item: KnowledgeItem): ServiceKnowledgeItem {
    const data = item.data

    const content = (() => {
      switch (data.type) {
        case 'file':
          return data.file
        case 'url':
          return data.url
        case 'note':
          return data.content
        case 'sitemap':
          return data.url
        case 'directory':
          return data.path
        default:
          return ''
      }
    })()

    const createdAt = Date.parse(item.createdAt)
    const updatedAt = Date.parse(item.updatedAt)

    const base = {
      id: item.id,
      baseId: item.baseId,
      type: item.type,
      content,
      created_at: Number.isNaN(createdAt) ? Date.now() : createdAt,
      updated_at: Number.isNaN(updatedAt) ? Date.now() : updatedAt
    }

    if (data.type === 'note' && data.sourceUrl) {
      return { ...base, sourceUrl: data.sourceUrl } as ServiceKnowledgeItem
    }

    return base as ServiceKnowledgeItem
  }

  private async removeItemVectors(base: KnowledgeBase, item: KnowledgeItem): Promise<void> {
    try {
      const baseParams = await this.buildBaseParams(base, 'embeddingModelId')
      await knowledgeServiceV2.remove({
        base: baseParams,
        externalId: item.id,
        uniqueId: '',
        uniqueIds: []
      })
    } catch (error) {
      logger.warn('Failed to remove knowledge item vectors', { itemId: item.id, error })
    }
  }

  private async buildBaseParams(
    base: KnowledgeBase,
    field: 'embeddingModelId' | 'rerankModelId'
  ): Promise<KnowledgeBaseParams> {
    const embedApiClient = await this.resolveApiClient(
      base.embeddingModelId,
      base.embeddingModelMeta,
      'embeddingModelId'
    )

    const rerankApiClient =
      field === 'rerankModelId' && base.rerankModelId
        ? await this.resolveApiClient(base.rerankModelId, base.rerankModelMeta, 'rerankModelId')
        : undefined

    if (field === 'rerankModelId' && !rerankApiClient) {
      throw DataApiErrorFactory.validation({ rerankModelId: ['Rerank model is not configured'] })
    }

    return {
      id: base.id,
      dimensions: base.embeddingModelMeta?.dimensions,
      chunkSize: base.chunkSize,
      chunkOverlap: base.chunkOverlap,
      embedApiClient,
      rerankApiClient
    }
  }

  private async resolveApiClient(
    modelId: string,
    modelMeta: EmbeddingModelMeta | ModelMeta | undefined,
    field: 'embeddingModelId' | 'rerankModelId'
  ): Promise<ApiClient> {
    if (!modelId?.trim()) {
      throw DataApiErrorFactory.validation({ [field]: ['Model id is required'] })
    }

    const { providerId, resolvedModelId } = this.parseModelId(modelId, modelMeta?.provider)

    if (!providerId) {
      throw DataApiErrorFactory.validation({ [field]: ['Provider is required'] })
    }

    const providers = await this.getProviders()
    const provider = providers.find((item) => item.id === providerId)

    if (!provider) {
      throw DataApiErrorFactory.validation({ [field]: [`Provider '${providerId}' is not configured`] })
    }

    const baseURL = this.resolveProviderBaseUrl(provider)

    if (!baseURL) {
      throw DataApiErrorFactory.create(ErrorCode.SERVICE_UNAVAILABLE, `Provider '${providerId}' base URL is missing`)
    }

    return {
      model: resolvedModelId,
      provider: provider.id,
      apiKey: provider.apiKey || 'secret',
      baseURL
    }
  }

  private parseModelId(modelId: string, metaProvider?: string): { providerId?: string; resolvedModelId: string } {
    if (modelId.includes(':')) {
      const [providerId, ...rest] = modelId.split(':')
      return { providerId, resolvedModelId: rest.join(':') }
    }

    return { providerId: metaProvider, resolvedModelId: modelId }
  }

  private resolveProviderBaseUrl(provider: Provider): string {
    let baseURL = resolveBaseUrl(provider.apiHost || '')

    if (isGeminiProvider(provider)) {
      baseURL = `${baseURL}/openai`
    }

    if (isAzureProvider(provider)) {
      baseURL = `${baseURL}/v1`
    }

    if (provider.id === SystemProviderIds.ollama) {
      baseURL = baseURL.replace(/\/api$/, '')
    }

    return baseURL
  }

  private async getProviders(): Promise<Provider[]> {
    try {
      const providers = await reduxService.select('state.llm.providers')
      if (!Array.isArray(providers)) {
        return []
      }
      return providers as Provider[]
    } catch (error) {
      logger.error('Failed to resolve providers from Redux', error as Error)
      return []
    }
  }
}

export const knowledgeService = KnowledgeService.getInstance()
