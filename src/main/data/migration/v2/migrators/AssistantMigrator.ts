/**
 * Assistant migrator - migrates assistants from Redux to SQLite
 *
 * Data sources:
 * - Redux assistants slice (state.assistants.assistants) -> assistant table
 * - Redux assistants slice (state.assistants.presets) -> assistant table (merged)
 *
 * Dropped fields: type, messages, topics, content, targetLanguage,
 *   enableGenerateImage, enableUrlContext, knowledgeRecognition,
 *   webSearchProviderId, regularPhrases
 *
 * Transformed fields:
 * - model/defaultModel -> assistant.modelId (composite format)
 * - tags[] -> tag + entity_tag tables
 */

import { assistantTable } from '@data/db/schemas/assistant'
import { assistantKnowledgeBaseTable, assistantMcpServerTable } from '@data/db/schemas/assistantRelations'
import { entityTagTable, tagTable } from '@data/db/schemas/tagging'
import { userModelTable } from '@data/db/schemas/userModel'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
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
 * Settings is shallow-merged the same way (per-key first-non-empty wins) so
 * a user who only ever touched `defaultAssistant.settings.temperature` and
 * left `assistants[0].settings.temperature` at the seed value still gets
 * their value preserved when the seed-default key is undefined.
 */
function mergeOldAssistants(primary: OldAssistant, secondary: OldAssistant): OldAssistant {
  const pickPrimaryThen = <K extends keyof OldAssistant>(key: K): OldAssistant[K] => {
    const p = primary[key]
    if (p !== undefined && p !== null && p !== '') return p
    return secondary[key]
  }
  const mergedSettings: OldAssistant['settings'] = (() => {
    const a = primary.settings
    const b = secondary.settings
    if (!a) return b
    if (!b) return a
    const merged: Record<string, unknown> = { ...b }
    for (const [k, v] of Object.entries(a)) {
      if (v !== undefined && v !== null && v !== '') merged[k] = v
    }
    return merged as OldAssistant['settings']
  })()

  return {
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
      const recordSource = (source: OldAssistant): void => {
        const { id } = source
        if (!id || typeof id !== 'string') {
          this.skippedCount++
          warnings.push(`Skipped assistant without valid id: ${source.name ?? 'unknown'}`)
          return
        }
        const existing = sourceById.get(id)
        if (existing) {
          sourceById.set(id, mergeOldAssistants(existing, source))
          logger.info(`Merged duplicate assistant id ${id} from secondary slot`)
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

      // Fail if all items were skipped but source had data (indicates systemic issue)
      if (this.skippedCount > 0 && this.preparedResults.length === 0 && sourceById.size === 0) {
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
    if (this.preparedResults.length === 0) {
      return { success: true, processedCount: 0 }
    }

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

      await ctx.db.transaction(async (tx) => {
        // Insert assistant rows
        for (let i = 0; i < sanitizedAssistantRows.length; i += BATCH_SIZE) {
          const batch = sanitizedAssistantRows.slice(i, i + BATCH_SIZE)
          await tx.insert(assistantTable).values(batch)
          processed += batch.length
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
      this.validAssistantIds = new Set(this.preparedResults.map((r) => r.assistant.id as string))
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
