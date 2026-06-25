import { application } from '@application'
import { type InputHistoryRow, inputHistoryTable } from '@data/db/schemas/inputHistory'
import type { DbOrTx } from '@data/db/types'
import { loggerService } from '@logger'
import { INPUT_HISTORY_DEFAULT_LIMIT, type SaveInputHistoryDto } from '@shared/data/api/schemas/inputHistory'
import type { InputHistory } from '@shared/data/types/inputHistory'
import { asc, desc, eq } from 'drizzle-orm'

import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:InputHistoryService')

function rowToInputHistory(row: InputHistoryRow): InputHistory {
  return {
    id: row.id,
    content: row.content,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export class InputHistoryService {
  private get db() {
    return application.get('DbService').getDb()
  }

  async list(): Promise<InputHistory[]> {
    const rows = await this.db
      .select()
      .from(inputHistoryTable)
      .orderBy(desc(inputHistoryTable.updatedAt), desc(inputHistoryTable.createdAt), desc(inputHistoryTable.id))
      .limit(INPUT_HISTORY_DEFAULT_LIMIT)

    return rows.map(rowToInputHistory)
  }

  async save(dto: SaveInputHistoryDto): Promise<InputHistory> {
    const content = dto.content.trim()

    return await application.get('DbService').withWriteTx((tx) => this.saveTx(tx, content))
  }

  private async saveTx(tx: DbOrTx, content: string): Promise<InputHistory> {
    const now = Date.now()
    const [existing] = await tx.select().from(inputHistoryTable).where(eq(inputHistoryTable.content, content)).limit(1)

    if (existing) {
      const [row] = await tx
        .update(inputHistoryTable)
        .set({ updatedAt: now })
        .where(eq(inputHistoryTable.id, existing.id))
        .returning()

      await this.trimToLimitTx(tx)
      logger.info('Moved input history to latest', { id: row.id })
      return rowToInputHistory(row)
    }

    const [row] = await tx.insert(inputHistoryTable).values({ content }).returning()
    await this.trimToLimitTx(tx)

    logger.info('Created input history', { id: row.id })
    return rowToInputHistory(row)
  }

  private async trimToLimitTx(tx: DbOrTx): Promise<void> {
    const rows = await tx
      .select({ id: inputHistoryTable.id })
      .from(inputHistoryTable)
      .orderBy(asc(inputHistoryTable.updatedAt), asc(inputHistoryTable.createdAt), asc(inputHistoryTable.id))

    const overflowCount = rows.length - INPUT_HISTORY_DEFAULT_LIMIT
    if (overflowCount <= 0) {
      return
    }

    for (const row of rows.slice(0, overflowCount)) {
      await tx.delete(inputHistoryTable).where(eq(inputHistoryTable.id, row.id))
    }
  }
}

export const inputHistoryService = new InputHistoryService()
