import type Database from 'better-sqlite3'

import { getKnowledgeItemDisplayTitle, type KnowledgeItemTitleSource } from '@shared/data/types/knowledge'

export function registerKnowledgeFunctions(sqlite: Database.Database): void {
  sqlite.function('knowledge_item_name', { deterministic: true }, (type: string, data: string) =>
    // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- Stored type/data retain their legacy title fallback contract; JSON.parse does not validate a complete knowledge item, and unrelated fields must not reject sorting.
    getKnowledgeItemDisplayTitle({ type, data: JSON.parse(data) } as KnowledgeItemTitleSource).toLowerCase()
  )
}
