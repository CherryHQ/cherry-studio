/**
/**
 * Knowledge Base Service (DataApi v2)
 *
 * Handles CRUD operations for knowledge bases stored in SQLite,
 * and bridges vector operations via KnowledgeServiceV2.
 */

import { dbService } from '@data/db/DbService'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { loggerService } from '@logger'
import { knowledgeServiceV2 } from '@main/services/knowledge/KnowledgeServiceV2'
import { DataApiErrorFactory, ErrorCode } from '@shared/data/api'
import type {
  CreateKnowledgeBaseDto,
  KnowledgeSearchRequest,
  UpdateKnowledgeBaseDto
} from '@shared/data/api/schemas/knowledges'
import type { KnowledgeBase, KnowledgeSearchResult } from '@shared/data/types/knowledge'
import { desc, eq } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:KnowledgeBaseService')

function rowToKnowledgeBase(row: typeof knowledgeBaseTable.$inferSelect): KnowledgeBase {
  // Handle JSON strings from raw SQL queries (db.all with sql``)
  // ORM queries (.select().from()) return already-parsed objects
  const parseJson = <T>(value: T | string | null | undefined): T | null => {
    if (value == null) return null
    if (typeof value === 'string') return JSON.parse(value)
    return value as T
  }

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

  /**
   * List all knowledge bases
   */
  async list(): Promise<KnowledgeBase[]> {
    const db = dbService.getDb()
    const rows = await db.select().from(knowledgeBaseTable).orderBy(desc(knowledgeBaseTable.createdAt))
    return rows.map((row) => rowToKnowledgeBase(row))
  }

  /**
   * Get a knowledge base by ID
   */
  async getById(id: string): Promise<KnowledgeBase> {
    const db = dbService.getDb()
    const [row] = await db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('KnowledgeBase', id)
    }

    return rowToKnowledgeBase(row)
  }

  /**
   * Create a knowledge base
   */
  async create(dto: CreateKnowledgeBaseDto): Promise<KnowledgeBase> {
    const db = dbService.getDb()

    if (!dto.name?.trim()) {
      throw DataApiErrorFactory.validation({ name: ['Name is required'] })
    }
    if (!dto.embeddingModelId?.trim()) {
      throw DataApiErrorFactory.validation({ embeddingModelId: ['Embedding model is required'] })
    }

    return await db.transaction(async (tx) => {
      const [row] = await tx
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

      const base = rowToKnowledgeBase(row)

      try {
        await knowledgeServiceV2.create(base)
        logger.info('Created knowledge base with vector store', { id: base.id, name: base.name })
      } catch (error) {
        logger.error('Failed to initialize vector store', error as Error, { id: base.id })
        throw DataApiErrorFactory.create(
          ErrorCode.SERVICE_UNAVAILABLE,
          `Failed to initialize vector store: ${error instanceof Error ? error.message : String(error)}`
        )
      }

      return base
    })
  }

  /**
   * Update a knowledge base
   */
  async update(id: string, dto: UpdateKnowledgeBaseDto): Promise<KnowledgeBase> {
    const db = dbService.getDb()

    await this.getById(id)

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

    return rowToKnowledgeBase(row)
  }

  /**
   * Delete a knowledge base
   */
  async delete(id: string): Promise<void> {
    const db = dbService.getDb()

    await this.getById(id)

    await knowledgeServiceV2.delete(id)
    await db.delete(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, id))

    logger.info('Deleted knowledge base', { id })
  }

  /**
   * Search knowledge base
   */
  async search(baseId: string, request?: KnowledgeSearchRequest): Promise<KnowledgeSearchResult[]> {
    const base = await this.getById(baseId)

    if (!request || !request.search?.trim()) {
      throw DataApiErrorFactory.validation({ search: ['Search query is required'] })
    }

    return await knowledgeServiceV2.search({
      search: request.search,
      base
    })
  }
}

export const knowledgeBaseService = KnowledgeBaseService.getInstance()
