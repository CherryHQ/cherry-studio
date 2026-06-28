// Branch anchor CRUD (P2 asset realization): persist + list by parent topic.

import { application } from '@application'
import { branchAnchorTable } from '@data/db/schemas/branchAnchor'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateBranchAnchorDto, UpdateBranchAnchorDto } from '@shared/data/api/schemas/branchAnchors'
import type { BranchAnchor } from '@shared/data/types/branchAnchor'
import { asc, eq } from 'drizzle-orm'

import { timestampToISO, timestampToISOOrUndefined } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:BranchAnchorService')

type BranchAnchorRow = typeof branchAnchorTable.$inferSelect

function rowToBranchAnchor(row: BranchAnchorRow): BranchAnchor {
  return {
    id: row.id,
    parentTopicId: row.parentTopicId,
    branchTopicId: row.branchTopicId,
    messageId: row.messageId,
    blockId: row.blockId,
    selectedText: row.selectedText,
    selectionStart: row.selectionStart,
    selectionEnd: row.selectionEnd,
    // DB CHECK constraint (branch_anchor_disposition_check) guarantees the domain.
    disposition: row.disposition as BranchAnchor['disposition'],
    summary: row.summary,
    summaryUpdatedAt: timestampToISOOrUndefined(row.summaryUpdatedAt),
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export class BranchAnchorService {
  async create(dto: CreateBranchAnchorDto): Promise<BranchAnchor> {
    const db = application.get('DbService').getDb()

    const [row] = await db
      .insert(branchAnchorTable)
      .values({
        parentTopicId: dto.parentTopicId,
        branchTopicId: dto.branchTopicId,
        messageId: dto.messageId,
        blockId: dto.blockId,
        selectedText: dto.selectedText,
        selectionStart: dto.selectionStart,
        selectionEnd: dto.selectionEnd
        // disposition / summary / summaryUpdatedAt / timestamps: DB defaults.
      })
      .returning()
    if (!row) {
      throw DataApiErrorFactory.internal(new Error('insert returned no row'), 'BranchAnchorService.create')
    }

    logger.info('Created branch anchor', { id: row.id, parentTopicId: row.parentTopicId })
    return rowToBranchAnchor(row)
  }

  /**
   * Every anchor for one PARENT topic, in creation order. NO disposition
   * filtering - the caller (BranchPane) gets all kept branches for the
   * conversation from this single read (P2 doc §1.2 / §2 Q3).
   */
  async listByParent(parentTopicId: string): Promise<BranchAnchor[]> {
    const db = application.get('DbService').getDb()

    const rows = await db
      .select()
      .from(branchAnchorTable)
      .where(eq(branchAnchorTable.parentTopicId, parentTopicId))
      .orderBy(asc(branchAnchorTable.createdAt), asc(branchAnchorTable.id))

    return rows.map(rowToBranchAnchor)
  }

  /** Only the summary / disposition are mutable; anchor coordinates are immutable. */
  async update(id: string, dto: UpdateBranchAnchorDto): Promise<BranchAnchor> {
    const db = application.get('DbService').getDb()

    const updates: Partial<typeof branchAnchorTable.$inferInsert> = {}
    if (dto.summary !== undefined) updates.summary = dto.summary
    if (dto.disposition !== undefined) updates.disposition = dto.disposition
    if (dto.summaryUpdatedAt !== undefined) {
      // DTO carries an ISO string (entity convention); the column stores epoch ms.
      updates.summaryUpdatedAt = dto.summaryUpdatedAt === null ? null : new Date(dto.summaryUpdatedAt).getTime()
    }

    const [row] = await db.update(branchAnchorTable).set(updates).where(eq(branchAnchorTable.id, id)).returning()
    if (!row) throw DataApiErrorFactory.notFound('BranchAnchor', id)

    logger.info('Updated branch anchor', { id, changes: Object.keys(dto) })
    return rowToBranchAnchor(row)
  }

  async delete(id: string): Promise<void> {
    const db = application.get('DbService').getDb()

    const deleted = await db
      .delete(branchAnchorTable)
      .where(eq(branchAnchorTable.id, id))
      .returning({ id: branchAnchorTable.id })
    if (deleted.length === 0) throw DataApiErrorFactory.notFound('BranchAnchor', id)

    logger.info('Deleted branch anchor', { id })
  }
}

export const branchAnchorService = new BranchAnchorService()
