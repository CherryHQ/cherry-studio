import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type { DownloadSource, DownloadState } from '@shared/data/types/download'

import { createUpdateTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'

/**
 * One row per download. `tempPath` is the sparse file the segment writers write
 * into; `filePath` is only meaningful once the task reaches `completed`, when the
 * temp file is renamed onto it.
 *
 * `receivedBytes` duplicates the sum of `download_segment.received` on purpose:
 * the list view needs it without a join, and the segment rows are the crash-safe
 * source of truth that a resume recomputes from.
 */
export const downloadTaskTable = sqliteTable(
  'download_task',
  {
    id: uuidPrimaryKeyOrdered(),
    url: text().notNull(),
    finalUrl: text(),
    fileName: text().notNull(),
    filePath: text().notNull(),
    tempPath: text().notNull(),
    mime: text(),
    totalBytes: integer().notNull().default(0),
    receivedBytes: integer().notNull().default(0),
    etag: text(),
    lastModified: text(),
    /** Session partition the transfer runs in; empty means the default session. */
    partition: text().notNull().default(''),
    /** False when the server ignored Range: the task cannot be resumed by offset. */
    supportsRanges: integer({ mode: 'boolean' }).notNull().default(true),
    state: text().$type<DownloadState>().notNull().default('queued'),
    error: text(),
    connections: integer().notNull().default(8),
    source: text().$type<DownloadSource>().notNull().default('browser'),
    ...createUpdateTimestamps
  },
  (t) => [index('download_task_state_created_idx').on(t.state, t.createdAt)]
)

/**
 * One row per byte range of a task. `end` is exclusive. A segment row is
 * inserted when the plan is made and `received` is advanced as bytes land, so a
 * resume after a crash can start each range at its recorded offset.
 */
export const downloadSegmentTable = sqliteTable(
  'download_segment',
  {
    taskId: text()
      .notNull()
      .references(() => downloadTaskTable.id, { onDelete: 'cascade' }),
    idx: integer().notNull(),
    start: integer().notNull(),
    end: integer().notNull(),
    received: integer().notNull().default(0)
  },
  (t) => [primaryKey({ columns: [t.taskId, t.idx] })]
)
