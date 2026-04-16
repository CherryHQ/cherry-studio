/**
 * Knowledge Base Service (DataApi v2).
 *
 * Handles CRUD operations for knowledge bases stored in SQLite.
 */

import { application } from '@application'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import {
  type CreateKnowledgeBaseDto,
  type KnowledgeBaseListQuery,
  type UpdateKnowledgeBaseDto
} from '@shared/data/api/schemas/knowledges'
import type { KnowledgeBase, KnowledgeSearchMode } from '@shared/data/types/knowledge'
import { desc, eq, sql } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:KnowledgeBaseService')

export interface KnowledgeBaseConfigInput {
  chunkSize?: number | null
  chunkOverlap?: number | null
  threshold?: number | null
  documentCount?: number | null
  searchMode?: KnowledgeSearchMode | null
  hybridAlpha?: number | null
}

function addFieldError(
  fieldErrors: Record<string, string[]>,
  field: keyof KnowledgeBaseConfigInput,
  message: string
): void {
  if (!fieldErrors[field]) {
    fieldErrors[field] = []
  }

  fieldErrors[field].push(message)
}

export function normalizeKnowledgeBaseConfigDependencies<T extends KnowledgeBaseConfigInput>(config: T): T {
  const normalized = { ...config }

  if (normalized.chunkOverlap != null) {
    if (normalized.chunkSize == null || normalized.chunkOverlap >= normalized.chunkSize) {
      normalized.chunkOverlap = undefined as T['chunkOverlap']
    }
  }

  if (normalized.hybridAlpha != null && normalized.searchMode !== 'hybrid') {
    normalized.hybridAlpha = undefined as T['hybridAlpha']
  }

  return normalized
}

export function validateKnowledgeBaseConfig(config: KnowledgeBaseConfigInput): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {}

  if (config.chunkSize != null && config.chunkSize <= 0) {
    addFieldError(fieldErrors, 'chunkSize', 'Chunk size must be greater than 0')
  }

  if (config.chunkOverlap != null && config.chunkOverlap < 0) {
    addFieldError(fieldErrors, 'chunkOverlap', 'Chunk overlap must be greater than or equal to 0')
  }

  if (config.threshold != null && (config.threshold < 0 || config.threshold > 1)) {
    addFieldError(fieldErrors, 'threshold', 'Threshold must be between 0 and 1')
  }

  if (config.documentCount != null && config.documentCount <= 0) {
    addFieldError(fieldErrors, 'documentCount', 'Document count must be greater than 0')
  }

  const hybridAlphaIsInRange = config.hybridAlpha == null || (config.hybridAlpha >= 0 && config.hybridAlpha <= 1)
  if (!hybridAlphaIsInRange) {
    addFieldError(fieldErrors, 'hybridAlpha', 'Hybrid alpha must be between 0 and 1')
  }

  const chunkOverlap = config.chunkOverlap
  if (chunkOverlap != null && chunkOverlap >= 0) {
    if (config.chunkSize == null) {
      addFieldError(fieldErrors, 'chunkOverlap', 'Chunk overlap requires chunk size')
    } else if (chunkOverlap >= config.chunkSize) {
      addFieldError(fieldErrors, 'chunkOverlap', 'Chunk overlap must be smaller than chunk size')
    }
  }

  if (config.hybridAlpha != null && hybridAlphaIsInRange && config.searchMode !== 'hybrid') {
    addFieldError(fieldErrors, 'hybridAlpha', 'Hybrid alpha requires hybrid search mode')
  }

  return fieldErrors
}

function rowToKnowledgeBase(row: typeof knowledgeBaseTable.$inferSelect): KnowledgeBase {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    dimensions: row.dimensions,
    embeddingModelId: row.embeddingModelId,
    rerankModelId: row.rerankModelId ?? undefined,
    fileProcessorId: row.fileProcessorId ?? undefined,
    chunkSize: row.chunkSize ?? undefined,
    chunkOverlap: row.chunkOverlap ?? undefined,
    threshold: row.threshold ?? undefined,
    documentCount: row.documentCount ?? undefined,
    searchMode: row.searchMode ?? undefined,
    hybridAlpha: row.hybridAlpha ?? undefined,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
  }
}

export class KnowledgeBaseService {
  async list(query: KnowledgeBaseListQuery): Promise<OffsetPaginationResponse<KnowledgeBase>> {
    const db = application.get('DbService').getDb()
    const { page, limit } = query
    const offset = (page - 1) * limit

    const [rows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(knowledgeBaseTable)
        .orderBy(desc(knowledgeBaseTable.createdAt), desc(knowledgeBaseTable.id))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(knowledgeBaseTable)
    ])

