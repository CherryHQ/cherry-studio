import { createHash } from 'node:crypto'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { learningSourceTable } from '@data/db/schemas/learningSource'
import {
  learningUnitDedupDecisionTable,
  type LearningUnitRow,
  learningUnitSourceTable,
  learningUnitTable
} from '@data/db/schemas/learningUnit'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type {
  LearningUnitListQuery,
  LearningUnitListResponse,
  UpdateLearningUnitDto
} from '@shared/data/api/schemas/englishLearning'
import type { LearningDedupDecision, LearningUnit, LearningUnitKind } from '@shared/data/types/englishLearning'
import { and, desc, eq, ne, or, type SQL, sql } from 'drizzle-orm'

import { asNumericKey, decodeListCursor, encodeCursor, keysetOrdering } from './utils/keysetCursor'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:LearningUnitService')

export interface UpsertLearningUnitCandidateInput {
  sourceId: string
  kind: LearningUnitKind
  english: string
  meaning: string
  usageNote?: string | null
  example?: string | null
  tags?: string[]
  cefr?: string | null
  extractionConfidence?: number | null
}

export interface RecordLearningDedupDecisionInput {
  sourceId: string
  matchedUnitId: string | null
  resultingUnitId: string
  candidateEnglish: string
  candidateMeaning: string
  candidateHash: string
  decision: LearningDedupDecision
  confidence: number
  modelId: string
}

export function normalizeLearningText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

export function computeLearningUnitExactHash(english: string, meaning: string): string {
  return createHash('sha256')
    .update(`${normalizeLearningText(english)}\u0000${normalizeLearningText(meaning)}`)
    .digest('hex')
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]
}

