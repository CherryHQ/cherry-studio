import { knowledgeItemTable } from '@data/db/schemas/knowledge'
import type { DbType } from '@data/db/types'
import { application } from '@main/core/application'
import type { KnowledgeItemsQuery } from '@shared/data/api/schemas/knowledges'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'

export type KnowledgeItemRow = typeof knowledgeItemTable.$inferSelect
export type KnowledgeItemDbExecutor = Pick<DbType, 'all' | 'delete' | 'insert' | 'select' | 'update'>

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

  async create(
    values: typeof knowledgeItemTable.$inferInsert,
    db: KnowledgeItemDbExecutor = this.db
  ): Promise<KnowledgeItemRow> {
    const [row] = await db.insert(knowledgeItemTable).values(values).returning()
    return row
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
}

export const knowledgeItemRepository = new KnowledgeItemRepository()
