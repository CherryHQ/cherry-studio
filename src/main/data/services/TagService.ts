/**
 * Tag Service - handles tag CRUD and entity-tag association operations
 *
 * Provides business logic for:
 * - Tag CRUD operations
 * - Entity-tag association management (get by entity, sync, bulk set)
 *
 * USAGE GUIDANCE (read before wiring new call sites):
 * - Tag DataApi (handlers/tags.ts) is for managing tags themselves: create, rename,
 *   delete, and CRUD-ing entity↔tag associations from UI flows that directly manage tags.
 * - TagService (this class) backs that DataApi and is also the canonical place for
 *   entity services to keep associations in sync on create/update/delete.
 * - For READ paths that only need "entity X with its tags" (lists, cards, badges),
 *   DO NOT call TagService.getTagsByEntity per entity. JOIN `entity_tag` + `tag` inline
 *   in the owning entity's query (single round-trip). That is the fastest and correct
 *   pattern; TagService reads are scoped to tag-management flows.
 *
 * IMPORTANT: `entity_tag` is polymorphic and has no FK to assistant/topic/session tables.
 * Callers deleting tagged entities must invoke `purgeForEntity()` as part of their delete workflow.
 * TODO(v2): Wire session cleanup through this helper once the session table is migrated into the v2 data layer.
 */

import { application } from '@application'
import { entityTagTable, type TagSelect, tagTable } from '@data/db/schemas/tagging'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbType } from '@data/db/types'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateTagDto, SetTagEntitiesDto, SyncEntityTagsDto, UpdateTagDto } from '@shared/data/api/schemas/tags'
import type { EntityType } from '@shared/data/types/entityType'
import type { Tag } from '@shared/data/types/tag'
import { and, asc, eq, inArray, or, type SQL } from 'drizzle-orm'

import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:TagService')

type EntityBinding = SetTagEntitiesDto['entities'][number]

function entityBindingKey(entity: { entityType: string; entityId: string }): string {
  return `${entity.entityType}:${entity.entityId}`
}

function dedupeEntityBindings(entities: EntityBinding[]): EntityBinding[] {
  const uniqueEntities = new Map<string, EntityBinding>()

  for (const entity of entities) {
    const key = entityBindingKey(entity)
    if (!uniqueEntities.has(key)) {
      uniqueEntities.set(key, entity)
    }
  }

  return [...uniqueEntities.values()]
}

function buildEntityBindingCondition(entities: Array<{ entityType: string; entityId: string }>): SQL | undefined {
  const conditions = entities.map((entity) =>
    and(eq(entityTagTable.entityType, entity.entityType), eq(entityTagTable.entityId, entity.entityId))
  )

  if (conditions.length === 0) {
    return undefined
  }

  return conditions.length === 1 ? conditions[0] : or(...conditions)
}

/**
 * Convert database row to Tag entity
 */
