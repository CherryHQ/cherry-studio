/**
 * Assistant migrator - migrates assistants from Redux to SQLite
 *
 * Data sources:
 * - Redux assistants slice (state.assistants.assistants) -> assistant table
 * - Redux assistants slice (state.assistants.presets) -> assistant table (merged)
 *
 * Dropped fields: type, model, defaultModel, messages, topics, tags,
 *   content, targetLanguage, enableGenerateImage, enableUrlContext,
 *   knowledgeRecognition, webSearchProviderId, regularPhrases
 */

import { assistantTable } from '@data/db/schemas/assistant'
import {
  assistantKnowledgeBaseTable,
  assistantMcpServerTable,
  assistantModelTable
} from '@data/db/schemas/assistantRelations'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import { sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'
import { type AssistantTransformResult, type OldAssistant, transformAssistant } from './mappings/AssistantMappings'

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

      // Merge assistants and presets into one list
      const allSources: OldAssistant[] = []

      if (Array.isArray(state.assistants)) {
        allSources.push(...state.assistants)
      }
      if (Array.isArray(state.presets)) {
        allSources.push(...state.presets)
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
      await ctx.db.transaction(async (tx) => {
        // Insert assistant rows
        const assistantRows = this.preparedResults.map((r) => r.assistant)
        for (let i = 0; i < assistantRows.length; i += BATCH_SIZE) {
          const batch = assistantRows.slice(i, i + BATCH_SIZE)
          await tx.insert(assistantTable).values(batch)
          processed += batch.length
        }

        // Insert junction table rows
        const modelRows = this.preparedResults.flatMap((r) => r.models)
        for (let i = 0; i < modelRows.length; i += BATCH_SIZE) {
          await tx.insert(assistantModelTable).values(modelRows.slice(i, i + BATCH_SIZE))
        }

        // Remap mcpServer junction rows using oldId → newId mapping from McpServerMigrator.
        // Legacy assistant data references old-format IDs (e.g. @scope/server)
        // that were regenerated as new UUIDs by McpServerMigrator.
        const allMcpServerRows = this.preparedResults.flatMap((r) => r.mcpServers)
        const mcpServerIdMapping = ctx.sharedData.get('mcpServerIdMapping') as Map<string, string> | undefined
        if (!mcpServerIdMapping && allMcpServerRows.length > 0) {
          logger.warn('mcpServerIdMapping not found in sharedData — all assistant_mcp_server rows will be dropped')
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

        const knowledgeBaseRows = this.preparedResults.flatMap((r) => r.knowledgeBases)
        for (let i = 0; i < knowledgeBaseRows.length; i += BATCH_SIZE) {
          await tx.insert(assistantKnowledgeBaseTable).values(knowledgeBaseRows.slice(i, i + BATCH_SIZE))
        }
      })

      // Track valid IDs for FK validation by downstream migrators
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
