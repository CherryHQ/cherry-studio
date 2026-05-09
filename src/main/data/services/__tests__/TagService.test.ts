import { entityTagTable, tagTable } from '@data/db/schemas/tagging'
import { TagService, tagService } from '@data/services/TagService'
import { DataApiError, ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

const TAG_1 = '11111111-1111-4111-8111-111111111111'
const TAG_2 = '22222222-2222-4222-8222-222222222222'
const TAG_3 = '33333333-3333-4333-8333-333333333333'
const ASSISTANT_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const ASSISTANT_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const TOPIC_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'

describe('TagService', () => {
  const dbh = setupTestDatabase()

  async function seedTags() {
    await dbh.db.insert(tagTable).values([
      { id: TAG_1, name: 'work', color: '#ff0000', createdAt: 1, updatedAt: 1 },
      { id: TAG_2, name: 'personal', color: null, createdAt: 2, updatedAt: 2 },
      { id: TAG_3, name: 'coding', color: '#00ff00', createdAt: 3, updatedAt: 3 }
    ])
  }

  it('should export a module-level singleton', () => {
    expect(tagService).toBeInstanceOf(TagService)
  })

  describe('list', () => {
    it('should return all tags ordered by name', async () => {
      await seedTags()

      const result = await tagService.list()

      expect(result.map((tag) => tag.name)).toEqual(['coding', 'personal', 'work'])
      expect(result[0]).toMatchObject({ id: TAG_3, color: '#00ff00' })
      expect(result[1].color).toBeNull()
    })

    it('should return an empty array when no tags exist', async () => {
      await expect(tagService.list()).resolves.toEqual([])
    })
  })

  describe('getById', () => {
    it('should return a fully mapped tag when found', async () => {
      await seedTags()

      const result = await tagService.getById(TAG_1)

      expect(result).toMatchObject({
        id: TAG_1,
        name: 'work',
        color: '#ff0000',
        createdAt: new Date(1).toISOString(),
        updatedAt: new Date(1).toISOString()
      })
    })

    it('should throw NOT_FOUND when tag does not exist', async () => {
      await expect(tagService.getById(TAG_1)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('create', () => {
    it('should create and persist a tag', async () => {
      const result = await tagService.create({ name: 'work', color: '#ff0000' })

      expect(result.name).toBe('work')
      const [row] = await dbh.db.select().from(tagTable).where(eq(tagTable.id, result.id))
      expect(row).toMatchObject({ name: 'work', color: '#ff0000' })
    })

    it('should throw CONFLICT when name already exists', async () => {
      await seedTags()

      await expect(tagService.create({ name: 'work' })).rejects.toThrow(DataApiError)
      await expect(tagService.create({ name: 'work' })).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
        message: "Tag with name 'work' already exists"
      })
    })
  })

  describe('update', () => {
    it('should update and return a tag', async () => {
      await seedTags()

      const result = await tagService.update(TAG_1, { name: 'updated', color: '#0000ff' })

      expect(result).toMatchObject({ name: 'updated', color: '#0000ff' })
      const [row] = await dbh.db.select().from(tagTable).where(eq(tagTable.id, TAG_1))
      expect(row).toMatchObject({ name: 'updated', color: '#0000ff' })
    })

    it('should support clearing color to null', async () => {
      await seedTags()

      const result = await tagService.update(TAG_1, { color: null })

      expect(result.color).toBeNull()
    })

    it('should return the current row for an empty update payload', async () => {
      await seedTags()

      const result = await tagService.update(TAG_1, {})

      expect(result).toMatchObject({ id: TAG_1, name: 'work' })
    })

    it('should throw NOT_FOUND when no row exists', async () => {
      await expect(tagService.update(TAG_1, { name: 'x' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should throw CONFLICT on duplicate name', async () => {
      await seedTags()

      await expect(tagService.update(TAG_1, { name: 'personal' })).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
        message: "Tag with name 'personal' already exists"
      })
    })
  })

  describe('delete', () => {
    it('should delete a tag and cascade its entity bindings', async () => {
      await seedTags()
      await dbh.db.insert(entityTagTable).values({
        entityType: 'assistant',
        entityId: ASSISTANT_1,
        tagId: TAG_1,
        createdAt: 10,
        updatedAt: 10
      })

      await expect(tagService.delete(TAG_1)).resolves.toBeUndefined()

      expect(await dbh.db.select().from(tagTable)).toHaveLength(2)
      expect(await dbh.db.select().from(entityTagTable)).toHaveLength(0)
    })

    it('should throw NOT_FOUND when deleting a missing tag', async () => {
      await expect(tagService.delete(TAG_1)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('getTagsByEntity', () => {
    it('should return mapped tags for an entity ordered by tag name', async () => {
      await seedTags()
      await dbh.db.insert(entityTagTable).values([
        { entityType: 'assistant', entityId: ASSISTANT_1, tagId: TAG_1, createdAt: 10, updatedAt: 10 },
        { entityType: 'assistant', entityId: ASSISTANT_1, tagId: TAG_3, createdAt: 11, updatedAt: 11 }
      ])

      const result = await tagService.getTagsByEntity('assistant', ASSISTANT_1)

      expect(result.map((tag) => tag.name)).toEqual(['coding', 'work'])
    })

    it('should return an empty array when the entity has no tags', async () => {
      await expect(tagService.getTagsByEntity('assistant', ASSISTANT_1)).resolves.toEqual([])
    })
  })

  describe('getTagsByEntities', () => {
    it('should return full Tag objects keyed by entityId, alphabetical within each group', async () => {
      await seedTags()
      await dbh.db.insert(entityTagTable).values([
        { entityType: 'assistant', entityId: ASSISTANT_1, tagId: TAG_2, createdAt: 1000, updatedAt: 1000 },
        { entityType: 'assistant', entityId: ASSISTANT_1, tagId: TAG_1, createdAt: 1001, updatedAt: 1001 },
        { entityType: 'assistant', entityId: ASSISTANT_2, tagId: TAG_3, createdAt: 2000, updatedAt: 2000 }
      ])

      const result = await tagService.getTagsByEntities('assistant', [ASSISTANT_1, ASSISTANT_2, TOPIC_1])

      expect(result.get(ASSISTANT_1)?.map((t) => t.name)).toEqual(['personal', 'work'])
      expect(result.get(ASSISTANT_1)?.[0]).toMatchObject({ id: TAG_2, color: null })
      expect(result.get(ASSISTANT_2)?.map((t) => t.name)).toEqual(['coding'])
      expect(result.get(TOPIC_1)).toEqual([])
    })

    it('should ignore bindings of other entity types', async () => {
      await seedTags()
      await dbh.db.insert(entityTagTable).values([
        { entityType: 'assistant', entityId: ASSISTANT_1, tagId: TAG_1, createdAt: 1, updatedAt: 1 },
        { entityType: 'topic', entityId: ASSISTANT_1, tagId: TAG_2, createdAt: 2, updatedAt: 2 }
      ])

      const result = await tagService.getTagsByEntities('assistant', [ASSISTANT_1])

      expect(result.get(ASSISTANT_1)?.map((t) => t.id)).toEqual([TAG_1])
    })

    it('should return an empty map for empty input without querying entity rows', async () => {
      const result = await tagService.getTagsByEntities('assistant', [])
      expect(result.size).toBe(0)
    })

    it('should observe writes from a passed-in transaction', async () => {
      await seedTags()

      await dbh.db.transaction(async (tx) => {
        await tx
          .insert(entityTagTable)
          .values({ entityType: 'assistant', entityId: ASSISTANT_1, tagId: TAG_1, createdAt: 1, updatedAt: 1 })
        const result = await tagService.getTagsByEntities('assistant', [ASSISTANT_1], tx)
        expect(result.get(ASSISTANT_1)?.map((t) => t.id)).toEqual([TAG_1])
      })
    })
  })

  describe('getEntityIdsByTags', () => {
    it('should return unique entity ids matching the given tags and entity type', async () => {
      await seedTags()
      await dbh.db.insert(entityTagTable).values([
        { entityType: 'assistant', entityId: ASSISTANT_1, tagId: TAG_1, createdAt: 1, updatedAt: 1 },
        { entityType: 'assistant', entityId: ASSISTANT_1, tagId: TAG_2, createdAt: 2, updatedAt: 2 },
        { entityType: 'assistant', entityId: ASSISTANT_2, tagId: TAG_2, createdAt: 3, updatedAt: 3 },
        { entityType: 'topic', entityId: TOPIC_1, tagId: TAG_2, createdAt: 4, updatedAt: 4 }
      ])

      const result = await tagService.getEntityIdsByTags('assistant', [TAG_1, TAG_2, TAG_2])

      expect(result.sort()).toEqual([ASSISTANT_1, ASSISTANT_2])
    })

    it('should return an empty array for empty tag input', async () => {
      await expect(tagService.getEntityIdsByTags('assistant', [])).resolves.toEqual([])
    })
  })

  describe('syncEntityTags', () => {
    it('should diff associations and preserve createdAt for unchanged tags', async () => {
      await seedTags()
      await dbh.db.insert(entityTagTable).values([
        { entityType: 'assistant', entityId: ASSISTANT_1, tagId: TAG_1, createdAt: 1000, updatedAt: 1000 },
        { entityType: 'assistant', entityId: ASSISTANT_1, tagId: TAG_2, createdAt: 2000, updatedAt: 2000 }
      ])

      await tagService.syncEntityTags('assistant', ASSISTANT_1, {
        tagIds: [TAG_2, TAG_3]
      })

      const rows = (await dbh.db.select().from(entityTagTable)).filter(
        (row) => row.entityType === 'assistant' && row.entityId === ASSISTANT_1
      )

      expect(rows).toHaveLength(2)
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tagId: TAG_2, createdAt: 2000 }),
          expect.objectContaining({ tagId: TAG_3 })
        ])
      )
      expect(rows.find((row) => row.tagId === TAG_1)).toBeUndefined()
    })

    it('should fail with NOT_FOUND and avoid partial writes for missing tags', async () => {
      await seedTags()
      await dbh.db.insert(entityTagTable).values({
        entityType: 'assistant',
        entityId: ASSISTANT_1,
        tagId: TAG_1,
        createdAt: 1000,
        updatedAt: 1000
      })

      await expect(
        tagService.syncEntityTags('assistant', ASSISTANT_1, {
          tagIds: [TAG_2, '44444444-4444-4444-8444-444444444444']
        })
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: "Tag with id '44444444-4444-4444-8444-444444444444' not found"
      })

      const rows = (await dbh.db.select().from(entityTagTable)).filter(
        (row) => row.entityType === 'assistant' && row.entityId === ASSISTANT_1
      )
      expect(rows).toEqual([expect.objectContaining({ tagId: TAG_1, createdAt: 1000 })])
    })
  })

  describe('setEntities', () => {
    it('should diff entity bindings and preserve createdAt for unchanged rows', async () => {
      await seedTags()
      await dbh.db.insert(entityTagTable).values([
        { entityType: 'assistant', entityId: ASSISTANT_1, tagId: TAG_1, createdAt: 1000, updatedAt: 1000 },
        { entityType: 'topic', entityId: TOPIC_1, tagId: TAG_1, createdAt: 2000, updatedAt: 2000 }
      ])

      await tagService.setEntities(TAG_1, {
        entities: [
          { entityType: 'topic', entityId: TOPIC_1 },
          { entityType: 'assistant', entityId: ASSISTANT_2 }
        ]
      })

      const rows = (await dbh.db.select().from(entityTagTable)).filter((row) => row.tagId === TAG_1)

      expect(rows).toHaveLength(2)
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ entityType: 'topic', entityId: TOPIC_1, createdAt: 2000 }),
          expect.objectContaining({ entityType: 'assistant', entityId: ASSISTANT_2 })
        ])
      )
      expect(rows.find((row) => row.entityId === ASSISTANT_1)).toBeUndefined()
    })

    it('should remove all bindings when the entity list is empty', async () => {
      await seedTags()
      await dbh.db.insert(entityTagTable).values({
        entityType: 'assistant',
        entityId: ASSISTANT_1,
        tagId: TAG_1,
        createdAt: 1000,
        updatedAt: 1000
      })

      await tagService.setEntities(TAG_1, { entities: [] })

      const rows = (await dbh.db.select().from(entityTagTable)).filter((row) => row.tagId === TAG_1)
      expect(rows).toEqual([])
    })

    it('should deduplicate duplicate desired entities before insert', async () => {
      await seedTags()

      await tagService.setEntities(TAG_1, {
        entities: [
          { entityType: 'assistant', entityId: ASSISTANT_1 },
          { entityType: 'assistant', entityId: ASSISTANT_1 }
        ]
      })

      const rows = (await dbh.db.select().from(entityTagTable)).filter((row) => row.tagId === TAG_1)
      expect(rows).toEqual([expect.objectContaining({ entityType: 'assistant', entityId: ASSISTANT_1, tagId: TAG_1 })])
    })

    it('should throw NOT_FOUND when the tag does not exist', async () => {
      await expect(tagService.setEntities(TAG_1, { entities: [] })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('purgeForEntityTx', () => {
    it('should remove only tag rows for the target entity', async () => {
      await seedTags()
      await dbh.db.insert(entityTagTable).values([
        { entityType: 'assistant', entityId: ASSISTANT_1, tagId: TAG_1, createdAt: 1, updatedAt: 1 },
        { entityType: 'assistant', entityId: ASSISTANT_2, tagId: TAG_1, createdAt: 1, updatedAt: 1 },
        { entityType: 'topic', entityId: TOPIC_1, tagId: TAG_2, createdAt: 1, updatedAt: 1 }
      ])

      await tagService.purgeForEntityTx(dbh.db, 'assistant', ASSISTANT_1)

      const rows = await dbh.db.select().from(entityTagTable)
      expect(rows).toEqual([
        expect.objectContaining({ entityType: 'assistant', entityId: ASSISTANT_2, tagId: TAG_1 }),
        expect.objectContaining({ entityType: 'topic', entityId: TOPIC_1, tagId: TAG_2 })
      ])
    })
  })

  describe('purgeForEntitiesTx', () => {
    it('should be a no-op when entityIds is empty', async () => {
      await seedTags()
      await dbh.db
        .insert(entityTagTable)
        .values([{ entityType: 'assistant', entityId: ASSISTANT_1, tagId: TAG_1, createdAt: 1, updatedAt: 1 }])

      await expect(tagService.purgeForEntitiesTx(dbh.db, 'assistant', [])).resolves.toBeUndefined()

      const rows = await dbh.db.select().from(entityTagTable)
      expect(rows).toHaveLength(1)
    })

    it('should be equivalent to purgeForEntityTx for a single id', async () => {
      await seedTags()
      await dbh.db.insert(entityTagTable).values([
        { entityType: 'assistant', entityId: ASSISTANT_1, tagId: TAG_1, createdAt: 1, updatedAt: 1 },
        { entityType: 'assistant', entityId: ASSISTANT_2, tagId: TAG_2, createdAt: 1, updatedAt: 1 }
      ])

      await tagService.purgeForEntitiesTx(dbh.db, 'assistant', [ASSISTANT_1])

      const rows = await dbh.db.select().from(entityTagTable)
      expect(rows).toEqual([expect.objectContaining({ entityType: 'assistant', entityId: ASSISTANT_2, tagId: TAG_2 })])
    })

    it('should bulk-delete associations for all listed ids and leave other entityTypes alone', async () => {
      await seedTags()
      await dbh.db.insert(entityTagTable).values([
        { entityType: 'assistant', entityId: ASSISTANT_1, tagId: TAG_1, createdAt: 1, updatedAt: 1 },
        { entityType: 'assistant', entityId: ASSISTANT_1, tagId: TAG_2, createdAt: 1, updatedAt: 1 },
        { entityType: 'assistant', entityId: ASSISTANT_2, tagId: TAG_3, createdAt: 1, updatedAt: 1 },
        { entityType: 'topic', entityId: TOPIC_1, tagId: TAG_1, createdAt: 1, updatedAt: 1 }
      ])

      await tagService.purgeForEntitiesTx(dbh.db, 'assistant', [ASSISTANT_1, ASSISTANT_2])

      const rows = await dbh.db.select().from(entityTagTable)
      expect(rows).toEqual([expect.objectContaining({ entityType: 'topic', entityId: TOPIC_1, tagId: TAG_1 })])
    })

    it('should not affect rows where the same entityId belongs to a different entityType', async () => {
      await seedTags()
      // The same UUID is reused as both an assistant id and a topic id to verify
      // the (entityType, entityId) compound match is exact, not entityId-only.
      await dbh.db.insert(entityTagTable).values([
        { entityType: 'assistant', entityId: ASSISTANT_1, tagId: TAG_1, createdAt: 1, updatedAt: 1 },
        { entityType: 'topic', entityId: ASSISTANT_1, tagId: TAG_2, createdAt: 1, updatedAt: 1 }
      ])

      await tagService.purgeForEntitiesTx(dbh.db, 'assistant', [ASSISTANT_1])

      const rows = await dbh.db.select().from(entityTagTable)
      expect(rows).toEqual([expect.objectContaining({ entityType: 'topic', entityId: ASSISTANT_1, tagId: TAG_2 })])
    })
  })
})
