import { foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { orderKeyColumns, orderKeyIndex, uuidPrimaryKeyOrdered } from './_columnHelpers'

/**
 * Prompt version table - append-only snapshots of prompt content.
 *
 * A new version is created automatically when content changes. Rollback
 * creates a new version with the target version's content; the original
 * rows are never mutated (append-only history).
 *
 * Declared before `promptTable` so the latter's composite FK on
 * `(id, currentVersion) → (promptId, version)` can reference concrete
 * columns without a forward reference.
 */
export const promptVersionTable = sqliteTable(
  'prompt_version',
  {
    id: uuidPrimaryKeyOrdered(),
    // FK to prompt - CASCADE: delete versions when prompt is deleted.
    // Lambda defers resolution until after `promptTable` is declared below.
    promptId: text()
      .notNull()
      .references(() => promptTable.id, { onDelete: 'cascade' }),
    // Monotonically increasing version number (1, 2, 3...)
    version: integer().notNull(),
    // Snapshot of content at this version
    content: text().notNull(),
    // If this version was created by a rollback, records the source version number
    rollbackFrom: integer(),
    // JSON-serialized PromptVariable[] snapshot at this version
    variables: text(),

    createdAt: integer()
      .notNull()
      .$defaultFn(() => Date.now())
  },
  (t) => [uniqueIndex('prompt_version_prompt_id_version_idx').on(t.promptId, t.version)]
)

/**
 * Prompt table - user prompt templates (replaces legacy QuickPhrase).
 *
 * `content` is a denormalized cache of the active version's content for
 * fast current-state reads; `prompt_version` remains the source of truth
 * for version history.
 *
 * The composite FK `(id, currentVersion) → prompt_version(promptId, version)`
 * enforces that `currentVersion` always points to a real history row —
 * no invariant drift if a transaction partially applies. Because this
 * creates a mutual reference with `prompt_version.promptId → prompt.id`,
 * `PromptService.create()` uses `PRAGMA defer_foreign_keys` to defer FK
 * checking to commit time so both rows can be inserted in one transaction.
 */
export const promptTable = sqliteTable(
  'prompt',
  {
    id: uuidPrimaryKeyOrdered(),
    title: text().notNull(),
    content: text().notNull(),
    currentVersion: integer().notNull().default(1),
    ...orderKeyColumns,
    createdAt: integer()
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer()
      .notNull()
      .$defaultFn(() => Date.now())
      .$onUpdateFn(() => Date.now()),
    // JSON-serialized PromptVariable[] — rendering metadata for ${var} template variables
    variables: text()
  },
  (t) => [
    orderKeyIndex('prompt')(t),
    index('prompt_updated_at_idx').on(t.updatedAt),
    foreignKey({
      name: 'prompt_current_version_fk',
      columns: [t.id, t.currentVersion],
      foreignColumns: [promptVersionTable.promptId, promptVersionTable.version]
    })
  ]
)
