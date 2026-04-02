import Dexie, { type EntityTable } from 'dexie'

export interface SideQuestionThread {
  id: string
  sourceMessageId: string
  topicId: string
  createdAt: number
  updatedAt: number
}

export interface SideQuestionMessage {
  id: string
  threadId: string
  role: 'user' | 'assistant'
  content: string
  status: 'completed' | 'streaming' | 'error'
  createdAt: number
}

const db = new Dexie('CherryStudio_SideQuestions') as Dexie & {
  threads: EntityTable<SideQuestionThread, 'id'>
  messages: EntityTable<SideQuestionMessage, 'id'>
}

db.version(1).stores({
  threads: '&id, sourceMessageId, topicId, updatedAt',
  messages: '&id, threadId, createdAt'
})

export { db as sideQuestionDb }
