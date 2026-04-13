/**
 * Tag Service - handles tag CRUD and entity-tag association operations
 *
 * Provides business logic for:
 * - Tag CRUD operations
 * - Entity-tag association management (get by entity, sync, bulk set)
 */

import { application } from '@application'
import { entityTagTable, tagTable } from '@data/db/schemas/tagging'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateTagDto, SetTagEntitiesDto, SyncEntityTagsDto, UpdateTagDto } from '@shared/data/api/schemas/tags'
import type { Tag, TaggableEntityType } from '@shared/data/types/tag'
import { and, asc, eq, inArray } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:TagService')

type TagRow = typeof tagTable.$inferSelect

/**
 * Convert database row to Tag entity
 */
function rowToTag(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    color: row.color ?? null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
  }
}

export class TagDataService {
  private get db() {
    return application.get('DbService').getDb()
  }

  /**
   * List all tags
   */
  async list(): Promise<Tag[]> {
    const rows = await this.db.select().from(tagTable).orderBy(asc(tagTable.name))
    return rows.map(rowToTag)
  }

  /**
   * Get a tag by ID
   */
  async getById(id: string): Promise<Tag> {
    const [row] = await this.db.select().from(tagTable).where(eq(tagTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Tag', id)
    }

    return rowToTag(row)
  }

  /**
   * Create a new tag
   */
  async create(dto: CreateTagDto): Promise<Tag> {
    try {
      const [row] = await this.db
        .insert(tagTable)
        .values({
          name: dto.name,
          color: dto.color
        })
        .returning()

      logger.info('Created tag', { id: row.id, name: row.name })

      return rowToTag(row)
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('UNIQUE constraint failed')) {
        throw DataApiErrorFactory.conflict(`Tag with name '${dto.name}' already exists`, 'Tag')
      }
      throw e
    }
  }

  /**
   * Update an existing tag
   */
  async update(id: string, dto: UpdateTagDto): Promise<Tag> {
    const updates: Partial<typeof tagTable.$inferInsert> = {}
    if (dto.name !== undefined) updates.name = dto.name
    if (dto.color !== undefined) updates.color = dto.color

    if (Object.keys(updates).length === 0) {
      return this.getById(id)
    }

    try {
      const [row] = await this.db.update(tagTable).set(updates).where(eq(tagTable.id, id)).returning()

      if (!row) {
        throw DataApiErrorFactory.notFound('Tag', id)
      }

      logger.info('Updated tag', { id, changes: Object.keys(dto) })

      return rowToTag(row)
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('UNIQUE constraint failed')) {
        throw DataApiErrorFactory.conflict(`Tag with name '${dto.name}' already exists`, 'Tag')
      }
      throw e
    }
  }

  /**
   * Delete a tag (hard delete, cascades to entity_tag via FK)
   */
  async delete(id: string): Promise<void> {
    const [row] = await this.db.delete(tagTable).where(eq(tagTable.id, id)).returning({ id: tagTable.id })

    if (!row) {
      throw DataApiErrorFactory.notFound('Tag', id)
    }

    logger.info('Deleted tag', { id })
  }

  /**
   * Get tags for a specific entity
   */
  async getTagsByEntity(entityType: TaggableEntityType, entityId: string): Promise<Tag[]> {
    const rows = await this.db
      .select({
        id: tagTable.id,
        name: tagTable.name,
        color: tagTable.color,
        createdAt: tagTable.createdAt,
        updatedAt: tagTable.updatedAt
      })
      .from(entityTagTable)
      .innerJoin(tagTable, eq(entityTagTable.tagId, tagTable.id))
      .where(and(eq(entityTagTable.entityType, entityType), eq(entityTagTable.entityId, entityId)))
      .orderBy(asc(tagTable.name))

    return rows.map(rowToTag)
  }

  /**
   * Sync tags for an entity (replace all tag associations).
   * Performs diff-based sync: only deletes removed and inserts added associations.
   */
  async syncEntityTags(entityType: TaggableEntityType, entityId: string, dto: SyncEntityTagsDto): Promise<void> {
    const { tagIds } = dto

    await this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ tagId: entityTagTable.tagId })
        .from(entityTagTable)
        .where(and(eq(entityTagTable.entityType, entityType), eq(entityTagTable.entityId, entityId)))

      const existingIds = new Set(existing.map((r) => r.tagId))
      const desiredIds = new Set(tagIds)

      const toRemove = existing.filter((r) => !desiredIds.has(r.tagId)).map((r) => r.tagId)
      const toAdd = tagIds.filter((id) => !existingIds.has(id))

      if (toRemove.length > 0) {
        await tx
          .delete(entityTagTable)
          .where(
            and(
              eq(entityTagTable.entityType, entityType),
              eq(entityTagTable.entityId, entityId),
              inArray(entityTagTable.tagId, toRemove)
            )
          )
      }

      if (toAdd.length > 0) {
        await tx.insert(entityTagTable).values(toAdd.map((tagId) => ({ entityType, entityId, tagId })))
      }
    })

    logger.info('Synced entity tags', { entityType, entityId, tagCount: tagIds.length })
  }

  /**
   * Bulk set entities for a tag (replace all entity associations for this tag).
   * Performs diff-based sync: only deletes removed and inserts added associations.
   */
  async setEntities(tagId: string, dto: SetTagEntitiesDto): Promise<void> {
    await this.getById(tagId)

    await this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ entityType: entityTagTable.entityType, entityId: entityTagTable.entityId })
        .from(entityTagTable)
        .where(eq(entityTagTable.tagId, tagId))

      const existingKeys = new Set(existing.map((r) => `${r.entityType}:${r.entityId}`))
      const desiredKeys = new Set(dto.entities.map((e) => `${e.entityType}:${e.entityId}`))

      const toRemove = existing.filter((r) => !desiredKeys.has(`${r.entityType}:${r.entityId}`))
      const toAdd = dto.entities.filter((e) => !existingKeys.has(`${e.entityType}:${e.entityId}`))

      for (const r of toRemove) {
        await tx
          .delete(entityTagTable)
          .where(
            and(
              eq(entityTagTable.tagId, tagId),
              eq(entityTagTable.entityType, r.entityType),
              eq(entityTagTable.entityId, r.entityId)
            )
          )
      }

      if (toAdd.length > 0) {
        await tx
          .insert(entityTagTable)
          .values(toAdd.map((e) => ({ entityType: e.entityType, entityId: e.entityId, tagId })))
      }
    })

    logger.info('Set tag entities', { tagId, entityCount: dto.entities.length })
  }

  /**
   * Get tag IDs for multiple entities of the same type (batch query).
   * Used by other services (e.g., AssistantService) to efficiently load tags.
   */
  async getTagIdsByEntities(entityType: TaggableEntityType, entityIds: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>()

    if (entityIds.length === 0) {
      return result
    }

    for (const id of entityIds) {
      result.set(id, [])
    }

    const rows = await this.db
      .select({ entityId: entityTagTable.entityId, tagId: entityTagTable.tagId })
      .from(entityTagTable)
      .where(and(eq(entityTagTable.entityType, entityType), inArray(entityTagTable.entityId, entityIds)))
      .orderBy(asc(entityTagTable.entityId), asc(entityTagTable.createdAt))

    for (const row of rows) {
      result.get(row.entityId)?.push(row.tagId)
    }

    return result
  }
}

export const tagDataService = new TagDataService()
