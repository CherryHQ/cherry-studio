import { FileType, KnowledgeItem, Topic, TranslateHistory } from '@renderer/types'
import { Dexie, type EntityTable } from 'dexie'

import { upgradeToV5, upgradeToV6 } from './upgrades'
// Database declaration (move this to its own module also)
export const db = new Dexie('CherryStudio') as Dexie & {
  files: EntityTable<FileType, 'id'>
  topics: EntityTable<Pick<Topic, 'id' | 'messages'>, 'id'>
  settings: EntityTable<{ id: string; value: any }, 'id'>
  knowledge_notes: EntityTable<KnowledgeItem, 'id'>
  translate_history: EntityTable<TranslateHistory, 'id'>
}

db.version(1).stores({
  files: 'id, name, origin_name, path, size, ext, type, created_at, count'
})

db.version(2).stores({
  files: 'id, name, origin_name, path, size, ext, type, created_at, count',
  topics: '&id, messages',
  settings: '&id, value'
})

db.version(3).stores({
  files: 'id, name, origin_name, path, size, ext, type, created_at, count',
  topics: '&id, messages',
  settings: '&id, value',
  knowledge_notes: '&id, baseId, type, content, created_at, updated_at'
})

db.version(4).stores({
  files: 'id, name, origin_name, path, size, ext, type, created_at, count',
  topics: '&id, messages',
  settings: '&id, value',
  knowledge_notes: '&id, baseId, type, content, created_at, updated_at',
  translate_history: '&id, sourceText, targetText, sourceLanguage, targetLanguage, createdAt'
})

db.version(5)
  .stores({
    files: 'id, name, origin_name, path, size, ext, type, created_at, count',
    topics: '&id, messages',
    settings: '&id, value',
    knowledge_notes: '&id, baseId, type, content, created_at, updated_at',
    translate_history: '&id, sourceText, targetText, sourceLanguage, targetLanguage, createdAt'
  })
  .upgrade((tx) => upgradeToV5(tx))

db.version(6)
  .stores({
    files: 'id, name, origin_name, path, size, ext, type, created_at, count',
    topics: '&id, messages, createdAt, updatedAt',
    settings: '&id, value',
    knowledge_notes: '&id, baseId, type, content, created_at, updated_at',
    translate_history: '&id, sourceText, targetText, sourceLanguage, targetLanguage, createdAt'
  })
  .upgrade((tx) => upgradeToV6(tx))

// Add hooks for automatic timestamp handling
db.topics.hook('creating', (_, obj: any) => {
  const now = new Date().toISOString()
  obj.createdAt = now
  obj.updatedAt = now
})

db.topics.hook('updating', (modifications: any) => {
  if (typeof modifications === 'object') {
    modifications.updatedAt = new Date().toISOString()
  }
})

export default db
