import { desc, eq } from 'drizzle-orm'

import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'

import type { DbType, ISeeder } from '../../types'

export class KnowledgeBaseOrderSeeder implements ISeeder {
  readonly name = 'knowledge-base-order'
  readonly version = '1'
  readonly description = 'Initialize knowledge base ordering without changing existing metadata'

  run(db: DbType): void {
    db.transaction((tx) => {
      const rows = tx
        .select()
        .from(knowledgeBaseTable)
        .orderBy(desc(knowledgeBaseTable.createdAt), desc(knowledgeBaseTable.id))
        .all()
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
