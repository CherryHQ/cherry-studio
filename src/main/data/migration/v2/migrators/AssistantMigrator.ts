/**
 * Assistant migrator - migrates assistants from Redux to SQLite
 *
 * Data sources (all merged into one assistant table):
 * - state.assistants.assistants[] - user-created assistants + v1 initial
 *   state's id='default' copy
 * - state.assistants.presets[]    - saved presets
 * - state.assistants.defaultAssistant - standalone slot, id='default'
 *
 * Same-id collisions across sources are merged field-by-field
 * (see {@link mergeOldAssistants}); duplicates are NOT skipped, because the
 * v1 slice's initial state seeds `assistants[0]` and `defaultAssistant` from
 * the same factory and reducers update one or the other independently —
 * dropping either side loses real user data.
 *
 * Dropped fields: type, messages, topics, content, targetLanguage,
 *   enableGenerateImage, enableUrlContext, knowledgeRecognition,
 *   webSearchProviderId, regularPhrases
 *
 * Transformed fields:
 * - model/defaultModel -> assistant.modelId (composite format)
 * - tags[] -> tag + entity_tag tables
 *
 * See README-AssistantMigrator.md for the full merge contract and edge
 * cases (empty arrays, settings shallow-merge, unenumerated fields).
 */

import { assistantTable } from '@data/db/schemas/assistant'
import { assistantKnowledgeBaseTable, assistantMcpServerTable } from '@data/db/schemas/assistantRelations'
import { entityTagTable, tagTable } from '@data/db/schemas/tagging'
import { userModelTable } from '@data/db/schemas/userModel'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import { DEFAULT_ASSISTANT_ID, DEFAULT_ASSISTANT_PAYLOAD } from '@shared/data/types/assistant'
import { sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'
import { type AssistantTransformResult, type OldAssistant, transformAssistant } from './mappings/AssistantMappings'
import { resolveModelReference } from './transformers/ModelTransformers'

const logger = loggerService.withContext('AssistantMigrator')

interface AssistantState {
  assistants: OldAssistant[]
  presets: OldAssistant[]
  defaultAssistant?: OldAssistant
}

/**
 * Merge two same-id v1 assistant rows. `primary` wins on every field that has
 * a defined, non-empty value; `secondary` only fills the gaps. Used to
 * reconcile the two id='default' copies the v1 slice always holds (one in
 * `assistants[]`, one in `state.defaultAssistant`) without losing fields that
 * only one of them edited.
 *
 * "Non-empty" rules:
 * - Strings: must not be `''`.
 * - Arrays: must not be `[]` (so a default-empty `mcpServers: []` on primary
 *   does not clobber a populated `mcpServers: [s1]` on secondary).
 * - Plain objects: must not be `{}` (same hazard for `customParameters: {}` /
 *   `defaultModel: {}` on primary clobbering a populated value on secondary).
 * - Booleans: `false` is preserved (treated as a real choice).
 *
 * Settings is shallow-merged the same way (per-key first-non-empty wins).
 *
 * Unenumerated fields (anything `OldAssistant` doesn't list, or fields added
 * by future v1 versions) are preserved via object spread: secondary first,
 * then primary, so primary still wins on overlap.
 */
export function mergeOldAssistants(primary: OldAssistant, secondary: OldAssistant): OldAssistant {
  const isPresent = (v: unknown): boolean => {
    if (v === undefined || v === null || v === '') return false
    if (Array.isArray(v) && v.length === 0) return false
    // Plain empty object (e.g. default-seeded `customParameters: {}` /
    // `defaultModel: {}`). We restrict to plain objects so non-plain values
    // like `Date`, `Map`, or class instances aren't misclassified.
    if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype && Object.keys(v).length === 0) {
      return false
    }
    return true
  }
  const pickPrimaryThen = <K extends keyof OldAssistant>(key: K): OldAssistant[K] => {
    return isPresent(primary[key]) ? primary[key] : secondary[key]
  }
  const mergedSettings: OldAssistant['settings'] = (() => {
    const a = primary.settings
    const b = secondary.settings
    if (!a) return b
    if (!b) return a
    const merged: Record<string, unknown> = { ...b }
    for (const [k, v] of Object.entries(a)) {
      if (isPresent(v)) merged[k] = v
    }
    return merged as OldAssistant['settings']
  })()

  // Spread secondary first, then primary, so any field not listed below still
  // survives (primary wins on overlap). The explicit overrides below apply
  // first-non-empty merging to the typed `OldAssistant` fields.
  return {
    ...secondary,
    ...primary,
    id: primary.id,
    name: pickPrimaryThen('name'),
    prompt: pickPrimaryThen('prompt'),
    emoji: pickPrimaryThen('emoji'),
    description: pickPrimaryThen('description'),
    type: pickPrimaryThen('type'),
    model: pickPrimaryThen('model'),
    defaultModel: pickPrimaryThen('defaultModel'),
    settings: mergedSettings,
    mcpMode: pickPrimaryThen('mcpMode'),
    mcpServers: pickPrimaryThen('mcpServers'),
    knowledge_bases: pickPrimaryThen('knowledge_bases'),
    enableWebSearch: primary.enableWebSearch ?? secondary.enableWebSearch,
    tags: pickPrimaryThen('tags')
  }
}

