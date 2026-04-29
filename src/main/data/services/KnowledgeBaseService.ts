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
import type { ListKnowledgeBasesQuery, UpdateKnowledgeBaseDto } from '@shared/data/api/schemas/knowledges'
import {
  type CreateKnowledgeBaseDto,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
  DEFAULT_KNOWLEDGE_BASE_EMOJI,
  DEFAULT_KNOWLEDGE_SEARCH_MODE,
  type KnowledgeBase
} from '@shared/data/types/knowledge'
import { desc, eq, sql } from 'drizzle-orm'

import { nullsToUndefined, timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:KnowledgeBaseService')

type KnowledgeBaseRow = typeof knowledgeBaseTable.$inferSelect

function validateKnowledgeBaseConfig(config: {
  chunkSize: number
  chunkOverlap: number
  searchMode?: string | null
  hybridAlpha?: number | null
}): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {}

  if (config.chunkOverlap >= config.chunkSize) {
    fieldErrors.chunkOverlap = ['Chunk overlap must be smaller than chunk size']
  }

  if (config.hybridAlpha != null && config.searchMode !== 'hybrid') {
    fieldErrors.hybridAlpha = ['Hybrid alpha requires hybrid search mode']
  }

  return fieldErrors
}

function rowToKnowledgeBase(row: KnowledgeBaseRow): KnowledgeBase {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    groupId: row.groupId ?? null,
    emoji: row.emoji,
    chunkSize: row.chunkSize,
    chunkOverlap: row.chunkOverlap,
    // Preserve `string | null` contract — bypass clean (which would narrow null → undefined)
    embeddingModelId: row.embeddingModelId,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export class KnowledgeBaseService {
  private get db() {
    return application.get('DbService').getDb()
  }

  async list(query: ListKnowledgeBasesQuery): Promise<OffsetPaginationResponse<KnowledgeBase>> {
    const { page, limit } = query
    const offset = (page - 1) * limit

    const [rows, [{ count }]] = await Promise.all([
      this.db
        .select()
        .from(knowledgeBaseTable)
        .orderBy(desc(knowledgeBaseTable.createdAt), desc(knowledgeBaseTable.id))
        .limit(limit)
        .offset(offset),
      this.db.select({ count: sql<number>`count(*)` }).from(knowledgeBaseTable)
    ])

    return {
      items: rows.map((row) => rowToKnowledgeBase(row)),
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
      searchMode: dto.searchMode ?? DEFAULT_KNOWLEDGE_SEARCH_MODE,
      hybridAlpha: dto.hybridAlpha
    }
    const createFieldErrors = validateKnowledgeBaseConfig(createConfig)
    if (Object.keys(createFieldErrors).length > 0) {
      throw DataApiErrorFactory.validation(createFieldErrors)
    }

    const createValues: Omit<typeof knowledgeBaseTable.$inferInsert, 'id' | 'createdAt' | 'updatedAt'> = {
      name: dto.name.trim(),
      description: dto.description,
      groupId: dto.groupId,
      emoji: dto.emoji ?? DEFAULT_KNOWLEDGE_BASE_EMOJI,
      dimensions: dto.dimensions,
      embeddingModelId: dto.embeddingModelId.trim(),
      rerankModelId: dto.rerankModelId ?? null,
      fileProcessorId: dto.fileProcessorId,
      chunkSize: createConfig.chunkSize,
      chunkOverlap: createConfig.chunkOverlap,
      threshold: dto.threshold,
      documentCount: dto.documentCount,
      searchMode: createConfig.searchMode,
      hybridAlpha: createConfig.hybridAlpha
    }

    const row = await this.db.transaction(async (tx) => {
      const [inserted] = await tx.insert(knowledgeBaseTable).values(createValues).returning()
      return inserted
    })

    logger.info('Created knowledge base', { id: row.id, name: row.name })
    return rowToKnowledgeBase(row)
  }

  async update(id: string, dto: UpdateKnowledgeBaseDto): Promise<KnowledgeBase> {
    const existing = await this.getById(id)

    const nextConfig = {
      chunkSize: dto.chunkSize !== undefined ? dto.chunkSize : existing.chunkSize,
      chunkOverlap: dto.chunkOverlap !== undefined ? dto.chunkOverlap : existing.chunkOverlap,
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
    if (dto.description !== undefined && (dto.description ?? undefined) !== existing.description) {
      updates.description = dto.description
    }
    if (dto.groupId !== undefined && dto.groupId !== existing.groupId) {
      updates.groupId = dto.groupId
    }
    if (dto.emoji !== undefined && dto.emoji !== existing.emoji) {
      updates.emoji = dto.emoji
    }
    if (dto.rerankModelId !== undefined && (dto.rerankModelId ?? undefined) !== existing.rerankModelId) {
      updates.rerankModelId = dto.rerankModelId
    }
    if (dto.fileProcessorId !== undefined && (dto.fileProcessorId ?? undefined) !== existing.fileProcessorId) {
      updates.fileProcessorId = dto.fileProcessorId
    }
    if (nextConfig.chunkSize !== existing.chunkSize) {
      updates.chunkSize = nextConfig.chunkSize
    }
    if (nextConfig.chunkOverlap !== existing.chunkOverlap) {
      updates.chunkOverlap = nextConfig.chunkOverlap
    }
    if (dto.threshold !== undefined && (dto.threshold ?? undefined) !== existing.threshold) {
      updates.threshold = dto.threshold
    }
    if (dto.documentCount !== undefined && (dto.documentCount ?? undefined) !== existing.documentCount) {
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

    const row = await this.db.transaction(async (tx) => {
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

    await this.db.transaction(async (tx) => {
      await tx.delete(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, id))
    })

    logger.info('Deleted knowledge base', { id })
  }
}

export const knowledgeBaseService = new KnowledgeBaseService()
