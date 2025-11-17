import type { VideoEndpointType, VideoStatus } from '@types'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './columnHelpers'

export const videoTable = sqliteTable(
  'video',
  {
    id: text().primaryKey(),
    type: text('type').$type<VideoEndpointType>().notNull(),
    providerId: text('providerId').notNull(),
    name: text('name'),
    thumbnail: text('thumbnail'),
    fileId: text('fileId'),
    prompt: text('prompt').notNull(),
    status: text('status').$type<VideoStatus>().notNull(),
    progress: integer('progress'),
    metadata: text('metadata', { mode: 'json' }),
    error: text('error', { mode: 'json' }),
    ...createUpdateTimestamps
  },
  (table) => [
    index('status_idx').on(table.status),
    index('provider_idx').on(table.providerId),
    index('type_idx').on(table.type),
    uniqueIndex('file_id_idx').on(table.fileId)
  ]
)