function lexicalTokens(value: string): Set<string> {
  return new Set(normalizeLearningText(value).match(/[\p{L}\p{N}']+/gu) ?? [])
}

function lexicalSimilarity(left: string, right: string): number {
  const leftTokens = lexicalTokens(left)
  const rightTokens = lexicalTokens(right)
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0
  let intersection = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1
  }
  return intersection / (leftTokens.size + rightTokens.size - intersection)
}

function rowToLearningUnit(row: LearningUnitRow): LearningUnit {
  return {
    id: row.id,
    kind: row.kind,
    english: row.english,
    normalizedEnglish: row.normalizedEnglish,
    meaning: row.meaning,
    usageNote: row.usageNote,
    example: row.example,
    tags: row.tags,
    cefr: row.cefr,
    exactHash: row.exactHash,
    extractionConfidence: row.extractionConfidence,
    isUserEdited: row.isUserEdited,
    suspended: row.suspended,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export class LearningUnitService {
  private get db() {
    return application.get('DbService').getDb()
  }

  list(query: LearningUnitListQuery): LearningUnitListResponse {
    const filters: SQL[] = []
    if (query.kind) filters.push(eq(learningUnitTable.kind, query.kind))
    if (query.suspended !== undefined) filters.push(eq(learningUnitTable.suspended, query.suspended))
    if (query.search) {
      const escaped = query.search.replace(/[%_\\]/g, '\\$&')
      const pattern = `%${escaped}%`
      const search = or(
        sql`${learningUnitTable.english} LIKE ${pattern} ESCAPE '\\'`,
        sql`${learningUnitTable.meaning} LIKE ${pattern} ESCAPE '\\'`
      )
      if (search) filters.push(search)
    }

    const ordering = keysetOrdering(learningUnitTable.updatedAt, learningUnitTable.id, {
      major: 'desc',
      tie: 'desc'
    })
    const cursor = decodeListCursor(query.cursor, asNumericKey, 'english-learning-unit')
    const pageFilters = [...filters]
    if (cursor) pageFilters.push(ordering.where(cursor))

    const rows = this.db
      .select()
      .from(learningUnitTable)
      .where(pageFilters.length > 0 ? and(...pageFilters) : undefined)
      .orderBy(...ordering.orderBy)
      .limit(query.limit + 1)
      .all()
    const [{ count }] = this.db
      .select({ count: sql<number>`count(*)` })
      .from(learningUnitTable)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .all()
    const pageRows = rows.slice(0, query.limit)

    return {
      items: pageRows.map(rowToLearningUnit),
      total: count,
      nextCursor:
        rows.length > query.limit
          ? encodeCursor(pageRows[pageRows.length - 1].updatedAt, pageRows[pageRows.length - 1].id)
          : undefined
    }
  }

  getById(id: string): LearningUnit {
    return rowToLearningUnit(this.getRowById(id))
  }

  upsertCandidate(input: UpsertLearningUnitCandidateInput): LearningUnit {
    let created = false
    const exactHash = computeLearningUnitExactHash(input.english, input.meaning)
    const row = application.get('DbService').withWriteTx((tx) => {
      const source = tx
        .select({ id: learningSourceTable.id })
        .from(learningSourceTable)
        .where(eq(learningSourceTable.id, input.sourceId))
        .limit(1)
        .get()
      if (!source) throw DataApiErrorFactory.notFound('LearningSource', input.sourceId)

      let unit = tx.select().from(learningUnitTable).where(eq(learningUnitTable.exactHash, exactHash)).limit(1).get()
      if (!unit) {
        unit = tx
          .insert(learningUnitTable)
          .values({
            kind: input.kind,
            english: input.english.trim(),
            normalizedEnglish: normalizeLearningText(input.english),
            meaning: input.meaning.trim(),
            usageNote: input.usageNote,
            example: input.example,
            tags: normalizeTags(input.tags ?? []),
            cefr: input.cefr,
            exactHash,
            extractionConfidence: input.extractionConfidence
          })
          .returning()
          .get()
        created = true
      }
      tx.insert(learningUnitSourceTable)
        .values({ learningUnitId: unit.id, learningSourceId: input.sourceId })
        .onConflictDoNothing()
        .run()
      return unit
    })

    this.notifyChanged(row.id, created ? 'membership' : 'projection')
    logger.info(created ? 'Created learning unit' : 'Linked duplicate learning unit', {
      id: row.id,
      sourceId: input.sourceId
    })
    return rowToLearningUnit(row)
  }

  findSemanticCandidates(english: string, meaning: string, limit = 8): LearningUnit[] {
    const candidateText = `${english} ${meaning}`
    return this.db
      .select()
      .from(learningUnitTable)
      .where(eq(learningUnitTable.suspended, false))
      .orderBy(desc(learningUnitTable.updatedAt))
      .limit(200)
      .all()
      .map((row) => ({
        row,
        score:
          lexicalSimilarity(candidateText, `${row.english} ${row.meaning}`) +
          (normalizeLearningText(english) === row.normalizedEnglish ? 1 : 0) +
          (normalizeLearningText(meaning) === normalizeLearningText(row.meaning) ? 0.5 : 0)
      }))
      .filter(({ score }) => score >= 0.15)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map(({ row }) => rowToLearningUnit(row))
  }

  linkSource(unitId: string, sourceId: string): LearningUnit {
    const unit = application.get('DbService').withWriteTx((tx) => {
      const existingUnit = tx.select().from(learningUnitTable).where(eq(learningUnitTable.id, unitId)).limit(1).get()
      if (!existingUnit) throw DataApiErrorFactory.notFound('LearningUnit', unitId)
      const source = tx.select().from(learningSourceTable).where(eq(learningSourceTable.id, sourceId)).limit(1).get()
      if (!source) throw DataApiErrorFactory.notFound('LearningSource', sourceId)
      tx.insert(learningUnitSourceTable)
        .values({ learningUnitId: unitId, learningSourceId: sourceId })
        .onConflictDoNothing()
        .run()
      return existingUnit
    })
    this.notifyChanged(unitId, 'projection')
    return rowToLearningUnit(unit)
  }

  recordDedupDecision(input: RecordLearningDedupDecisionInput): void {
    this.db
      .insert(learningUnitDedupDecisionTable)
      .values({
        learningSourceId: input.sourceId,
        matchedUnitId: input.matchedUnitId,
        resultingUnitId: input.resultingUnitId,
        candidateEnglish: input.candidateEnglish,
        candidateMeaning: input.candidateMeaning,
        candidateHash: input.candidateHash,
        decision: input.decision,
        confidence: input.confidence,
        modelId: input.modelId
      })
      .onConflictDoNothing()
      .run()
  }

  findDedupDecision(sourceId: string, candidateHash: string): LearningUnit | null {
    const decision = this.db
      .select({ resultingUnitId: learningUnitDedupDecisionTable.resultingUnitId })
      .from(learningUnitDedupDecisionTable)
      .where(
        and(
          eq(learningUnitDedupDecisionTable.learningSourceId, sourceId),
          eq(learningUnitDedupDecisionTable.candidateHash, candidateHash)
        )
      )
      .limit(1)
      .get()
    if (!decision?.resultingUnitId) return null
    const unit = this.db
      .select()
      .from(learningUnitTable)
      .where(eq(learningUnitTable.id, decision.resultingUnitId))
      .limit(1)
      .get()
    return unit ? rowToLearningUnit(unit) : null
  }

  update(id: string, dto: UpdateLearningUnitDto): LearningUnit {
    const row = application.get('DbService').withWriteTx((tx) => {
      const current = tx.select().from(learningUnitTable).where(eq(learningUnitTable.id, id)).limit(1).get()
      if (!current) throw DataApiErrorFactory.notFound('LearningUnit', id)

      const english = dto.english ?? current.english
      const meaning = dto.meaning ?? current.meaning
      const exactHash = computeLearningUnitExactHash(english, meaning)
      const collision = tx
        .select({ id: learningUnitTable.id })
        .from(learningUnitTable)
        .where(and(eq(learningUnitTable.exactHash, exactHash), ne(learningUnitTable.id, id)))
        .limit(1)
        .get()
      if (collision) {
        throw DataApiErrorFactory.conflict(
          'Another learning unit already has the same English and meaning',
          'LearningUnit'
        )
      }

      const [updated] = tx
        .update(learningUnitTable)
        .set({
          ...dto,
          english: english.trim(),
          meaning: meaning.trim(),
          normalizedEnglish: normalizeLearningText(english),
          exactHash,
          tags: dto.tags ? normalizeTags(dto.tags) : current.tags,
          isUserEdited: true
        })
        .where(eq(learningUnitTable.id, id))
        .returning()
        .all()
      if (!updated) throw DataApiErrorFactory.notFound('LearningUnit', id)
      return updated
    })

    this.notifyChanged(id, 'projection')
    logger.info('Updated learning unit', { id, changes: Object.keys(dto) })
    return rowToLearningUnit(row)
  }

  private getRowById(id: string): LearningUnitRow {
    const row = this.db.select().from(learningUnitTable).where(eq(learningUnitTable.id, id)).limit(1).get()
    if (!row) throw DataApiErrorFactory.notFound('LearningUnit', id)
    return row
  }

  private notifyChanged(id: string, kind: 'membership' | 'projection'): void {
    notifyDataApiDataChange([
      { endpoint: '/english-learning/units', kind, entityIds: [id] },
      { endpoint: '/english-learning/units/:id', entityIds: [id] },
      { endpoint: '/english-learning/dashboard' }
    ])
  }
}

export const learningUnitService = new LearningUnitService()