export class AssistantMigrator extends BaseMigrator {
  readonly id = 'assistant'
  readonly name = 'Assistant'
  readonly description = 'Migrate assistant and preset configurations'
  readonly order = 2

  private preparedResults: AssistantTransformResult[] = []
  private skippedCount = 0
  private validAssistantIds = new Set<string>()

  override reset(): void {
    this.preparedResults = []
    this.skippedCount = 0
    this.validAssistantIds.clear()
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    this.preparedResults = []
    this.skippedCount = 0

    try {
      const warnings: string[] = []
      const state = ctx.sources.reduxState.getCategory<AssistantState>('assistants')

      if (!state) {
        logger.warn('No assistants category in Redux state')
        return { success: true, itemCount: 0, warnings: ['No assistants data found'] }
      }

      // Collect from all three v1 slots:
      //   - state.assistants[]: user-created + v1 initial-state copy of default (id='default')
      //   - state.presets[]:    saved presets
      //   - state.defaultAssistant: standalone slot, id=DEFAULT_ASSISTANT_ID='default'
      //
      // The v1 slice's initial state seeded *both* `defaultAssistant` and
      // `assistants[0]` from `getDefaultAssistant()` (id='default'); they then
      // drifted independently because `updateDefaultAssistant` writes only to
      // the slot, while `updateAssistant`/`updateAssistantSettings`/`addTopic`
      // write only to `assistants[]`. So real users typically have *both*
      // slots populated with overlapping but non-equivalent data on id='default'.
      //
      // Strategy: merge same-id sources field-by-field (first non-empty wins).
      // Push order: assistants[] → presets → defaultAssistant — `assistants[0]`
      // gets the live edits in v1 (settings page writes there), so it wins
      // for fields it has; `defaultAssistant` only fills in fields the live
      // copy left empty (less common, but happens when only the slot was
      // touched via `updateDefaultAssistant`).
      const sourceById = new Map<string, OldAssistant>()
      let totalRawSources = 0
      const recordSource = (source: OldAssistant): void => {
        totalRawSources++
        const { id } = source
        if (!id || typeof id !== 'string') {
          this.skippedCount++
          warnings.push(`Skipped assistant without valid id: ${source.name ?? 'unknown'}`)
          return
        }
        const existing = sourceById.get(id)
        if (existing) {
          // Note: not pushed to user-facing `warnings[]`. The v1 slice's
          // initialState seeds id='default' in BOTH `state.assistants[0]`
          // and `state.defaultAssistant`, so this fires on essentially every
          // real-user migration — surfacing it as a warning would noise the
          // progress UI. Logged at info level for diagnostics only.
          sourceById.set(id, mergeOldAssistants(existing, source))
          logger.info('Merged duplicate assistant id from secondary slot', { id })
        } else {
          sourceById.set(id, source)
        }
      }

      if (Array.isArray(state.assistants)) {
        for (const a of state.assistants) recordSource(a)
      }
      if (Array.isArray(state.presets)) {
        for (const a of state.presets) recordSource(a)
      }
      if (state.defaultAssistant && typeof state.defaultAssistant === 'object') {
        recordSource(state.defaultAssistant)
      }

      for (const source of sourceById.values()) {
        try {
          this.preparedResults.push(transformAssistant(source))
        } catch (err) {
          this.skippedCount++
          warnings.push(`Failed to transform assistant ${source.id}: ${(err as Error).message}`)
          logger.warn(`Skipping assistant ${source.id}`, err as Error)
        }
      }

      // Fail if there was raw input but nothing produced output — covers both
      // "every row had an invalid id" and "every row failed transformAssistant".
      // Either case means a systemic bug; silently committing an empty assistant
      // table would leave downstream FK validation (ChatMigrator) chasing a ghost.
      if (this.skippedCount > 0 && this.preparedResults.length === 0 && totalRawSources > 0) {
        logger.error('All assistants were skipped during preparation', { skipped: this.skippedCount })
        return { success: false, itemCount: 0, warnings }
      }

      logger.info('Preparation completed', {
        assistantCount: this.preparedResults.length,
        skipped: this.skippedCount
      })

      return {
        success: true,
        itemCount: this.preparedResults.length,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    } catch (error) {
      logger.error('Preparation failed', error as Error)
      return {
        success: false,
        itemCount: 0,
        warnings: [error instanceof Error ? error.message : String(error)]
      }
    }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    try {
      let processed = 0

      const BATCH_SIZE = 100
      const assistantRows = this.preparedResults.map((r) => r.assistant)
      const existingModelIds = new Set(
        (await ctx.db.select({ id: userModelTable.id }).from(userModelTable)).map((row) => row.id)
      )
      let droppedAssistantModelRefs = 0
      const sanitizedAssistantRows = assistantRows.map((row) => {
        const resolution = resolveModelReference(row.modelId ?? null, existingModelIds)
        if (resolution.kind === 'resolved') {
          return { ...row, modelId: resolution.modelId }
        }

        if (resolution.kind === 'dangling') {
          droppedAssistantModelRefs++
          logger.warn(`Dropping dangling assistant model ref: assistant=${row.id}, model=${resolution.modelId}`)
        }

        return { ...row, modelId: null }
      })

      // Whether the migrated v1 data already produced an id='default' row.
      // If not, we insert the canonical default payload so ChatMigrator's
      // orphan-fallback FK target (`topic.assistantId = 'default'`) is
      // valid before MigrationEngine's verifyForeignKeys() runs. The
      // post-migration `DefaultAssistantSeeder` only fires later in
      // DbService boot, which is too late for FK validation.
      const hasDefaultFromSources = sanitizedAssistantRows.some((row) => row.id === DEFAULT_ASSISTANT_ID)

      await ctx.db.transaction(async (tx) => {
        // Insert assistant rows
        for (let i = 0; i < sanitizedAssistantRows.length; i += BATCH_SIZE) {
          const batch = sanitizedAssistantRows.slice(i, i + BATCH_SIZE)
          await tx.insert(assistantTable).values(batch)
          processed += batch.length
        }

        // Backstop: insert the canonical default-assistant row if no v1
        // source produced one. Idempotent against the post-migration
        // seeder via PK conflict (the seeder is also a no-op when the
        // row exists). Logged at info level for diagnostics.
        if (!hasDefaultFromSources) {
          await tx.insert(assistantTable).values(DEFAULT_ASSISTANT_PAYLOAD).onConflictDoNothing()
          logger.info('Inserted default assistant backstop row (no v1 source produced one)')
        }

        // Remap mcpServer junction rows using oldId → newId mapping from McpServerMigrator.
        // Legacy assistant data references old-format IDs (e.g. @scope/server)
        // that were regenerated as new UUIDs by McpServerMigrator.
        const allMcpServerRows = this.preparedResults.flatMap((r) => r.mcpServers)
        const mcpServerIdMapping = ctx.sharedData.get('mcpServerIdMapping') as Map<string, string> | undefined
        if (!mcpServerIdMapping && allMcpServerRows.length > 0) {
          throw new Error(
            `mcpServerIdMapping not found in sharedData but ${allMcpServerRows.length} assistant_mcp_server rows need remapping. McpServerMigrator must run before AssistantMigrator.`
          )
        }
        const resolvedMapping = mcpServerIdMapping ?? new Map<string, string>()
        const mcpServerRows = allMcpServerRows
          .map((row) => {
            const newId = resolvedMapping.get(row.mcpServerId)
            if (newId) return { ...row, mcpServerId: newId }
            logger.warn(
              `Dropping dangling assistant_mcp_server ref: assistant=${row.assistantId}, mcpServer=${row.mcpServerId}`
            )
            return null
          })
          .filter((row): row is NonNullable<typeof row> => row !== null)
        for (let i = 0; i < mcpServerRows.length; i += BATCH_SIZE) {
          await tx.insert(assistantMcpServerTable).values(mcpServerRows.slice(i, i + BATCH_SIZE))
        }
        if (allMcpServerRows.length !== mcpServerRows.length) {
          logger.info(`Filtered ${allMcpServerRows.length - mcpServerRows.length} dangling mcp_server references`)
        }
        if (droppedAssistantModelRefs > 0) {
          logger.info(`Filtered ${droppedAssistantModelRefs} dangling assistant model references`)
        }

        const knowledgeBaseRows = this.preparedResults.flatMap((r) => r.knowledgeBases)
        for (let i = 0; i < knowledgeBaseRows.length; i += BATCH_SIZE) {
          await tx.insert(assistantKnowledgeBaseTable).values(knowledgeBaseRows.slice(i, i + BATCH_SIZE))
        }

        // --- Tag migration: assistant.tags[] → tag + entity_tag tables ---
        const uniqueTagNames = new Set<string>()
        const assistantTagNames = new Map<string, string[]>()
        for (const r of this.preparedResults) {
          if (r.tags.length > 0) {
            const dedupedTags = [...new Set(r.tags)]
            assistantTagNames.set(r.assistant.id as string, dedupedTags)
            for (const t of dedupedTags) uniqueTagNames.add(t)
          }
        }

        if (uniqueTagNames.size > 0) {
          const tagRows = [...uniqueTagNames].map((name) => ({ name }))
          let insertedTagRowCount = 0
          for (let i = 0; i < tagRows.length; i += BATCH_SIZE) {
            const insertedRows = await tx
              .insert(tagTable)
              .values(tagRows.slice(i, i + BATCH_SIZE))
              .onConflictDoNothing()
              .returning({ id: tagTable.id })
            insertedTagRowCount += insertedRows.length
          }

          // Query back to get tag IDs (name → id mapping)
          const insertedTags = await tx.select({ id: tagTable.id, name: tagTable.name }).from(tagTable)
          const tagNameToId = new Map(insertedTags.map((t) => [t.name, t.id]))
          const missingTagNames = [...uniqueTagNames].filter((name) => !tagNameToId.has(name))
          if (missingTagNames.length > 0) {
            logger.warn(`Tag migration could not resolve some tag names after insert`, { missingTagNames })
          }

          const entityTagRows: (typeof entityTagTable.$inferInsert)[] = []
          for (const [assistantId, tags] of assistantTagNames) {
            for (const tagName of tags) {
              const tagId = tagNameToId.get(tagName)
              if (tagId) {
                entityTagRows.push({ entityType: 'assistant', entityId: assistantId, tagId })
              }
            }
          }

          let insertedAssociationCount = 0
          for (let i = 0; i < entityTagRows.length; i += BATCH_SIZE) {
            const insertedRows = await tx
              .insert(entityTagTable)
              .values(entityTagRows.slice(i, i + BATCH_SIZE))
              .onConflictDoNothing()
              .returning({ tagId: entityTagTable.tagId })
            insertedAssociationCount += insertedRows.length
          }

          logger.info(`Migrated ${uniqueTagNames.size} unique tags and ${entityTagRows.length} tag associations`, {
            insertedTagRowCount,
            insertedAssociationCount
          })
        }
      })

      // Track valid IDs for FK validation by downstream migrators.
      // Precondition: transaction above has committed, so these IDs are in the DB.
      // ChatMigrator.execute() reads this set to validate topic.assistantId references.
      // Always include DEFAULT_ASSISTANT_ID — the backstop insert above
      // guarantees the row exists in DB, so it's a safe FK target for
      // orphan-topic fallback.
      this.validAssistantIds = new Set(this.preparedResults.map((r) => r.assistant.id as string))
      this.validAssistantIds.add(DEFAULT_ASSISTANT_ID)
      ctx.sharedData.set('assistantIds', this.validAssistantIds)

      this.reportProgress(100, `Migrated ${processed} assistants`, {
        key: 'migration.progress.migrated_assistants',
        params: { processed, total: this.preparedResults.length }
      })

      logger.info('Execute completed', { processedCount: processed })

      return { success: true, processedCount: processed }
    } catch (error) {
      logger.error('Execute failed', error as Error)
      return {
        success: false,
        processedCount: 0,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    try {
      const result = await ctx.db.select({ count: sql<number>`count(*)` }).from(assistantTable).get()
      const count = result?.count ?? 0
      const errors: { key: string; message: string }[] = []

      if (count !== this.preparedResults.length) {
        errors.push({
          key: 'count_mismatch',
          message: `Expected ${this.preparedResults.length} assistants but found ${count}`
        })
      }

      const sample = await ctx.db.select().from(assistantTable).limit(3).all()
      for (const assistant of sample) {
        if (!assistant.id || !assistant.name) {
          errors.push({ key: assistant.id ?? 'unknown', message: 'Missing required field (id or name)' })
        }
      }

      return {
        success: errors.length === 0,
        errors,
        stats: {
          sourceCount: this.preparedResults.length,
          targetCount: count,
          skippedCount: this.skippedCount
        }
      }
    } catch (error) {
      logger.error('Validation failed', error as Error)
      return {
        success: false,
        errors: [{ key: 'validation', message: error instanceof Error ? error.message : String(error) }],
        stats: {
          sourceCount: this.preparedResults.length,
          targetCount: 0,
          skippedCount: this.skippedCount
        }
      }
    }
  }
}
