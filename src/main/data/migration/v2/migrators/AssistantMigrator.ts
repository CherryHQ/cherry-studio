/**
 * Migrates v1 Redux assistants/presets/defaultAssistant into the assistant table.
 * See README-AssistantMigrator.md for sources, merge contract, and dropped fields.
 */

import { assistantTable } from '@data/db/schemas/assistant'
import { assistantKnowledgeBaseTable, assistantMcpServerTable } from '@data/db/schemas/assistantRelations'
import { groupTable } from '@data/db/schemas/group'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { userModelTable } from '@data/db/schemas/userModel'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import { eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import type { MigrationContext } from '../core/MigrationContext'
import { assignOrderKeysInSequence } from '../utils/orderKey'
import { BaseMigrator } from './BaseMigrator'
import { KNOWLEDGE_BASE_ID_REMAP_SHARED_DATA_KEY } from './KnowledgeMigrator'
import { type AssistantTransformResult, type OldAssistant, transformAssistant } from './mappings/AssistantMappings'
import { resolveModelReference } from './transformers/ModelTransformers'

const logger = loggerService.withContext('AssistantMigrator')

interface AssistantState {
  assistants: OldAssistant[]
  presets: OldAssistant[]
  defaultAssistant?: OldAssistant
  tagsOrder?: unknown
}

interface PreparedAssistantGroup {
  id: string
  entityType: 'assistant'
  name: string
  orderKey: string
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
  private preparedGroups: PreparedAssistantGroup[] = []
  private skippedCount = 0
  private validAssistantIds = new Set<string>()
  // v1 → v2 id remap. Currently only used for the legacy 'default' sentinel,
  // which v2 doesn't preserve as an id — the row is migrated as a normal user
  // assistant under a generated UUID. ChatMigrator reads this map to remap
  // any topic.assistantId === 'default' to the new UUID.
  private legacyAssistantIdRemap = new Map<string, string>()

  override reset(): void {
    this.preparedResults = []
    this.preparedGroups = []
    this.skippedCount = 0
    this.validAssistantIds.clear()
    this.legacyAssistantIdRemap.clear()
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    this.preparedResults = []
    this.preparedGroups = []
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
          const result = transformAssistant(source)
          this.preparedResults.push(result)
          if (result.discardedLegacyTagCount > 0) {
            const warning = `Discarded ${result.discardedLegacyTagCount} invalid or additional legacy tag entries for assistant ${source.id}`
            warnings.push(warning)
            logger.warn(warning)
          }
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

      const usedGroupNames = [
        ...new Set(
          this.preparedResults
            .map((result) => result.legacyTagName)
            .filter((name): name is string => typeof name === 'string')
        )
      ]
      const usedGroupNameSet = new Set(usedGroupNames)
      const savedGroupOrder = Array.isArray(state.tagsOrder)
        ? state.tagsOrder
            .filter((name): name is string => typeof name === 'string')
            .map((name) => name.trim())
            .filter((name) => name.length > 0 && usedGroupNameSet.has(name))
        : []
      const orderedGroupNames = [
        ...new Set(savedGroupOrder),
        ...usedGroupNames.filter((name) => !savedGroupOrder.includes(name))
      ]
      this.preparedGroups = assignOrderKeysInSequence(
        orderedGroupNames.map((name) => ({ id: uuidv4(), entityType: 'assistant' as const, name }))
      )

      logger.info('Preparation completed', {
        assistantCount: this.preparedResults.length,
        groupCount: this.preparedGroups.length,
        skipped: this.skippedCount
      })

      return {
        success: true,
        itemCount: this.preparedResults.length,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    } catch (error) {
      this.capturePhaseFailure(error)
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
      const groupIdByName = new Map(this.preparedGroups.map((group) => [group.name, group.id]))
      const assistantRows = this.preparedResults.map((result) => {
        const groupName = result.legacyTagName
        return {
          ...result.assistant,
          groupId: groupName ? groupIdByName.get(groupName)! : null
        }
      })
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

      // Stamp legacy rows with real fractional-indexing keys, ordered by
      // transform/insert sequence.
      // Uses the migrator-side helper per data-ordering-guide.md §5.
      const orderedAssistantRows = assignOrderKeysInSequence(sanitizedAssistantRows)

      ctx.db.transaction((tx) => {
        for (let i = 0; i < this.preparedGroups.length; i += BATCH_SIZE) {
          tx.insert(groupTable)
            .values(this.preparedGroups.slice(i, i + BATCH_SIZE))
            .run()
        }

        for (let i = 0; i < orderedAssistantRows.length; i += BATCH_SIZE) {
          const batch = orderedAssistantRows.slice(i, i + BATCH_SIZE)
          this.runDiagnosedWrite(
            () =>
              batch.flatMap((row) => [
                { role: 'text_value' as const, kind: 'string' as const, value: row.prompt ?? '' },
                { role: 'text_value' as const, kind: 'string' as const, value: row.description ?? '' },
                { role: 'json_value' as const, kind: 'json' as const, value: row.settings }
              ]),
            () => tx.insert(assistantTable).values(batch).run()
          )
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
          tx.insert(assistantMcpServerTable)
            .values(mcpServerRows.slice(i, i + BATCH_SIZE))
            .run()
        }
        if (allMcpServerRows.length !== mcpServerRows.length) {
          logger.info(`Filtered ${allMcpServerRows.length - mcpServerRows.length} dangling mcp_server references`)
        }
        if (droppedAssistantModelRefs > 0) {
          logger.info(`Filtered ${droppedAssistantModelRefs} dangling assistant model references`)
        }

        // Translate, then filter, knowledge_base references. v1 stores assistant.knowledge_bases[]
        // with the legacy Redux base id, but KnowledgeMigrator (order 1.8, runs BEFORE this migrator)
        // re-creates every base under a fresh uuid and publishes the legacy→new id map to sharedData.
        // Translate each junction row to the new id before filtering — without this, every row carries
        // a legacy id that never matches the new-uuid set below, so the association is silently
        // dropped. A legacy id absent from the map points at a base KnowledgeMigrator deleted/skipped,
        // so it stays unmapped and is dropped here (inserting it would violate the FK on
        // assistant_knowledge_base.knowledge_base_id).
        const knowledgeBaseIdRemapRaw = ctx.sharedData.get(KNOWLEDGE_BASE_ID_REMAP_SHARED_DATA_KEY)
        const knowledgeBaseIdRemap =
          knowledgeBaseIdRemapRaw instanceof Map
            ? (knowledgeBaseIdRemapRaw as Map<string, string>)
            : new Map<string, string>()
        const allKnowledgeBaseRows = this.preparedResults.flatMap((r) => r.knowledgeBases)
        const existingKnowledgeBaseIds = new Set(
          tx
            .select({ id: knowledgeBaseTable.id })
            .from(knowledgeBaseTable)
            .all()
            .map((r) => r.id)
        )
        const knowledgeBaseRows = allKnowledgeBaseRows
          .map((row) => {
            const migratedId = knowledgeBaseIdRemap.get(row.knowledgeBaseId)
            return migratedId ? { ...row, knowledgeBaseId: migratedId } : row
          })
          .filter((row) => {
            if (existingKnowledgeBaseIds.has(row.knowledgeBaseId)) return true
            logger.warn(
              `Dropping dangling assistant_knowledge_base ref: assistant=${row.assistantId}, knowledgeBase=${row.knowledgeBaseId}`
            )
            return false
          })
        for (let i = 0; i < knowledgeBaseRows.length; i += BATCH_SIZE) {
          tx.insert(assistantKnowledgeBaseTable)
            .values(knowledgeBaseRows.slice(i, i + BATCH_SIZE))
            .run()
        }
        if (allKnowledgeBaseRows.length !== knowledgeBaseRows.length) {
          logger.info(
            `Filtered ${allKnowledgeBaseRows.length - knowledgeBaseRows.length} dangling knowledge_base references`
          )
        }
      })

      // Self-check FK integrity for the tables that should be fully resolved by now:
      // assistant.modelId is sanitized, assistant.groupId points at groups inserted in the
      // same transaction, and assistant_mcp_server.mcpServerId points at rows McpServerMigrator
      // (order 1.5) already inserted. assistant_knowledge_base is intentionally EXCLUDED — KnowledgeMigrator
      // (order 1.8) already created its bases and we just remapped each junction row's knowledgeBaseId
      // legacy→new and dropped any unmapped ref above, so the engine's final verifyForeignKeys() is
      // the single source of truth for them.
      this.assertOwnedForeignKeys(ctx.db, [groupTable, assistantTable, assistantMcpServerTable])

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

      logger.info('Execute completed', { processedCount: processed, groupCount: this.preparedGroups.length })

      return { success: true, processedCount: processed }
    } catch (error) {
      this.capturePhaseFailure(error)
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
      const result = ctx.db.select({ count: sql<number>`count(*)` }).from(assistantTable).get()
      const count = result?.count ?? 0
      const groupResult = ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(groupTable)
        .where(eq(groupTable.entityType, 'assistant'))
        .get()
      const groupCount = groupResult?.count ?? 0
      const errors: { key: string; message: string }[] = []

      if (count !== this.preparedResults.length) {
        errors.push({
          key: 'count_mismatch',
          message: `Expected ${this.preparedResults.length} assistants but found ${count}`
        })
      }

      if (groupCount !== this.preparedGroups.length) {
        errors.push({
          key: 'group_count_mismatch',
          message: `Expected ${this.preparedGroups.length} assistant groups but found ${groupCount}`
        })
      }

      const sample = ctx.db.select().from(assistantTable).limit(3).all()
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
      this.capturePhaseFailure(error)
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
