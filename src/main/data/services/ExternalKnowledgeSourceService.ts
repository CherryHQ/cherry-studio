import { desc, eq } from 'drizzle-orm'

import { application } from '@application'
import { type ExternalKnowledgeSourceRow, externalKnowledgeSourceTable } from '@data/db/schemas/externalKnowledgeSource'
import { type ExternalKnowledgeSource, ExternalKnowledgeSourceSchema } from '@shared/data/types/externalKnowledge'

import { knowledgeBaseService } from './KnowledgeBaseService'
import { timestampToISO } from './utils/rowMappers'

const nullableTimestampToISO = (value: number | null): string | null => (value === null ? null : timestampToISO(value))

function rowToEntity(row: ExternalKnowledgeSourceRow): ExternalKnowledgeSource {
  return ExternalKnowledgeSourceSchema.parse({
    ...row,
    lastStartedAt: nullableTimestampToISO(row.lastStartedAt),
    lastFinishedAt: nullableTimestampToISO(row.lastFinishedAt),
    lastSuccessfulSyncAt: nullableTimestampToISO(row.lastSuccessfulSyncAt),
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  })
}

export class ExternalKnowledgeSourceService {
  private get db() {
    return application.get('DbService').getDb()
  }

  listByBaseId(baseId: string): ExternalKnowledgeSource[] {
    knowledgeBaseService.getById(baseId)
    return this.db
      .select()
      .from(externalKnowledgeSourceTable)
      .where(eq(externalKnowledgeSourceTable.baseId, baseId))
      .orderBy(desc(externalKnowledgeSourceTable.updatedAt), desc(externalKnowledgeSourceTable.id))
      .all()
      .map(rowToEntity)
  }

  getById(id: string): ExternalKnowledgeSource | null {
    const row = this.db
      .select()
      .from(externalKnowledgeSourceTable)
      .where(eq(externalKnowledgeSourceTable.id, id))
      .limit(1)
      .get()
    return row ? rowToEntity(row) : null
  }
}

export const externalKnowledgeSourceService = new ExternalKnowledgeSourceService()