function rowToTag(row: TagSelect): Tag {
  return {
    id: row.id,
    name: row.name,
    color: row.color ?? null,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export class TagService {
  private get db() {
    return application.get('DbService').getDb()
  }

  private async assertTagsExist(tx: Pick<DbType, 'select'>, tagIds: string[]): Promise<void> {
    const uniqueTagIds = [...new Set(tagIds)]

    if (uniqueTagIds.length === 0) {
      return
    }

    const existingTags = await tx.select({ id: tagTable.id }).from(tagTable).where(inArray(tagTable.id, uniqueTagIds))
    const existingTagIds = new Set(existingTags.map((tag) => tag.id))
    const missingTagIds = uniqueTagIds.filter((tagId) => !existingTagIds.has(tagId))

    if (missingTagIds.length > 0) {
      throw DataApiErrorFactory.notFound('Tag', missingTagIds.join(', '))
    }
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
    const [row] = await withSqliteErrors(
      () =>
        this.db
          .insert(tagTable)
          .values({
            name: dto.name,
            color: dto.color
          })
          .returning(),
      {
        ...defaultHandlersFor('Tag', dto.name),
        unique: () => DataApiErrorFactory.conflict(`Tag with name '${dto.name}' already exists`, 'Tag')
      }
    )

    logger.info('Created tag', { id: row.id, name: row.name })

    return rowToTag(row)
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

    const [row] = await withSqliteErrors(
      () => this.db.update(tagTable).set(updates).where(eq(tagTable.id, id)).returning(),
      {
        ...defaultHandlersFor('Tag', dto.name ?? id),
        unique: () =>
          DataApiErrorFactory.conflict(
            dto.name !== undefined
              ? `Tag with name '${dto.name}' already exists`
              : 'Tag update conflicts with an existing tag',
            'Tag'
          )
      }
    )

    if (!row) {
      throw DataApiErrorFactory.notFound('Tag', id)
    }

    logger.info('Updated tag', { id, changes: Object.keys(dto) })

    return rowToTag(row)
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
  async getTagsByEntity(entityType: EntityType, entityId: string): Promise<Tag[]> {
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
  async syncEntityTags(entityType: EntityType, entityId: string, dto: SyncEntityTagsDto): Promise<void> {
    const desiredTagIds = [...new Set(dto.tagIds)]

    await this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ tagId: entityTagTable.tagId })
        .from(entityTagTable)
        .where(and(eq(entityTagTable.entityType, entityType), eq(entityTagTable.entityId, entityId)))

      const existingIds = new Set(existing.map((row) => row.tagId))
      const desiredIds = new Set(desiredTagIds)

      const toRemove = existing.filter((row) => !desiredIds.has(row.tagId)).map((row) => row.tagId)
      const toAdd = desiredTagIds.filter((tagId) => !existingIds.has(tagId))

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
        await this.assertTagsExist(tx, toAdd)
        await tx.insert(entityTagTable).values(toAdd.map((tagId) => ({ entityType, entityId, tagId })))
      }
    })

    logger.info('Synced entity tags', { entityType, entityId, tagCount: desiredTagIds.length })
  }

  /**
   * Bulk set entities for a tag (replace all entity associations for this tag).
   * Performs diff-based sync to preserve unchanged association timestamps.
   */
  async setEntities(tagId: string, dto: SetTagEntitiesDto): Promise<void> {
    const desiredEntities = dedupeEntityBindings(dto.entities)

    await this.db.transaction(async (tx) => {
      const [tag] = await tx.select({ id: tagTable.id }).from(tagTable).where(eq(tagTable.id, tagId)).limit(1)

      if (!tag) {
        throw DataApiErrorFactory.notFound('Tag', tagId)
      }

      const existing = await tx
        .select({ entityType: entityTagTable.entityType, entityId: entityTagTable.entityId })
        .from(entityTagTable)
        .where(eq(entityTagTable.tagId, tagId))

      const existingKeys = new Set(existing.map((entity) => entityBindingKey(entity)))
      const desiredKeys = new Set(desiredEntities.map((entity) => entityBindingKey(entity)))

      const toRemove = existing.filter((entity) => !desiredKeys.has(entityBindingKey(entity)))
      const toAdd = desiredEntities.filter((entity) => !existingKeys.has(entityBindingKey(entity)))

      const deleteCondition = buildEntityBindingCondition(toRemove)
      if (deleteCondition) {
        await tx.delete(entityTagTable).where(and(eq(entityTagTable.tagId, tagId), deleteCondition))
      }

      if (toAdd.length > 0) {
        await tx.insert(entityTagTable).values(toAdd.map((entity) => ({ ...entity, tagId })))
      }
    })

    logger.info('Set tag entities', { tagId, entityCount: desiredEntities.length })
  }

  /**
   * Remove all tag associations for a given entity.
   * Must be called by entity services (AssistantService, TopicService, etc.)
   * when deleting an entity, since entity_tag has no FK to entity tables.
   *
   * Signature is tx-first to match the polymorphic-purge convention
   * (see PinService.purgeForEntity).
   */
  async purgeForEntity(tx: Pick<DbType, 'delete'>, entityType: EntityType, entityId: string): Promise<void> {
    await tx
      .delete(entityTagTable)
      .where(and(eq(entityTagTable.entityType, entityType), eq(entityTagTable.entityId, entityId)))

    logger.info('Purged tags for entity', { entityType, entityId })
  }

  /**
   * Get tag IDs for multiple entities of the same type (batch query).
   * Used by other services (e.g., AssistantService) to efficiently load tags.
   */
  async getTagIdsByEntities(entityType: EntityType, entityIds: string[]): Promise<Map<string, string[]>> {
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
      .orderBy(asc(entityTagTable.entityId), asc(entityTagTable.createdAt), asc(entityTagTable.tagId))

    for (const row of rows) {
      result.get(row.entityId)?.push(row.tagId)
    }

    return result
  }
}

export const tagService = new TagService()
