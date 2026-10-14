/**
 * FileRefService — cross-source read facade.
 *
 * Persistent business refs are owned by their source domains and stored in
 * FK-constrained association tables (`chat_message_file_ref`, `painting_file_ref`,
 * `job_file_ref`, …). This service does not create, copy, or replace those
 * persistent relationships; source services/migrators write their own tables. It
 * only aggregates a unified FileRef projection across sources, because File
 * DataApi and the file sweep need one.
 */

import { asc, count, eq, inArray } from 'drizzle-orm'

import { application } from '@application'
import {
  agentSessionMessageFileRefTable,
  chatMessageFileRefTable,
  jobFileRefTable,
  type MiniAppFileRefRow,
  miniAppFileRefTable,
  type MiniAppLogoFileRefRow,
  miniAppLogoFileRefTable,
  paintingFileRefTable,
  type PersistentFileRefSourceType,
  persistentFileRefTablesBySourceType,
  type ProviderLogoFileRefRow,
  providerLogoFileRefTable,
  translateHistoryFileRefTable
} from '@data/db/schemas/fileRelations'
import type { DbOrTx } from '@data/db/types'
import type { FileEntryId, FileRef, FileRefSourceType } from '@shared/data/types/file'
import {
  agentSessionMessageSourceType,
  chatMessageSourceType,
  FileRefSchema,
  jobSourceType,
  miniAppFileRef,
  miniAppLogoRef,
  paintingSourceType,
  providerLogoRef,
  translateHistorySourceType
} from '@shared/data/types/file'

export interface FileRefSourceKey {
  readonly sourceType: FileRefSourceType
  readonly sourceId: string
}

export interface FileRefService {
  /** All refs pointing at a given file_entry. */
  findByEntryId(fileEntryId: FileEntryId): FileRef[]

  /** All refs owned by a business source (chat message, painting, job, translate history, logo). */
  findBySource(source: FileRefSourceKey): FileRef[]

  /** Ref-count aggregation for a batch of entry ids. */
  countByEntryIds(ids: readonly FileEntryId[]): Map<FileEntryId, number>

  /** Persistent-ref count for one entry, inside the caller's tx (cleanup pass §5.4). */
  countPersistentRefsByEntryIdTx(tx: DbOrTx, id: FileEntryId): number
}

const SQLITE_INARRAY_CHUNK = 500

type AgentSessionMessageFileRefRow = typeof agentSessionMessageFileRefTable.$inferSelect
type ChatMessageFileRefRow = typeof chatMessageFileRefTable.$inferSelect
type PaintingFileRefRow = typeof paintingFileRefTable.$inferSelect
type JobFileRefRow = typeof jobFileRefTable.$inferSelect
type TranslateHistoryFileRefRow = typeof translateHistoryFileRefTable.$inferSelect

function compareRefs(left: FileRef, right: FileRef): number {
  const createdDelta = left.createdAt - right.createdAt
  if (createdDelta !== 0) return createdDelta
  return left.id.localeCompare(right.id)
}

function agentSessionMessageRowToFileRef(row: AgentSessionMessageFileRefRow): FileRef {
  return FileRefSchema.parse({ ...row, sourceType: agentSessionMessageSourceType })
}

function chatMessageRowToFileRef(row: ChatMessageFileRefRow): FileRef {
  return FileRefSchema.parse({ ...row, sourceType: chatMessageSourceType })
}

function paintingRowToFileRef(row: PaintingFileRefRow): FileRef {
  return FileRefSchema.parse({ ...row, sourceType: paintingSourceType })
}

/**
 * The two single-file logo association tables share one row shape (no
 * `sourceType` column — the table is the discriminator), so one mapper stamps
 * the caller-supplied `sourceType` and validates against its variant schema.
 */
function singleFileRowToFileRef(
  row: ProviderLogoFileRefRow | MiniAppLogoFileRefRow | MiniAppFileRefRow,
  sourceType: typeof providerLogoRef.sourceType | typeof miniAppLogoRef.sourceType | typeof miniAppFileRef.sourceType
): FileRef {
  return FileRefSchema.parse({ ...row, sourceType })
}

