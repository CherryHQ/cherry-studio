import { type AnySQLiteColumn, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateDeleteTimestamps, orderKeyColumns, orderKeyIndex, uuidPrimaryKey } from './_columnHelpers'

/** A project root or an immutable generation/edit step, with shared file references. */
export const paintingTable = sqliteTable(
  'painting',
  {
    id: uuidPrimaryKey(),
    providerId: text('provider_id').notNull(),
    modelId: text('model_id'),
    prompt: text().notNull(),
    projectId: text('project_id').references((): AnySQLiteColumn => paintingTable.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'),
    stepNumber: integer('step_number').notNull().default(1),
    sourceFileId: text('source_file_id'),
    operation: text('operation', { enum: ['generate', 'edit', 'import'] })
      .notNull()
      .default('generate'),
    params: text('params', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    stepStatus: text('step_status', { enum: ['running', 'completed', 'failed', 'canceled', 'interrupted'] })
      .notNull()
      .default('completed'),
    stepError: text('step_error'),
    selectedStepId: text('selected_step_id'),
    selectedFileId: text('selected_file_id'),
    ...orderKeyColumns,
    ...createUpdateDeleteTimestamps
  },
  (t) => [orderKeyIndex('painting')(t), index('painting_project_idx').on(t.projectId)]
)

export type PaintingRow = typeof paintingTable.$inferSelect
export type InsertPaintingRow = typeof paintingTable.$inferInsert
