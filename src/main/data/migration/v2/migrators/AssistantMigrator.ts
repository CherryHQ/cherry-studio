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

      // Merge assistants, presets, and the v1 default assistant into one list.
      // `state.defaultAssistant` lives in its own slot (id == DEFAULT_ASSISTANT_ID
      // == 'default'), separate from `state.assistants[]`. Without including it,
      // user customizations on the default assistant (prompt / model / settings)
      // are lost on migration. Dedup by id below handles any overlap with the
      // assistants/presets lists, and the post-migration DefaultAssistantSeeder
      // is idempotent — if the migrated row already has id 'default', the seeder
      // is a no-op.
      const allSources: OldAssistant[] = []

      if (Array.isArray(state.assistants)) {
        allSources.push(...state.assistants)
      }
      if (Array.isArray(state.presets)) {
        allSources.push(...state.presets)
      }
      if (state.defaultAssistant && typeof state.defaultAssistant === 'object') {
        allSources.push(state.defaultAssistant)
      }

      // Deduplicate by ID
      const seenIds = new Set<string>()

      for (const source of allSources) {
        const { id } = source
        if (!id || typeof id !== 'string') {
          this.skippedCount++
          warnings.push(`Skipped assistant without valid id: ${source.name ?? 'unknown'}`)
          continue
        }

        if (seenIds.has(id)) {
          this.skippedCount++
          warnings.push(`Skipped duplicate assistant id: ${id}`)
          continue
        }
        seenIds.add(id)

        try {
          this.preparedResults.push(transformAssistant(source))
        } catch (err) {
          this.skippedCount++
          warnings.push(`Failed to transform assistant ${id}: ${(err as Error).message}`)
          logger.warn(`Skipping assistant ${id}`, err as Error)
        }
      }

      // Fail if all items were skipped but source had data (indicates systemic issue)
      if (this.skippedCount > 0 && this.preparedResults.length === 0 && allSources.length > 0) {
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