function jobRowToFileRef(row: JobFileRefRow): FileRef {
  return FileRefSchema.parse({ ...row, sourceType: jobSourceType })
}

function translateHistoryRowToFileRef(row: TranslateHistoryFileRefRow): FileRef {
  return FileRefSchema.parse({ ...row, sourceType: translateHistorySourceType })
}

class FileRefServiceImpl implements FileRefService {
  private getDbService() {
    return application.get('DbService')
  }

  private getDb() {
    return this.getDbService().getDb()
  }

  findByEntryId(fileEntryId: FileEntryId): FileRef[] {
    const persistentRefReaders = {
      [agentSessionMessageSourceType]: () => {
        const rows = this.getDb()
          .select()
          .from(agentSessionMessageFileRefTable)
          .where(eq(agentSessionMessageFileRefTable.fileEntryId, fileEntryId))
          .orderBy(asc(agentSessionMessageFileRefTable.createdAt), asc(agentSessionMessageFileRefTable.id))
          .all()
        return rows.map(agentSessionMessageRowToFileRef)
      },
      [chatMessageSourceType]: () => {
        const rows = this.getDb()
          .select()
          .from(chatMessageFileRefTable)
          .where(eq(chatMessageFileRefTable.fileEntryId, fileEntryId))
          .orderBy(asc(chatMessageFileRefTable.createdAt), asc(chatMessageFileRefTable.id))
          .all()
        return rows.map(chatMessageRowToFileRef)
      },
      [paintingSourceType]: () => {
        const rows = this.getDb()
          .select()
          .from(paintingFileRefTable)
          .where(eq(paintingFileRefTable.fileEntryId, fileEntryId))
          .orderBy(asc(paintingFileRefTable.createdAt), asc(paintingFileRefTable.id))
          .all()
        return rows.map(paintingRowToFileRef)
      },
      [providerLogoRef.sourceType]: () => {
        const rows = this.getDb()
          .select()
          .from(providerLogoFileRefTable)
          .where(eq(providerLogoFileRefTable.fileEntryId, fileEntryId))
          .orderBy(asc(providerLogoFileRefTable.createdAt), asc(providerLogoFileRefTable.id))
          .all()
        return rows.map((row) => singleFileRowToFileRef(row, providerLogoRef.sourceType))
      },
      [miniAppLogoRef.sourceType]: () => {
        const rows = this.getDb()
          .select()
          .from(miniAppLogoFileRefTable)
          .where(eq(miniAppLogoFileRefTable.fileEntryId, fileEntryId))
          .orderBy(asc(miniAppLogoFileRefTable.createdAt), asc(miniAppLogoFileRefTable.id))
          .all()
        return rows.map((row) => singleFileRowToFileRef(row, miniAppLogoRef.sourceType))
      },
      [miniAppFileRef.sourceType]: () => {
        const rows = this.getDb()
          .select()
          .from(miniAppFileRefTable)
          .where(eq(miniAppFileRefTable.fileEntryId, fileEntryId))
          .orderBy(asc(miniAppFileRefTable.createdAt), asc(miniAppFileRefTable.id))
          .all()
        return rows.map((row) => singleFileRowToFileRef(row, miniAppFileRef.sourceType))
      },
      [jobSourceType]: () => {
        const rows = this.getDb()
          .select()
          .from(jobFileRefTable)
          .where(eq(jobFileRefTable.fileEntryId, fileEntryId))
          .orderBy(asc(jobFileRefTable.createdAt), asc(jobFileRefTable.id))
          .all()
        return rows.map(jobRowToFileRef)
      },
      [translateHistorySourceType]: () => {
        const rows = this.getDb()
          .select()
          .from(translateHistoryFileRefTable)
          .where(eq(translateHistoryFileRefTable.fileEntryId, fileEntryId))
          .orderBy(asc(translateHistoryFileRefTable.createdAt), asc(translateHistoryFileRefTable.id))
          .all()
        return rows.map(translateHistoryRowToFileRef)
      }
    } satisfies Record<PersistentFileRefSourceType, () => FileRef[]>

    return Object.values(persistentRefReaders)
      .flatMap((readRefs) => readRefs())
      .sort(compareRefs)
  }

