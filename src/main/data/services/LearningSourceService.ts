import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { type LearningSourceRow, learningSourceTable } from '@data/db/schemas/learningSource'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { LearningSourceListQuery, LearningSourceListResponse } from '@shared/data/api/schemas/englishLearning'
import type { LearningSource, LearningSourceKind, LearningSourceStatus } from '@shared/data/types/englishLearning'
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm'

import { asNumericKey, decodeListCursor, encodeCursor, keysetOrdering } from './utils/keysetCursor'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:LearningSourceService')

export interface RegisterLearningSourceInput {
  kind: LearningSourceKind
  sourceRecordId: string
  sourceRevision: string
  sourceLanguage?: string | null
  targetLanguage?: string | null
  sourceText: string
  targetText: string
}

function rowToLearningSource(row: LearningSourceRow): LearningSource {
  return {
    id: row.id,
    kind: row.kind,
    sourceRecordId: row.sourceRecordId,
    sourceRevision: row.sourceRevision,
    status: row.status,
    sourceLanguage: row.sourceLanguage,
    targetLanguage: row.targetLanguage,
    sourceText: row.sourceText,
    targetText: row.targetText,
    error: row.error,
    processedAt: row.processedAt === null ? null : timestampToISO(row.processedAt),
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export class LearningSourceService {
  private get db() {
    return application.get('DbService').getDb()
  }

  list(query: LearningSourceListQuery): LearningSourceListResponse {
    const filters: SQL[] = []
    if (query.kind) filters.push(eq(learningSourceTable.kind, query.kind))
    if (query.status) filters.push(eq(learningSourceTable.status, query.status))

    const ordering = keysetOrdering(learningSourceTable.updatedAt, learningSourceTable.id, {
      major: 'desc',
      tie: 'desc'
    })
    const cursor = decodeListCursor(query.cursor, asNumericKey, 'english-learning-source')
    const pageFilters = [...filters]
    if (cursor) pageFilters.push(ordering.where(cursor))

    const rows = this.db
      .select()
      .from(learningSourceTable)
      .where(pageFilters.length > 0 ? and(...pageFilters) : undefined)
      .orderBy(...ordering.orderBy)
      .limit(query.limit + 1)
      .all()
    const [{ count }] = this.db
      .select({ count: sql<number>`count(*)` })
      .from(learningSourceTable)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .all()
    const pageRows = rows.slice(0, query.limit)

    return {
      items: pageRows.map(rowToLearningSource),
      total: count,
      nextCursor:
        rows.length > query.limit
          ? encodeCursor(pageRows[pageRows.length - 1].updatedAt, pageRows[pageRows.length - 1].id)
          : undefined
    }
  }

  getById(id: string): LearningSource {
    const row = this.getRowById(id)
    return rowToLearningSource(row)
  }

  register(input: RegisterLearningSourceInput): LearningSource {
    return this.registerMany([input])[0]
  }

  registerMany(inputs: RegisterLearningSourceInput[]): LearningSource[] {
    if (inputs.length === 0) return []

    const { rows, createdIds } = application.get('DbService').withWriteTx((tx) => {
      const rows: LearningSourceRow[] = []
      const createdIds: string[] = []

      for (const input of inputs) {
        const [existing] = tx
          .select()
          .from(learningSourceTable)
          .where(
            and(
              eq(learningSourceTable.kind, input.kind),
              eq(learningSourceTable.sourceRecordId, input.sourceRecordId),
              eq(learningSourceTable.sourceRevision, input.sourceRevision)
            )
          )
          .limit(1)
          .all()
        if (existing) {
          rows.push(existing)
          continue
        }

        const [inserted] = tx
          .insert(learningSourceTable)
          .values({
            kind: input.kind,
            sourceRecordId: input.sourceRecordId,
            sourceRevision: input.sourceRevision,
            status: 'pending',
            sourceLanguage: input.sourceLanguage,
            targetLanguage: input.targetLanguage,
            sourceText: input.sourceText,
            targetText: input.targetText
          })
          .returning()
          .all()
        if (!inserted) {
          throw DataApiErrorFactory.database(new Error('Insert did not return a row'), 'register learning source')
        }
        rows.push(inserted)
        createdIds.push(inserted.id)
      }

      return { rows, createdIds }
    })

    if (createdIds.length > 0) {
      notifyDataApiDataChange([
        { endpoint: '/english-learning/sources', kind: 'membership', entityIds: createdIds },
        { endpoint: '/english-learning/dashboard' }
      ])
      logger.info('Registered learning sources', { count: createdIds.length })
    }
    return rows.map(rowToLearningSource)
  }

  setStatus(id: string, status: LearningSourceStatus, error: string | null = null): LearningSource {
    const [row] = this.db
      .update(learningSourceTable)
      .set({
        status,
        error,
        processedAt: status === 'ready' ? Date.now() : null
      })
      .where(eq(learningSourceTable.id, id))
      .returning()
      .all()
    if (!row) throw DataApiErrorFactory.notFound('LearningSource', id)
    this.notifyChanged(id, 'projection')
    logger.info('Updated learning source status', { id, status })
    return rowToLearningSource(row)
  }

  retry(id: string): LearningSource {
    const current = this.getRowById(id)
    if (current.status !== 'failed' && current.status !== 'excluded') {
      throw DataApiErrorFactory.invalidOperation(
        'retry learning source',
        `Source must be failed or excluded, current status is ${current.status}`
      )
    }
    return this.setStatus(id, 'pending')
  }

  exclude(id: string): LearningSource {
    const current = this.getRowById(id)
    if (current.status === 'excluded') return rowToLearningSource(current)
    return this.setStatus(id, 'excluded')
  }

  requeueInterrupted(): number {
    const rows = this.db
      .update(learningSourceTable)
      .set({ status: 'pending', error: null, processedAt: null })
      .where(eq(learningSourceTable.status, 'processing'))
      .returning({ id: learningSourceTable.id })
      .all()
    if (rows.length > 0) {
      notifyDataApiDataChange([
        { endpoint: '/english-learning/sources', kind: 'membership', entityIds: rows.map((row) => row.id) },
        { endpoint: '/english-learning/dashboard' }
      ])
      logger.info('Requeued interrupted learning sources', { count: rows.length })
    }
    return rows.length
  }

  requeueForExtractionPolicyUpgrade(): number {
    const rows = this.db
      .update(learningSourceTable)
      .set({ status: 'pending', error: null, processedAt: null })
      .where(inArray(learningSourceTable.status, ['ready', 'failed']))
      .returning({ id: learningSourceTable.id })
      .all()
    if (rows.length > 0) {
      notifyDataApiDataChange([
        { endpoint: '/english-learning/sources', kind: 'membership', entityIds: rows.map((row) => row.id) },
        { endpoint: '/english-learning/dashboard' }
      ])
      logger.info('Requeued learning sources for extraction policy upgrade', { count: rows.length })
    }
    return rows.length
  }

  private getRowById(id: string): LearningSourceRow {
    const [row] = this.db.select().from(learningSourceTable).where(eq(learningSourceTable.id, id)).limit(1).all()
    if (!row) throw DataApiErrorFactory.notFound('LearningSource', id)
    return row
  }

  private notifyChanged(id: string, kind: 'membership' | 'projection'): void {
    notifyDataApiDataChange([
      { endpoint: '/english-learning/sources', kind, entityIds: [id] },
      { endpoint: '/english-learning/sources/:id', entityIds: [id] },
      { endpoint: '/english-learning/dashboard' }
    ])
  }
}

export const learningSourceService = new LearningSourceService()
