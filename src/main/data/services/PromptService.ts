/**
 * Prompt Service - handles prompt CRUD, ordering, and version management
 *
 * Invariants maintained by this service:
 * - Every `prompt` row has a matching `prompt_version(promptId, currentVersion)` row.
 * - `prompt_version` history is append-only: rollback inserts a new snapshot;
 *   prior rows are never mutated. Variables-only edits are the sole exception
 *   — they update the current version's variables in place (no new version).
 * - Ordering: whole-table fractional-indexing `orderKey`. Reorder paths go
 *   through `applyMoves`; callers never touch `orderKey` directly.
 */

import { promptTable, promptVersionTable } from '@data/db/schemas/prompt'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreatePromptDto, RollbackPromptDto, UpdatePromptDto } from '@shared/data/api/schemas/prompts'
import type { Prompt, PromptVariable, PromptVersion } from '@shared/data/types/prompt'
import { PromptVariablesSchema } from '@shared/data/types/prompt'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'

import { applyMoves, insertWithOrderKey } from './utils/orderKey'

const logger = loggerService.withContext('DataApi:PromptService')

/**
 * Safely parse a JSON variables string from DB. Returns parsed array on
 * success, null on failure. Logs at `error` because this path only fires for
 * genuinely malformed / schema-drifted data in persisted rows.
 */
function safeParseVariables(raw: string | null): PromptVariable[] | null {
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw)
    const result = PromptVariablesSchema.safeParse(parsed)
    if (result.success) return result.data
    logger.error('Invalid variables JSON in DB, returning null', { error: result.error.message })
    return null
  } catch (error) {
    logger.error('Malformed variables JSON in DB, returning null', error as Error)
    return null
  }
}

function serializeVariables(variables: PromptVariable[] | null | undefined): string | null {
  if (variables === null || variables === undefined) return null
  return JSON.stringify(variables)
}

function rowToPrompt(row: typeof promptTable.$inferSelect): Prompt {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    currentVersion: row.currentVersion,
    variables: safeParseVariables(row.variables),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString()
  }
}

/**
 * Extract any `before`/`after` id referenced by a set of anchors. Reorder
 * callers feed these into the existence pre-check so that a missing anchor
 * surfaces as `NOT_FOUND` from the handler, not a 500 from `applyMoves`.
 */
function collectAnchorIds(anchors: OrderRequest[]): string[] {
  const ids: string[] = []
  for (const anchor of anchors) {
    if ('before' in anchor) ids.push(anchor.before)
    if ('after' in anchor) ids.push(anchor.after)
  }
  return ids
}

function rowToVersion(row: typeof promptVersionTable.$inferSelect): PromptVersion {
  return {
    id: row.id,
    promptId: row.promptId,
    version: row.version,
    content: row.content,
    rollbackFrom: row.rollbackFrom,
    variables: safeParseVariables(row.variables),
    createdAt: new Date(row.createdAt).toISOString()
  }
}

export class PromptService {
  private get db() {
    return application.get('DbService').getDb()
  }

  async getAll(): Promise<Prompt[]> {
    const rows = await this.db.select().from(promptTable).orderBy(asc(promptTable.orderKey))
    return rows.map(rowToPrompt)
  }

  async getById(id: string): Promise<Prompt> {
    const [row] = await this.db.select().from(promptTable).where(eq(promptTable.id, id)).limit(1)
    if (!row) {
      throw DataApiErrorFactory.notFound('Prompt', id)
    }
    return rowToPrompt(row)
  }

  async create(dto: CreatePromptDto): Promise<Prompt> {
    const variablesJson = serializeVariables(dto.variables ?? null)

    return this.db.transaction(async (tx) => {
      // The composite FK `prompt(id, currentVersion) → prompt_version(promptId, version)`
      // would fire on the prompt INSERT before the matching prompt_version row exists
      // (and the reverse FK makes the opposite order equally unsolvable). Defer all
      // FK checks to commit time so both paired rows land atomically.
      await tx.run(sql`PRAGMA defer_foreign_keys = ON`)

      const inserted = await insertWithOrderKey(
        tx,
        promptTable,
        {
          title: dto.title,
          content: dto.content,
          currentVersion: 1,
          variables: variablesJson
        },
        { pkColumn: promptTable.id }
      )
      const row = inserted as typeof promptTable.$inferSelect

      await tx.insert(promptVersionTable).values({
        promptId: row.id,
        version: 1,
        content: dto.content,
        variables: variablesJson
      })

      logger.info('Created prompt', { id: row.id, title: dto.title })
      return rowToPrompt(row)
    })
  }

  /**
   * Update a prompt.
   * - Content change: new `prompt_version` row (version = currentVersion+1),
   *   snapshot inherits existing variables unless the DTO provides them.
   * - Variables-only change: current version's `variables` column is updated
   *   in place, no new version is created.
   */
  async update(id: string, dto: UpdatePromptDto): Promise<Prompt> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(promptTable).where(eq(promptTable.id, id)).limit(1)
      if (!existing) {
        throw DataApiErrorFactory.notFound('Prompt', id)
      }

      if (dto.title === undefined && dto.content === undefined && dto.variables === undefined) {
        return rowToPrompt(existing)
      }