    return {
      items: rows.map((row) => rowToKnowledgeBase(row)),
      total: count,
      page
    }
  }

  async getById(id: string): Promise<KnowledgeBase> {
    const db = application.get('DbService').getDb()
    const [row] = await db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('KnowledgeBase', id)
    }

    return rowToKnowledgeBase(row)
  }

  async create(dto: CreateKnowledgeBaseDto): Promise<KnowledgeBase> {
    const db = application.get('DbService').getDb()
    const createValues: Omit<typeof knowledgeBaseTable.$inferInsert, 'id' | 'createdAt' | 'updatedAt'> = {
      name: dto.name.trim(),
      description: dto.description,
      dimensions: dto.dimensions,
      embeddingModelId: dto.embeddingModelId.trim(),
      rerankModelId: dto.rerankModelId,
      fileProcessorId: dto.fileProcessorId,
      chunkSize: dto.chunkSize,
      chunkOverlap: dto.chunkOverlap,
      threshold: dto.threshold,
      documentCount: dto.documentCount,
      searchMode: dto.searchMode,
      hybridAlpha: dto.hybridAlpha
    }

    const createFieldErrors = validateKnowledgeBaseConfig(createValues)
    if (Object.keys(createFieldErrors).length > 0) {
      throw DataApiErrorFactory.validation(createFieldErrors)
    }

    const [row] = await db.insert(knowledgeBaseTable).values(createValues).returning()

    logger.info('Created knowledge base', { id: row.id, name: row.name })
    return rowToKnowledgeBase(row)
  }

  async update(id: string, dto: UpdateKnowledgeBaseDto): Promise<KnowledgeBase> {
    const db = application.get('DbService').getDb()
    const existing = await this.getById(id)

    const updates: Partial<typeof knowledgeBaseTable.$inferInsert> = {}
    if (dto.name !== undefined) updates.name = dto.name.trim()
    if (dto.description !== undefined) updates.description = dto.description
    if (dto.rerankModelId !== undefined) updates.rerankModelId = dto.rerankModelId
    if (dto.fileProcessorId !== undefined) updates.fileProcessorId = dto.fileProcessorId
    if (dto.chunkSize !== undefined) updates.chunkSize = dto.chunkSize
    if (dto.chunkOverlap !== undefined) updates.chunkOverlap = dto.chunkOverlap
    if (dto.threshold !== undefined) updates.threshold = dto.threshold
    if (dto.documentCount !== undefined) updates.documentCount = dto.documentCount
    if (dto.searchMode !== undefined) updates.searchMode = dto.searchMode
    if (dto.hybridAlpha !== undefined) updates.hybridAlpha = dto.hybridAlpha

    if (Object.keys(updates).length === 0) {
      return existing
    }

    const mergedConfig = {
      chunkSize: dto.chunkSize !== undefined ? dto.chunkSize : existing.chunkSize,
      chunkOverlap: dto.chunkOverlap !== undefined ? dto.chunkOverlap : existing.chunkOverlap,
      threshold: dto.threshold !== undefined ? dto.threshold : existing.threshold,
      documentCount: dto.documentCount !== undefined ? dto.documentCount : existing.documentCount,
      searchMode: dto.searchMode !== undefined ? dto.searchMode : existing.searchMode,
      hybridAlpha: dto.hybridAlpha !== undefined ? dto.hybridAlpha : existing.hybridAlpha
    }
    const normalizedConfig = { ...mergedConfig }

    if (dto.chunkSize !== undefined && dto.chunkOverlap === undefined) {
      normalizedConfig.chunkOverlap = normalizeKnowledgeBaseConfigDependencies({
        chunkSize: mergedConfig.chunkSize,
        chunkOverlap: mergedConfig.chunkOverlap
      }).chunkOverlap
    }

    if (dto.searchMode !== undefined && dto.hybridAlpha === undefined) {
      normalizedConfig.hybridAlpha = normalizeKnowledgeBaseConfigDependencies({
        searchMode: mergedConfig.searchMode,
        hybridAlpha: mergedConfig.hybridAlpha
      }).hybridAlpha
    }

    const updateFieldErrors = validateKnowledgeBaseConfig(normalizedConfig)
    if (Object.keys(updateFieldErrors).length > 0) {
      throw DataApiErrorFactory.validation(updateFieldErrors)
    }

    const nextChunkSize = normalizedConfig.chunkSize ?? null
    if (nextChunkSize !== (existing.chunkSize ?? null)) {
      updates.chunkSize = nextChunkSize
    }

    const nextChunkOverlap = normalizedConfig.chunkOverlap ?? null
    if (nextChunkOverlap !== (existing.chunkOverlap ?? null)) {
      updates.chunkOverlap = nextChunkOverlap
    }

    const nextThreshold = normalizedConfig.threshold ?? null
    if (nextThreshold !== (existing.threshold ?? null)) {
      updates.threshold = nextThreshold
    }

    const nextDocumentCount = normalizedConfig.documentCount ?? null
    if (nextDocumentCount !== (existing.documentCount ?? null)) {
      updates.documentCount = nextDocumentCount
    }

    const nextSearchMode = normalizedConfig.searchMode ?? null
    if (nextSearchMode !== (existing.searchMode ?? null)) {
      updates.searchMode = nextSearchMode
    }

    const nextHybridAlpha = normalizedConfig.hybridAlpha ?? null
    if (nextHybridAlpha !== (existing.hybridAlpha ?? null)) {
      updates.hybridAlpha = nextHybridAlpha
    }

    const [row] = await db.update(knowledgeBaseTable).set(updates).where(eq(knowledgeBaseTable.id, id)).returning()

    logger.info('Updated knowledge base', { id, changes: Object.keys(dto) })
    return rowToKnowledgeBase(row)
  }

  async delete(id: string): Promise<void> {
    const db = application.get('DbService').getDb()
    await this.getById(id)
    await db.delete(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, id))
    logger.info('Deleted knowledge base', { id })
  }
}

export const knowledgeBaseService = new KnowledgeBaseService()
