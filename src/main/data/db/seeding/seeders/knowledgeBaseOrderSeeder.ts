import { desc, eq } from 'drizzle-orm'

import { appStateTable } from '@data/db/schemas/appState'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'

import type { DbType, ISeeder } from '../../types'

export class KnowledgeBaseOrderSeeder implements ISeeder {
  readonly name = 'knowledge-base-order'
  readonly version = '1'
  readonly description = 'Initialize knowledge base ordering without changing existing metadata'

  run(db: DbType): void {
    db.transaction((tx) => {
      const journal = tx
        .select()
        .from(appStateTable)
        .where(eq(appStateTable.key, `seed:${this.name}`))
        .get()
      if (journal) return

      const rows = tx
        .select()
        .from(knowledgeBaseTable)
        .orderBy(desc(knowledgeBaseTable.createdAt), desc(knowledgeBaseTable.id))
        .all()
      // The legacy migration assigns a0 to every row; initialized collections may still contain a valid a0.
      if (rows.some((row) => row.orderKey !== 'a0')) return
      const keys = generateOrderKeySequence(rows.length)
      for (const [index, row] of rows.entries()) {
        tx.update(knowledgeBaseTable)
          .set({ orderKey: keys[index], updatedAt: row.updatedAt })
          .where(eq(knowledgeBaseTable.id, row.id))
          .run()
      }
    })
  }
}
