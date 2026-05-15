/**
 * Migrates v1 Redux assistants/presets/defaultAssistant into the assistant table.
 * See README-AssistantMigrator.md for sources, merge contract, and dropped fields.
 */

import { assistantTable } from '@data/db/schemas/assistant'
import { assistantKnowledgeBaseTable, assistantMcpServerTable } from '@data/db/schemas/assistantRelations'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { entityTagTable, tagTable } from '@data/db/schemas/tagging'
import { userModelTable } from '@data/db/schemas/userModel'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import { sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import type { MigrationContext } from '../core/MigrationContext'
import { assignOrderKeysInSequence } from '../utils/orderKey'
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
 * Merge two same-id v1 assistant rows: primary wins on present fields,
 * secondary fills gaps. See README-AssistantMigrator.md for the contract.
 */
export function mergeOldAssistants(primary: OldAssistant, secondary: OldAssistant): OldAssistant {
  const isPresent = (v: unknown): boolean => {
    if (v === undefined || v === null || v === '') return false
    if (Array.isArray(v) && v.length === 0) return false
    // Restrict to plain {} so Date/Map/class instances aren't misclassified.
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

  // Spread baseline preserves fields not in OldAssistant; explicit overrides apply isPresent rules.
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
    enableWebSearch: pickPrimaryThen('enableWebSearch'),
    tags: pickPrimaryThen('tags')
  }
}

// Compile-time exhaustiveness guard: adding a new field to OldAssistant fails
// here until its merge rule is declared, preventing silent fall-through to the
// `...secondary, ...primary` spread (which skips isPresent-based protection).
const _MERGE_RULES_COVERED = {
  id: 'identity',
  name: 'pickPrimary',
  prompt: 'pickPrimary',
  emoji: 'pickPrimary',
  description: 'pickPrimary',
  type: 'pickPrimary',
  model: 'pickPrimary',
  defaultModel: 'pickPrimary',
  settings: 'shallowMerge',
  mcpMode: 'pickPrimary',
  mcpServers: 'pickPrimary',
  knowledge_bases: 'pickPrimary',
  enableWebSearch: 'pickPrimary',
  tags: 'pickPrimary'
} as const satisfies Record<keyof OldAssistant, 'identity' | 'pickPrimary' | 'shallowMerge'>
void _MERGE_RULES_COVERED

export class AssistantMigrator extends BaseMigrator {
  readonly id = 'assistant'
  readonly name = 'Assistant'
  readonly description = 'Migrate assistant and preset configurations'
  readonly order = 2

  private preparedResults: AssistantTransformResult[] = []
  private skippedCount = 0
  private validAssistantIds = new Set<string>()
  // v1 → v2 id remap. Currently only used for the legacy 'default' sentinel,
  // which v2 doesn't preserve as an id — the row is migrated as a normal user
  // assistant under a generated UUID. ChatMigrator reads this map to remap
  // any topic.assistantId === 'default' to the new UUID.
  private legacyAssistantIdRemap = new Map<string, string>()

  override reset(): void {
    this.preparedResults = []
    this.skippedCount = 0
    this.validAssistantIds.clear()
    this.legacyAssistantIdRemap.clear()
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    this.preparedResults = []
    this.skippedCount = 0
    this.legacyAssistantIdRemap.clear()

    try {
      const warnings: string[] = []
      const state = ctx.sources.reduxState.getCategory<AssistantState>('assistants')

      if (!state) {
        logger.warn('No assistants category in Redux state')
        return { success: true, itemCount: 0, warnings: ['No assistants data found'] }
      }

      // Push order matters: assistants[0] (live edits) wins over defaultAssistant
      // on same-id collision. See README-AssistantMigrator.md.
      const sourceById = new Map<string, OldAssistant>()
      let totalRawSources = 0
      const recordSource = (source: OldAssistant): void => {
        totalRawSources++
        const rawId = source.id
        if (!rawId || typeof rawId !== 'string') {
          this.skippedCount++
          warnings.push(`Skipped assistant without valid id: ${source.name ?? 'unknown'}`)
          return
        }
        // v1 'default' is a sentinel, not an entity id — remap to a UUID so it
        // migrates as a normal user assistant.
        let id = rawId
        if (rawId === 'default') {
          let mapped = this.legacyAssistantIdRemap.get(rawId)
          if (!mapped) {
            mapped = uuidv4()
            this.legacyAssistantIdRemap.set(rawId, mapped)
          }
          id = mapped
          source = { ...source, id }
        }
        const existing = sourceById.get(id)
        if (existing) {
          // Silent: legacy 'default' duplicate fires on every real-user migration.
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

      // Raw input but no output → systemic bug (id-invalid for all, or transform threw on all).
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
      const orderedAssistantRows = assignOrderKeysInSequence(sanitizedAssistantRows)

      await ctx.db.transaction(async (tx) => {
        for (let i = 0; i < orderedAssistantRows.length; i += BATCH_SIZE) {
          const batch = orderedAssistantRows.slice(i, i + BATCH_SIZE)
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

        // Filter dangling knowledge_base references: v1 may carry assistant.knowledge_bases[] entries
        // pointing to knowledge bases that were deleted or skipped by KnowledgeMigrator. Inserting
        // them violates the FK on assistant_knowledge_base.knowledge_base_id.
        const allKnowledgeBaseRows = this.preparedResults.flatMap((r) => r.knowledgeBases)
        const existingKnowledgeBaseIds = new Set(
          (await tx.select({ id: knowledgeBaseTable.id }).from(knowledgeBaseTable)).map((r) => r.id)
        )
        const knowledgeBaseRows = allKnowledgeBaseRows.filter((row) => {
          if (existingKnowledgeBaseIds.has(row.knowledgeBaseId)) return true
          logger.warn(
            `Dropping dangling assistant_knowledge_base ref: assistant=${row.assistantId}, knowledgeBase=${row.knowledgeBaseId}`
          )
          return false
        })
        for (let i = 0; i < knowledgeBaseRows.length; i += BATCH_SIZE) {
          await tx.insert(assistantKnowledgeBaseTable).values(knowledgeBaseRows.slice(i, i + BATCH_SIZE))
        }
        if (allKnowledgeBaseRows.length !== knowledgeBaseRows.length) {
          logger.info(
            `Filtered ${allKnowledgeBaseRows.length - knowledgeBaseRows.length} dangling knowledge_base references`
          )
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

      // FK whitelist for ChatMigrator. v2 has no system-reserved 'default' row,
      // so the set contains only the migrated user assistants (including the
      // legacy 'default' under its remapped UUID).
      this.validAssistantIds = new Set(this.preparedResults.map((r) => r.assistant.id as string))
      ctx.sharedData.set('assistantIds', this.validAssistantIds)
      ctx.sharedData.set('legacyAssistantIdRemap', this.legacyAssistantIdRemap)

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
