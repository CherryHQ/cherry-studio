/**
 * Assistant migrator - migrates assistants and presets from Redux to SQLite
 *
 * Data source: Redux `assistants` slice
 * - assistants.assistants[]: User-created assistants
 * - assistants.defaultAssistant: The default assistant
 * - assistants.presets[]: Assistant presets/templates
 * - assistants.tagsOrder / collapsedTags / unifiedListOrder: Metadata → preferences
 *
 * Target table: user_assistant
 */

import type { NewUserAssistant } from '@data/db/schemas/userAssistant'
import { userAssistantTable } from '@data/db/schemas/userAssistant'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import { eq, sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'
import {
  type OldAssistant,
  type OldAssistantPreset,
  transformAssistant,
  transformPreset
} from './mappings/AssistantMappings'

const logger = loggerService.withContext('AssistantMigrator')

const BATCH_SIZE = 100

/** Assistants state structure from Redux */
interface AssistantsState {
  defaultAssistant?: OldAssistant
  assistants?: OldAssistant[]
  presets?: OldAssistantPreset[]
  tagsOrder?: string[]
  collapsedTags?: Record<string, boolean>
  unifiedListOrder?: Array<{ type: string; id: string }>
}

export class AssistantMigrator extends BaseMigrator {
  readonly id = 'assistant'
  readonly name = 'Assistant'
  readonly description = 'Migrate assistant and preset configuration'
  readonly order = 3

  private defaultAssistant: OldAssistant | null = null
  private assistants: OldAssistant[] = []
  private presets: OldAssistantPreset[] = []
  private expectedCount = 0
  private seenIds = new Set<string>()

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    const warnings: string[] = []

    try {
      const state = ctx.sources.reduxState.getCategory<AssistantsState>('assistants')
      if (!state) {
        logger.warn('No assistants state found in Redux')
        return {
          success: true,
          itemCount: 0,
          warnings: ['No assistant data found - skipping assistant migration']
        }
      }

      this.defaultAssistant = state.defaultAssistant ?? null
      this.assistants = state.assistants ?? []
      this.presets = state.presets ?? []

      // Calculate expected count:
      // defaultAssistant (1) + assistants[] + presets[]
      // But defaultAssistant may also appear in assistants[], so deduplicate
      this.expectedCount = 0

      if (this.defaultAssistant) {
        this.seenIds.add(this.defaultAssistant.id)
        this.expectedCount++
      }

      for (const a of this.assistants) {
        if (!this.seenIds.has(a.id)) {
          this.seenIds.add(a.id)
          this.expectedCount++
        }
      }

      for (const p of this.presets) {
        if (!this.seenIds.has(p.id)) {
          this.seenIds.add(p.id)
          this.expectedCount++
        }
      }

      logger.info('Prepare completed', {
        defaultAssistant: !!this.defaultAssistant,
        assistantCount: this.assistants.length,
        presetCount: this.presets.length,
        expectedCount: this.expectedCount
      })

      return {
        success: true,
        itemCount: this.expectedCount,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    } catch (error) {
      logger.error('Prepare failed', error as Error)
      return {
        success: false,
        itemCount: 0,
        warnings: [error instanceof Error ? error.message : String(error)]
      }
    }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    if (this.expectedCount === 0) {
      return { success: true, processedCount: 0 }
    }

    let processedCount = 0

    try {
      const db = ctx.db
      const insertedIds = new Set<string>()
      let sortIndex = 0

      await db.transaction(async (tx) => {
        // 1. Insert defaultAssistant first (isDefault=true)
        if (this.defaultAssistant) {
          const row = transformAssistant(this.defaultAssistant, sortIndex++, true)
          await tx.insert(userAssistantTable).values(row)
          insertedIds.add(this.defaultAssistant.id)
          processedCount++
        }

        // 2. Insert regular assistants (skip if already inserted as default)
        const assistantRows: NewUserAssistant[] = []
        for (const a of this.assistants) {
          if (insertedIds.has(a.id)) continue
          insertedIds.add(a.id)
          assistantRows.push(transformAssistant(a, sortIndex++))
        }

        for (let i = 0; i < assistantRows.length; i += BATCH_SIZE) {
          const batch = assistantRows.slice(i, i + BATCH_SIZE)
          await tx.insert(userAssistantTable).values(batch)
          processedCount += batch.length

          const progress = Math.round((processedCount / this.expectedCount) * 100)
          this.reportProgress(progress, `已迁移 ${processedCount}/${this.expectedCount} 个助手`)
        }

        // 3. Insert presets (skip if already inserted)
        const presetRows: NewUserAssistant[] = []
        for (const p of this.presets) {
          if (insertedIds.has(p.id)) continue
          insertedIds.add(p.id)
          presetRows.push(transformPreset(p, sortIndex++))
        }

        for (let i = 0; i < presetRows.length; i += BATCH_SIZE) {
          const batch = presetRows.slice(i, i + BATCH_SIZE)
          await tx.insert(userAssistantTable).values(batch)
          processedCount += batch.length
        }
      })

      logger.info('Execute completed', { processedCount })

      return {
        success: true,
        processedCount
      }
    } catch (error) {
      logger.error('Execute failed', error as Error)
      return {
        success: false,
        processedCount,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    const errors: ValidationError[] = []
    const db = ctx.db

    try {
      // Count total
      const totalResult = await db.select({ count: sql<number>`count(*)` }).from(userAssistantTable).get()
      const targetCount = totalResult?.count ?? 0

      // Count defaults
      const defaultResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(userAssistantTable)
        .where(eq(userAssistantTable.isDefault, true))
        .get()
      const defaultCount = defaultResult?.count ?? 0

      logger.info('Validation counts', {
        expectedCount: this.expectedCount,
        targetCount,
        defaultCount
      })

      // Validate count
      if (targetCount < this.expectedCount) {
        errors.push({
          key: 'count_mismatch',
          message: `Expected ${this.expectedCount} assistants, got ${targetCount}`
        })
      }

      // Validate exactly one default
      if (this.defaultAssistant && defaultCount !== 1) {
        errors.push({
          key: 'default_count',
          message: `Expected exactly 1 default assistant, got ${defaultCount}`
        })
      }

      // Sample validation: check a few names match
      const sampleRows = await db.select().from(userAssistantTable).limit(5).all()

      for (const row of sampleRows) {
        const source =
          [...this.assistants, ...(this.defaultAssistant ? [this.defaultAssistant] : [])].find(
            (a) => a.id === row.assistantId
          ) ?? this.presets.find((p) => p.id === row.assistantId)

        if (source && source.name !== row.name) {
          errors.push({
            key: `name_mismatch_${row.assistantId}`,
            message: `Assistant ${row.assistantId}: expected name "${source.name}", got "${row.name}"`
          })
        }
      }

      return {
        success: errors.length === 0,
        errors,
        stats: {
          sourceCount: this.expectedCount,
          targetCount,
          skippedCount: 0
        }
      }
    } catch (error) {
      logger.error('Validation failed', error as Error)
      return {
        success: false,
        errors: [
          {
            key: 'validation',
            message: error instanceof Error ? error.message : String(error)
          }
        ],
        stats: {
          sourceCount: this.expectedCount,
          targetCount: 0,
          skippedCount: 0
        }
      }
    }
  }
}
