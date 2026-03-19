/**
 * Knowledge Base Service (DataApi v2).
 *
 * Handles CRUD operations for knowledge bases stored in SQLite.
 */

import { dbService } from '@data/db/DbService'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateKnowledgeBaseDto, UpdateKnowledgeBaseDto } from '@shared/data/api/schemas/knowledges'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { desc, eq } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:KnowledgeBaseService')

function rowToKnowledgeBase(row: typeof knowledgeBaseTable.$inferSelect): KnowledgeBase {
  const parseJson = <T>(value: T | string | null | undefined): T | null => {
    if (value == null) return null
    if (typeof value === 'string') return JSON.parse(value)
    return value as T
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    dimensions: row.dimensions,
    embeddingModelId: row.embeddingModelId,
    embeddingModelMeta: parseJson(row.embeddingModelMeta),
    rerankModelId: row.rerankModelId ?? undefined,
    rerankModelMeta: parseJson(row.rerankModelMeta),
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
  private static instance: KnowledgeBaseService

  private constructor() {}

  public static getInstance(): KnowledgeBaseService {
    if (!KnowledgeBaseService.instance) {
      KnowledgeBaseService.instance = new KnowledgeBaseService()
    }
    return KnowledgeBaseService.instance
  }

  async list(): Promise<KnowledgeBase[]> {
    const db = dbService.getDb()
    const rows = await db.select().from(knowledgeBaseTable).orderBy(desc(knowledgeBaseTable.createdAt))
    return rows.map((row) => rowToKnowledgeBase(row))
  }

  async getById(id: string): Promise<KnowledgeBase> {
    const db = dbService.getDb()
    const [row] = await db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('KnowledgeBase', id)
    }

    return rowToKnowledgeBase(row)
  }

  async create(dto: CreateKnowledgeBaseDto): Promise<KnowledgeBase> {
    const db = dbService.getDb()

    if (!dto.name?.trim()) {
      throw DataApiErrorFactory.validation({ name: ['Name is required'] })
    }
    if (!dto.embeddingModelId?.trim()) {
      throw DataApiErrorFactory.validation({ embeddingModelId: ['Embedding model is required'] })
    }
    if (!Number.isFinite(dto.dimensions) || dto.dimensions <= 0) {
      throw DataApiErrorFactory.validation({ dimensions: ['Dimensions must be greater than 0'] })
    }

    const [row] = await db
      .insert(knowledgeBaseTable)
      .values({
        name: dto.name.trim(),
        description: dto.description,
        dimensions: dto.dimensions,
        embeddingModelId: dto.embeddingModelId.trim(),
        embeddingModelMeta: dto.embeddingModelMeta,
        rerankModelId: dto.rerankModelId,
        rerankModelMeta: dto.rerankModelMeta,
        fileProcessorId: dto.fileProcessorId,
        chunkSize: dto.chunkSize,
        chunkOverlap: dto.chunkOverlap,
        threshold: dto.threshold,
        documentCount: dto.documentCount,
        searchMode: dto.searchMode,
        hybridAlpha: dto.hybridAlpha
      })
      .returning()

    logger.info('Created knowledge base', { id: row.id, name: row.name })
    return rowToKnowledgeBase(row)
  }

  async update(id: string, dto: UpdateKnowledgeBaseDto): Promise<KnowledgeBase> {
    const db = dbService.getDb()
    await this.getById(id)

    if (dto.dimensions !== undefined && (!Number.isFinite(dto.dimensions) || dto.dimensions <= 0)) {
      throw DataApiErrorFactory.validation({ dimensions: ['Dimensions must be greater than 0'] })
    }

    const updates: Partial<typeof knowledgeBaseTable.$inferInsert> = {}
    if (dto.name !== undefined) updates.name = dto.name
    if (dto.description !== undefined) updates.description = dto.description
    if (dto.dimensions !== undefined) updates.dimensions = dto.dimensions
    if (dto.embeddingModelId !== undefined) updates.embeddingModelId = dto.embeddingModelId
    if (dto.embeddingModelMeta !== undefined) updates.embeddingModelMeta = dto.embeddingModelMeta
    if (dto.rerankModelId !== undefined) updates.rerankModelId = dto.rerankModelId
    if (dto.rerankModelMeta !== undefined) updates.rerankModelMeta = dto.rerankModelMeta
    if (dto.fileProcessorId !== undefined) updates.fileProcessorId = dto.fileProcessorId
    if (dto.chunkSize !== undefined) updates.chunkSize = dto.chunkSize
    if (dto.chunkOverlap !== undefined) updates.chunkOverlap = dto.chunkOverlap
    if (dto.threshold !== undefined) updates.threshold = dto.threshold
    if (dto.documentCount !== undefined) updates.documentCount = dto.documentCount
    if (dto.searchMode !== undefined) updates.searchMode = dto.searchMode
    if (dto.hybridAlpha !== undefined) updates.hybridAlpha = dto.hybridAlpha

    if (Object.keys(updates).length === 0) {
      throw DataApiErrorFactory.validation({ body: ['At least one field is required'] })
    }

    const [row] = await db.update(knowledgeBaseTable).set(updates).where(eq(knowledgeBaseTable.id, id)).returning()

    logger.info('Updated knowledge base', { id, changes: Object.keys(dto) })
    return rowToKnowledgeBase(row)
  }

  async delete(id: string): Promise<void> {
    const db = dbService.getDb()
    await this.getById(id)
    await db.delete(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, id))
    logger.info('Deleted knowledge base', { id })
  }
}

export const knowledgeBaseService = KnowledgeBaseService.getInstance()