  findBySource(source: FileRefSourceKey): FileRef[] {
    switch (source.sourceType) {
      case agentSessionMessageSourceType: {
        const rows = this.getDb()
          .select()
          .from(agentSessionMessageFileRefTable)
          .where(eq(agentSessionMessageFileRefTable.sourceId, source.sourceId))
          .orderBy(asc(agentSessionMessageFileRefTable.createdAt), asc(agentSessionMessageFileRefTable.id))
          .all()
        return rows.map(agentSessionMessageRowToFileRef)
      }
      case chatMessageSourceType: {
        const rows = this.getDb()
          .select()
          .from(chatMessageFileRefTable)
          .where(eq(chatMessageFileRefTable.sourceId, source.sourceId))
          .orderBy(asc(chatMessageFileRefTable.createdAt), asc(chatMessageFileRefTable.id))
          .all()
        return rows.map(chatMessageRowToFileRef)
      }
      case paintingSourceType: {
        const rows = this.getDb()
          .select()
          .from(paintingFileRefTable)
          .where(eq(paintingFileRefTable.sourceId, source.sourceId))
          .orderBy(asc(paintingFileRefTable.createdAt), asc(paintingFileRefTable.id))
          .all()
        return rows.map(paintingRowToFileRef)
      }
      case providerLogoRef.sourceType: {
        const rows = this.getDb()
          .select()
          .from(providerLogoFileRefTable)
          .where(eq(providerLogoFileRefTable.sourceId, source.sourceId))
          .orderBy(asc(providerLogoFileRefTable.createdAt), asc(providerLogoFileRefTable.id))
          .all()
        return rows.map((row) => singleFileRowToFileRef(row, providerLogoRef.sourceType))
      }
      case miniAppLogoRef.sourceType: {
        const rows = this.getDb()
          .select()
          .from(miniAppLogoFileRefTable)
          .where(eq(miniAppLogoFileRefTable.sourceId, source.sourceId))
          .orderBy(asc(miniAppLogoFileRefTable.createdAt), asc(miniAppLogoFileRefTable.id))
          .all()
        return rows.map((row) => singleFileRowToFileRef(row, miniAppLogoRef.sourceType))
      }
      case miniAppFileRef.sourceType: {
        const rows = this.getDb()
          .select()
          .from(miniAppFileRefTable)
          .where(eq(miniAppFileRefTable.sourceId, source.sourceId))
          .orderBy(asc(miniAppFileRefTable.createdAt), asc(miniAppFileRefTable.id))
          .all()
        return rows.map((row) => singleFileRowToFileRef(row, miniAppFileRef.sourceType))
      }
      case jobSourceType: {
        const rows = this.getDb()
          .select()
          .from(jobFileRefTable)
          .where(eq(jobFileRefTable.sourceId, source.sourceId))
          .orderBy(asc(jobFileRefTable.createdAt), asc(jobFileRefTable.id))
          .all()
        return rows.map(jobRowToFileRef)
      }
      case translateHistorySourceType: {
        const rows = this.getDb()
          .select()
          .from(translateHistoryFileRefTable)
          .where(eq(translateHistoryFileRefTable.sourceId, source.sourceId))
          .orderBy(asc(translateHistoryFileRefTable.createdAt), asc(translateHistoryFileRefTable.id))
          .all()
        return rows.map(translateHistoryRowToFileRef)
      }
    }
  }

