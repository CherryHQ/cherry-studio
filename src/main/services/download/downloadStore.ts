import { and, asc, desc, eq, inArray } from 'drizzle-orm'

import { downloadSegmentTable, downloadTaskTable } from '@data/db/schemas/download'
import type { DbType } from '@data/db/types'
import type { DownloadSource, DownloadState } from '@shared/data/types/download'

import type { ByteRange } from './segmentedDownload'

export type DownloadTaskRecord = typeof downloadTaskTable.$inferSelect
export type DownloadSegmentRecord = typeof downloadSegmentTable.$inferSelect

export interface NewDownloadTask {
  id?: string
  url: string
  finalUrl?: string
  fileName: string
  filePath: string
  tempPath: string
  mime?: string
  totalBytes: number
  connections: number
  source: DownloadSource
  partition?: string
  supportsRanges?: boolean
  etag?: string
  lastModified?: string
  ranges: ByteRange[]
}

/** States a resume after a restart must pick up. */
const RESUMABLE_STATES: DownloadState[] = ['queued', 'probing', 'downloading', 'paused', 'merging']

/**
 * Persistence for download tasks and their segments. All methods are
 * synchronous because the production driver is better-sqlite3; callers on the
 * main thread must not wrap these in `await`.
 */
export class DownloadStore {
  constructor(private readonly db: DbType) {}

  create(input: NewDownloadTask): { task: DownloadTaskRecord; segments: DownloadSegmentRecord[] } {
    return this.db.transaction((tx) => {
      const task = tx
        .insert(downloadTaskTable)
        .values({
          id: input.id,
          url: input.url,
          finalUrl: input.finalUrl,
          fileName: input.fileName,
          filePath: input.filePath,
          tempPath: input.tempPath,
          mime: input.mime,
          totalBytes: input.totalBytes,
          receivedBytes: 0,
          etag: input.etag,
          lastModified: input.lastModified,
          state: 'queued',
          connections: input.connections,
          source: input.source,
          partition: input.partition ?? '',
          supportsRanges: input.supportsRanges ?? true
        })
        .returning()
        .get()
      const segments = input.ranges.length
        ? tx
            .insert(downloadSegmentTable)
            .values(
              input.ranges.map((range) => ({
                taskId: task.id,
                idx: range.index,
                start: range.start,
                end: range.end,
                received: 0
              }))
            )
            .returning()
            .all()
        : []
      return { task, segments: segments.sort((a, b) => a.idx - b.idx) }
    })
  }

  get(taskId: string): { task: DownloadTaskRecord; segments: DownloadSegmentRecord[] } | undefined {
    const task = this.db.select().from(downloadTaskTable).where(eq(downloadTaskTable.id, taskId)).get()
    if (!task) return undefined
    const segments = this.db
      .select()
      .from(downloadSegmentTable)
      .where(eq(downloadSegmentTable.taskId, taskId))
      .orderBy(asc(downloadSegmentTable.idx))
      .all()
    return { task, segments }
  }

  listResumable(): DownloadTaskRecord[] {
    return this.db
      .select()
      .from(downloadTaskTable)
      .where(inArray(downloadTaskTable.state, RESUMABLE_STATES))
      .orderBy(asc(downloadTaskTable.createdAt))
      .all()
  }

  listAll(limit = 200): DownloadTaskRecord[] {
    return this.db.select().from(downloadTaskTable).orderBy(desc(downloadTaskTable.createdAt)).limit(limit).all()
  }

  /**
   * Re-plans a failed task in place: old segment offsets are meaningless once the
   * file has to be fetched again, so they are replaced atomically with the new plan.
   */
  reset(
    taskId: string,
    input: { totalBytes: number; supportsRanges: boolean; etag?: string; lastModified?: string; ranges: ByteRange[] }
  ): void {
    this.db.transaction((tx) => {
      tx.delete(downloadSegmentTable).where(eq(downloadSegmentTable.taskId, taskId)).run()
      if (input.ranges.length) {
        tx.insert(downloadSegmentTable)
          .values(
            input.ranges.map((range) => ({
              taskId,
              idx: range.index,
              start: range.start,
              end: range.end,
              received: 0
            }))
          )
          .run()
      }
      tx.update(downloadTaskTable)
        .set({
          state: 'queued',
          error: null,
          receivedBytes: 0,
          totalBytes: input.totalBytes,
          supportsRanges: input.supportsRanges,
          etag: input.etag ?? null,
          lastModified: input.lastModified ?? null
        })
        .where(eq(downloadTaskTable.id, taskId))
        .run()
    })
  }

  setState(taskId: string, state: DownloadState, error?: string | null): void {
    this.db
      .update(downloadTaskTable)
      .set({ state, error: error ?? null })
      .where(eq(downloadTaskTable.id, taskId))
      .run()
  }

  /** One transaction per flush keeps the task total and segment offsets in step. */
  saveProgress(taskId: string, receivedBytes: number, segments: readonly { index: number; received: number }[]): void {
    this.db.transaction((tx) => {
      for (const segment of segments) {
        tx.update(downloadSegmentTable)
          .set({ received: segment.received })
          .where(and(eq(downloadSegmentTable.taskId, taskId), eq(downloadSegmentTable.idx, segment.index)))
          .run()
      }
      tx.update(downloadTaskTable).set({ receivedBytes }).where(eq(downloadTaskTable.id, taskId)).run()
    })
  }

  complete(taskId: string, filePath: string, totalBytes: number): void {
    this.db
      .update(downloadTaskTable)
      .set({
        state: 'completed',
        error: null,
        filePath,
        receivedBytes: totalBytes,
        tempPath: ''
      })
      .where(eq(downloadTaskTable.id, taskId))
      .run()
  }

  delete(taskId: string): void {
    this.db.delete(downloadTaskTable).where(eq(downloadTaskTable.id, taskId)).run()
  }
}
