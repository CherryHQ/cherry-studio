/**
 * Prompt Service - handles prompt CRUD and version management
 *
 * Provides business logic for:
 * - Prompt CRUD operations
 * - Automatic version creation on content changes
 * - Version history and rollback
 * - Template variable metadata (variables field)
 */

import { promptTable, promptVersionTable } from '@data/db/schemas/prompt'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreatePromptDto, RollbackPromptDto, UpdatePromptDto } from '@shared/data/api/schemas/prompts'
import type { Prompt, PromptVariable, PromptVersion } from '@shared/data/types/prompt'
import { PromptVariablesSchema } from '@shared/data/types/prompt'
import { and, desc, eq } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:PromptService')

/**
 * Safely parse a JSON variables string from DB.
 * Returns parsed array on success, null on failure (malformed JSON or invalid schema).
 */
function safeParseVariables(raw: string | null): PromptVariable[] | null {
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw)
    const result = PromptVariablesSchema.safeParse(parsed)
    if (result.success) return result.data
    logger.warn('Invalid variables JSON in DB, falling back to null', { error: result.error.message })
    return null
  } catch {
    logger.warn('Malformed variables JSON in DB, falling back to null')
    return null
  }
}

/**
 * Serialize variables to JSON string for DB storage.
 */
function serializeVariables(variables: PromptVariable[] | null | undefined): string | null {
  if (variables === null || variables === undefined) return null
  return JSON.stringify(variables)
}

/**
 * Convert database row to Prompt entity
 */
function rowToPrompt(row: typeof promptTable.$inferSelect): Prompt {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    currentVersion: row.currentVersion,
    sortOrder: row.sortOrder,
    variables: safeParseVariables(row.variables),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString()
  }
}

/**
 * Convert database row to PromptVersion entity
 */
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

class PromptService {
  /**
   * Get all prompts, ordered by sortOrder
   */
  async getAll(): Promise<Prompt[]> {
    const db = application.get('DbService').getDb()
    const rows = await db.select().from(promptTable).orderBy(promptTable.sortOrder)
    return rows.map(rowToPrompt)
  }

  /**
   * Get a prompt by ID
   */
  async getById(id: string): Promise<Prompt> {
    const db = application.get('DbService').getDb()
    const [row] = await db.select().from(promptTable).where(eq(promptTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Prompt', id)
    }

    return rowToPrompt(row)
  }

  /**
   * Create a new prompt with initial version
   */
  async create(dto: CreatePromptDto): Promise<Prompt> {
    const db = application.get('DbService').getDb()
    const variablesJson = serializeVariables(dto.variables ?? null)

    return db.transaction(async (tx) => {
      const [lastPrompt] = await tx
        .select({ sortOrder: promptTable.sortOrder })
        .from(promptTable)
        .orderBy(desc(promptTable.sortOrder))
        .limit(1)

      const nextSortOrder = (lastPrompt?.sortOrder ?? -1) + 1

      const [row] = await tx
        .insert(promptTable)
        .values({
          title: dto.title,
          content: dto.content,
          currentVersion: 1,
          sortOrder: nextSortOrder,
          variables: variablesJson
        })
        .returning()

      // Create v1 version snapshot
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
   * - Content change: creates a new version (snapshot includes current variables).
   * - Variables-only change: updates the current version snapshot in-place, no new version.
   */
  async update(id: string, dto: UpdatePromptDto): Promise<Prompt> {
    const db = application.get('DbService').getDb()

    return db.transaction(async (tx) => {
      // Read inside transaction to prevent race conditions on currentVersion
      const [existing] = await tx.select().from(promptTable).where(eq(promptTable.id, id)).limit(1)
      if (!existing) {
        throw DataApiErrorFactory.notFound('Prompt', id)
      }

      if (
        dto.title === undefined &&
        dto.content === undefined &&
        dto.sortOrder === undefined &&
        dto.variables === undefined
      ) {
        return rowToPrompt(existing)
      }

      const updates: Partial<typeof promptTable.$inferInsert> = {}
      if (dto.title !== undefined) updates.title = dto.title
      if (dto.content !== undefined) updates.content = dto.content
      if (dto.sortOrder !== undefined) updates.sortOrder = dto.sortOrder
      if (dto.variables !== undefined) updates.variables = serializeVariables(dto.variables)

      // Check if content changed — if so, create a new version
      const contentChanged = dto.content !== undefined && dto.content !== existing.content

      if (contentChanged) {
        const newVersion = existing.currentVersion + 1
        updates.currentVersion = newVersion

        // New version snapshot includes the latest variables
        const variablesJson = dto.variables !== undefined ? serializeVariables(dto.variables) : existing.variables

        await tx.insert(promptVersionTable).values({
          promptId: id,
          version: newVersion,
          content: dto.content!,
          rollbackFrom: null,
          variables: variablesJson
        })

        logger.info('Created prompt version', { id, version: newVersion })
      } else if (dto.variables !== undefined) {
        // Variables-only change: update the current version snapshot in-place
        await tx
          .update(promptVersionTable)
          .set({ variables: serializeVariables(dto.variables) })
          .where(and(eq(promptVersionTable.promptId, id), eq(promptVersionTable.version, existing.currentVersion)))
      }

      const [row] = await tx.update(promptTable).set(updates).where(eq(promptTable.id, id)).returning()

      logger.info('Updated prompt', { id, changes: Object.keys(dto) })

      return rowToPrompt(row)
    })
  }

  /**
   * Reorder prompts by updating sortOrder for each ID in the given order
   */
  async reorder(orderedIds: string[]): Promise<void> {
    const db = application.get('DbService').getDb()

    await db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.update(promptTable).set({ sortOrder: i }).where(eq(promptTable.id, orderedIds[i]))
      }
    })

    logger.info('Reordered prompts', { count: orderedIds.length })
  }

  /**
   * Delete a prompt (versions are cascade deleted)
   */
  async delete(id: string): Promise<void> {
    const db = application.get('DbService').getDb()

    const result = await db.delete(promptTable).where(eq(promptTable.id, id))

    if (result.rowsAffected === 0) {
      throw DataApiErrorFactory.notFound('Prompt', id)
    }

    logger.info('Deleted prompt', { id })
  }

  /**
   * Get version history for a prompt
   */
  async getVersions(promptId: string): Promise<PromptVersion[]> {
    const db = application.get('DbService').getDb()

    return db.transaction(async (tx) => {
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
   * Rollback to a previous version.
   * Creates a new version with the target version's content and variables.
   */
  async rollback(promptId: string, dto: RollbackPromptDto): Promise<Prompt> {
    const db = application.get('DbService').getDb()

    return db.transaction(async (tx) => {
      // Read inside transaction to prevent race conditions on currentVersion
      const [existing] = await tx.select().from(promptTable).where(eq(promptTable.id, promptId)).limit(1)
      if (!existing) {
        throw DataApiErrorFactory.notFound('Prompt', promptId)
      }

      // Find the target version
      const [targetVersion] = await tx
        .select()
        .from(promptVersionTable)
        .where(and(eq(promptVersionTable.promptId, promptId), eq(promptVersionTable.version, dto.version)))
        .limit(1)

      if (!targetVersion) {
        throw DataApiErrorFactory.notFound('PromptVersion', `${promptId}@v${dto.version}`)
      }

      // Create a new version with the target's content and variables
      const newVersion = existing.currentVersion + 1

      await tx.insert(promptVersionTable).values({
        promptId,
        version: newVersion,
        content: targetVersion.content,
        rollbackFrom: dto.version,
        variables: targetVersion.variables
      })

      // Update prompt to the rolled-back content and variables
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