  countByEntryIds(ids: readonly FileEntryId[]): Map<FileEntryId, number> {
    const counts = new Map<FileEntryId, number>()
    if (ids.length === 0) return counts

    const add = (entryId: FileEntryId, refCount: number) => {
      counts.set(entryId, (counts.get(entryId) ?? 0) + refCount)
    }

    for (let i = 0; i < ids.length; i += SQLITE_INARRAY_CHUNK) {
      const chunk = ids.slice(i, i + SQLITE_INARRAY_CHUNK)
      const persistentRefCounters = {
        [agentSessionMessageSourceType]: () =>
          this.getDb()
            .select({ entryId: agentSessionMessageFileRefTable.fileEntryId, refCount: count() })
            .from(agentSessionMessageFileRefTable)
            .where(inArray(agentSessionMessageFileRefTable.fileEntryId, chunk))
            .groupBy(agentSessionMessageFileRefTable.fileEntryId)
            .all(),
        [chatMessageSourceType]: () =>
          this.getDb()
            .select({ entryId: chatMessageFileRefTable.fileEntryId, refCount: count() })
            .from(chatMessageFileRefTable)
            .where(inArray(chatMessageFileRefTable.fileEntryId, chunk))
            .groupBy(chatMessageFileRefTable.fileEntryId)
            .all(),
        [paintingSourceType]: () =>
          this.getDb()
            .select({ entryId: paintingFileRefTable.fileEntryId, refCount: count() })
            .from(paintingFileRefTable)
            .where(inArray(paintingFileRefTable.fileEntryId, chunk))
            .groupBy(paintingFileRefTable.fileEntryId)
            .all(),
        [providerLogoRef.sourceType]: () =>
          this.getDb()
            .select({ entryId: providerLogoFileRefTable.fileEntryId, refCount: count() })
            .from(providerLogoFileRefTable)
            .where(inArray(providerLogoFileRefTable.fileEntryId, chunk))
            .groupBy(providerLogoFileRefTable.fileEntryId)
            .all(),
        [miniAppLogoRef.sourceType]: () =>
          this.getDb()
            .select({ entryId: miniAppLogoFileRefTable.fileEntryId, refCount: count() })
            .from(miniAppLogoFileRefTable)
            .where(inArray(miniAppLogoFileRefTable.fileEntryId, chunk))
            .groupBy(miniAppLogoFileRefTable.fileEntryId)
            .all(),
        [miniAppFileRef.sourceType]: () =>
          this.getDb()
            .select({ entryId: miniAppFileRefTable.fileEntryId, refCount: count() })
            .from(miniAppFileRefTable)
            .where(inArray(miniAppFileRefTable.fileEntryId, chunk))
            .groupBy(miniAppFileRefTable.fileEntryId)
            .all(),
        [jobSourceType]: () =>
          this.getDb()
            .select({ entryId: jobFileRefTable.fileEntryId, refCount: count() })
            .from(jobFileRefTable)
            .where(inArray(jobFileRefTable.fileEntryId, chunk))
            .groupBy(jobFileRefTable.fileEntryId)
            .all(),
        [translateHistorySourceType]: () =>
          this.getDb()
            .select({ entryId: translateHistoryFileRefTable.fileEntryId, refCount: count() })
            .from(translateHistoryFileRefTable)
            .where(inArray(translateHistoryFileRefTable.fileEntryId, chunk))
            .groupBy(translateHistoryFileRefTable.fileEntryId)
            .all()
      } satisfies Record<PersistentFileRefSourceType, () => Array<{ entryId: FileEntryId; refCount: number }>>

      const rowGroups = Object.values(persistentRefCounters).map((countRefs) => countRefs())
      for (const rows of rowGroups) {
        for (const row of rows) add(row.entryId, row.refCount)
      }
    }

    return counts
  }

  countPersistentRefsByEntryIdTx(tx: DbOrTx, id: FileEntryId): number {
    let total = 0
    for (const table of Object.values(persistentFileRefTablesBySourceType)) {
      const rows = tx.select({ c: count() }).from(table).where(eq(table.fileEntryId, id)).all()
      total += rows[0]?.c ?? 0
    }
    return total
  }
}

export const fileRefService: FileRefService = new FileRefServiceImpl()
