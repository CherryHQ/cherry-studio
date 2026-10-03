import type Database from 'better-sqlite3'

import { getKnowledgeItemDisplayTitle, type KnowledgeItemTitleSource } from '@shared/data/types/knowledge'

export function registerKnowledgeFunctions(sqlite: Database.Database): void {
  sqlite.function('knowledge_item_name', { deterministic: true }, (type: string, data: string) =>
    getKnowledgeItemDisplayTitle({ type, data: JSON.parse(data) } as KnowledgeItemTitleSource).toLowerCase()
  )
}
