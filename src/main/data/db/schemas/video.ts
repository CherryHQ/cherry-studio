import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

/**
 * Video generation job row.
 *
 * Created before the job is enqueued (so the job carries videoId and can
 * persist its result on restart). Status progresses:
 *   pending → processing → completed
 *           ↘ failed
 * `providerTaskId` is written as soon as the submit call returns so that a
 * restarted job can skip re-submit and go straight to polling.
 */
export const videoTable = sqliteTable(
  'video',
  {
    id: uuidPrimaryKey(),
    providerId: text('provider_id').notNull(),
    modelId: text('model_id').notNull(),
    prompt: text().notNull(),
    duration: integer(),
    resolution: text(),
    status: text().notNull().default('pending'),
    providerTaskId: text('provider_task_id'),
    videoUrl: text('video_url'),
    errorMessage: text('error_message'),
    jobId: text('job_id'),
    ...createUpdateTimestamps
  },
  (t) => [
    check('video_status_check', sql`${t.status} IN ('pending','processing','completed','failed')`),
    index('video_status_idx').on(t.status),
    index('video_created_at_idx').on(t.createdAt)
  ]
)

export type VideoRow = typeof videoTable.$inferSelect
export type InsertVideoRow = typeof videoTable.$inferInsert
