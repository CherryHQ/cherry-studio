import { knowledgeItemTable } from '@data/db/schemas/knowledge'
import type { DbType } from '@data/db/types'
import { application } from '@main/core/application'
import type { CreateKnowledgeItemsDto, KnowledgeItemsQuery } from '@shared/data/api/schemas/knowledges'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'

export type KnowledgeItemRow = typeof knowledgeItemTable.$inferSelect

export type PlannedKnowledgeItemInsert = CreateKnowledgeItemsDto['items'][number] & {
  parsedData: CreateKnowledgeItemsDto['items'][number]['data']
  index: number
}

type KnowledgeItemDbExecutor = Pick<DbType, 'all' | 'delete' | 'insert' | 'select' | 'update'>

export class KnowledgeItemRepository {
  private get db() {
    return application.get('DbService').getDb()
  }

  async list(baseId: string, query: KnowledgeItemsQuery): Promise<{ rows: KnowledgeItemRow[]; total: number }> {
    const { page, limit, type, groupId } = query
    const offset = (page - 1) * limit
    const conditions = [eq(knowledgeItemTable.baseId, baseId)]

    if (type !== undefined) {
      conditions.push(eq(knowledgeItemTable.type, type))
    }
    if (groupId !== undefined) {
      conditions.push(eq(knowledgeItemTable.groupId, groupId))
    }

    const where = conditions.length === 1 ? conditions[0] : and(...conditions)
    const [rows, [{ count }]] = await Promise.all([
      this.db
        .select()
        .from(knowledgeItemTable)
        .where(where)
        .orderBy(desc(knowledgeItemTable.createdAt), desc(knowledgeItemTable.id))
        .limit(limit)
        .offset(offset),
      this.db.select({ count: sql<number>`count(*)` }).from(knowledgeItemTable).where(where)
    ])

    return { rows, total: count }
  }

  async getExistingGroupIdsInBase(baseId: string, groupIds: string[]): Promise<Set<string>> {
    const uniqueGroupIds = [...new Set(groupIds)]

    if (uniqueGroupIds.length === 0) {
      return new Set()
    }

    const rows = await this.db
      .select({ id: knowledgeItemTable.id })
      .from(knowledgeItemTable)
      .where(and(eq(knowledgeItemTable.baseId, baseId), inArray(knowledgeItemTable.id, uniqueGroupIds)))

    return new Set(rows.map((row) => row.id))
  }

  async createMany(
    baseId: string,
    plannedItems: PlannedKnowledgeItemInsert[]
  ): Promise<Array<KnowledgeItemRow | undefined>> {
    const rowsByIndex = new Map<number, KnowledgeItemRow>()
    const itemsByRef = new Map<string, KnowledgeItemRow>()

    await this.db.transaction(async (tx) => {
      const pendingItems = [...plannedItems]

      while (pendingItems.length > 0) {
        const readyItems = pendingItems.filter((item) => item.groupRef == null || itemsByRef.has(item.groupRef))

        for (const item of readyItems) {
          const groupId = item.groupRef ? (itemsByRef.get(item.groupRef)?.id ?? null) : (item.groupId ?? null)
          const [row] = await this.insertOne(tx, {
            baseId,
            groupId,
            type: item.type,
            data: item.parsedData,
            status: 'idle',
            error: null
          })

          rowsByIndex.set(item.index, row)

          if (item.ref) {
            itemsByRef.set(item.ref, row)
          }
        }

        const readyIndices = new Set(readyItems.map((item) => item.index))
        for (let index = pendingItems.length - 1; index >= 0; index -= 1) {
          if (readyIndices.has(pendingItems[index].index)) {
            pendingItems.splice(index, 1)
          }
        }
      }
    })

    return plannedItems.map((item) => rowsByIndex.get(item.index))
  }

  async findById(id: string): Promise<KnowledgeItemRow | undefined> {
    const [row] = await this.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, id)).limit(1)
    return row
  }

  async getByIdsInBase(baseId: string, itemIds: string[]): Promise<KnowledgeItemRow[]> {
    const uniqueItemIds = [...new Set(itemIds)]

    if (uniqueItemIds.length === 0) {
      return []
    }

    const rows = await this.db
      .select()
      .from(knowledgeItemTable)
      .where(and(eq(knowledgeItemTable.baseId, baseId), inArray(knowledgeItemTable.id, uniqueItemIds)))

    const rowsById = new Map(rows.map((row) => [row.id, row]))
    return uniqueItemIds.flatMap((itemId) => {
      const row = rowsById.get(itemId)
      return row ? [row] : []
    })
  }

  async getCascadeDescendantIdsInBase(baseId: string, rootIds: string[]): Promise<string[]> {
    const uniqueRootIds = [...new Set(rootIds)]

    if (uniqueRootIds.length === 0) {
      return []
    }

    const descendantRows = await this.db.all<{ id: string }>(sql`
      WITH RECURSIVE descendants AS (
        SELECT id
        FROM knowledge_item
        WHERE base_id = ${baseId}
          AND group_id IN (${sql.join(
            uniqueRootIds.map((id) => sql`${id}`),
            sql`, `
          )})

        UNION ALL

        SELECT child.id
        FROM knowledge_item child
        INNER JOIN descendants parent ON child.group_id = parent.id
        WHERE child.base_id = ${baseId}
      )
      SELECT DISTINCT id FROM descendants
    `)

    return descendantRows.map((row) => row.id)
  }

  async update(
    id: string,
    updates: Partial<typeof knowledgeItemTable.$inferInsert>
  ): Promise<KnowledgeItemRow | undefined> {
    const [row] = await this.db.update(knowledgeItemTable).set(updates).where(eq(knowledgeItemTable.id, id)).returning()
    return row
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(knowledgeItemTable).where(eq(knowledgeItemTable.id, id))
  }

  private async insertOne(
    db: KnowledgeItemDbExecutor,
    values: typeof knowledgeItemTable.$inferInsert
  ): Promise<KnowledgeItemRow[]> {
    return await db.insert(knowledgeItemTable).values(values).returning()
  }
}

export const knowledgeItemRepository = new KnowledgeItemRepository()
