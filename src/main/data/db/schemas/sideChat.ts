import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type { SideChatMetadata } from '@shared/data/types/sideChat'

import { topicTable } from './topic'

export const sideChatTable = sqliteTable(
  'side_chat',
  {
    topicId: text()
      .primaryKey()
      .references(() => topicTable.id, { onDelete: 'cascade' }),
    sourceTopicId: text()
      .notNull()
      .references(() => topicTable.id, { onDelete: 'restrict' }),
    metadata: text({ mode: 'json' }).$type<SideChatMetadata>().notNull()
  },
  (t) => [index('side_chat_source_topic_idx').on(t.sourceTopicId)]
)