      const updates: Partial<typeof promptTable.$inferInsert> = {}
      if (dto.title !== undefined) updates.title = dto.title
      if (dto.content !== undefined) updates.content = dto.content

      // Serialize once, reuse for `prompt.variables` and (if content changed) the version snapshot.
      const variablesJson = dto.variables !== undefined ? serializeVariables(dto.variables) : undefined
      if (variablesJson !== undefined) updates.variables = variablesJson

      const contentChanged = dto.content !== undefined && dto.content !== existing.content

      if (contentChanged) {
        const newVersion = existing.currentVersion + 1
        updates.currentVersion = newVersion

        await tx.insert(promptVersionTable).values({
          promptId: id,
          version: newVersion,
          content: dto.content!,
          rollbackFrom: null,
          // Snapshot inherits existing variables when the DTO does not override them.
          variables: variablesJson ?? existing.variables
        })

        logger.info('Created prompt version', { id, version: newVersion })
      } else if (variablesJson !== undefined) {
        await tx
          .update(promptVersionTable)
          .set({ variables: variablesJson })
          .where(and(eq(promptVersionTable.promptId, id), eq(promptVersionTable.version, existing.currentVersion)))
      }

      const [row] = await tx.update(promptTable).set(updates).where(eq(promptTable.id, id)).returning()

      logger.info('Updated prompt', { id, changes: Object.keys(dto) })
      return rowToPrompt(row)
    })
  }

  /** Move a single prompt relative to an anchor. */
  async reorder(id: string, anchor: OrderRequest): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.assertPromptsExist(tx, [id, ...collectAnchorIds([anchor])])
      await applyMoves(tx, promptTable, [{ id, anchor }], { pkColumn: promptTable.id })
    })
  }

  /** Apply a batch of moves atomically. */
  async reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    if (moves.length === 0) return
    await this.db.transaction(async (tx) => {
      await this.assertPromptsExist(tx, [...moves.map((m) => m.id), ...collectAnchorIds(moves.map((m) => m.anchor))])
      await applyMoves(tx, promptTable, moves, { pkColumn: promptTable.id })
    })
  }

  /** Pre-check that every id in a reorder exists; convert to NOT_FOUND otherwise. */
  // biome-ignore lint: tx is a transaction handle; structural typing over Drizzle's generic chain keeps this helper schema-agnostic.
  private async assertPromptsExist(tx: any, ids: string[]): Promise<void> {
    const uniqueIds = Array.from(new Set(ids))
    const rows = (await tx
      .select({ id: promptTable.id })
      .from(promptTable)
      .where(inArray(promptTable.id, uniqueIds))) as Array<{ id: string }>
    if (rows.length === uniqueIds.length) return
    const found = new Set(rows.map((r) => r.id))
    const missing = uniqueIds.find((id) => !found.has(id)) ?? uniqueIds[0]
    throw DataApiErrorFactory.notFound('Prompt', missing)
  }

  async delete(id: string): Promise<void> {
    const result = await this.db.delete(promptTable).where(eq(promptTable.id, id))
    if (result.rowsAffected === 0) {
      throw DataApiErrorFactory.notFound('Prompt', id)
    }
    logger.info('Deleted prompt', { id })
  }

  async getVersions(promptId: string): Promise<PromptVersion[]> {
    return this.db.transaction(async (tx) => {
      const [prompt] = await tx.select().from(promptTable).where(eq(promptTable.id, promptId)).limit(1)
      if (!prompt) {
        throw DataApiErrorFactory.notFound('Prompt', promptId)
      }

      const rows = await tx
        .select()
        .from(promptVersionTable)
        .where(eq(promptVersionTable.promptId, promptId))
        .orderBy(desc(promptVersionTable.version))

      return rows.map(rowToVersion)
    })
  }

  /**
   * Rollback to a previous version. Appends a new version whose snapshot
   * mirrors the target; prior `prompt_version` rows are never mutated.
   */
  async rollback(promptId: string, dto: RollbackPromptDto): Promise<Prompt> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(promptTable).where(eq(promptTable.id, promptId)).limit(1)
      if (!existing) {
        throw DataApiErrorFactory.notFound('Prompt', promptId)
      }

      const [targetVersion] = await tx
        .select()
        .from(promptVersionTable)
        .where(and(eq(promptVersionTable.promptId, promptId), eq(promptVersionTable.version, dto.version)))
        .limit(1)

      if (!targetVersion) {
        throw DataApiErrorFactory.notFound('PromptVersion', `${promptId}@v${dto.version}`)
      }

      const newVersion = existing.currentVersion + 1

      await tx.insert(promptVersionTable).values({
        promptId,
        version: newVersion,
        content: targetVersion.content,
        rollbackFrom: dto.version,
        variables: targetVersion.variables
      })

      const [row] = await tx
        .update(promptTable)
        .set({
          content: targetVersion.content,
          currentVersion: newVersion,
          variables: targetVersion.variables
        })
        .where(eq(promptTable.id, promptId))
        .returning()

      logger.info('Rolled back prompt', {
        id: promptId,
        fromVersion: existing.currentVersion,
        toVersion: dto.version,
        newVersion
      })

      return rowToPrompt(row)
    })
  }
}

export const promptService = new PromptService()
