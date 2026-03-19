/**
 * Prompt Service - handles prompt CRUD and version management
 *
 * Provides business logic for:
 * - Prompt CRUD operations
 * - Automatic version creation on content changes
 * - Version history and rollback
 */

import { dbService } from '@data/db/DbService'
import { assistantPromptTable } from '@data/db/schemas/assistantPrompt'
import { promptTable, promptVersionTable } from '@data/db/schemas/prompt'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type {
  CreatePromptDto,
  ReorderPromptsDto,
  RollbackPromptDto,
  UpdatePromptDto
} from '@shared/data/api/schemas/prompts'
import type { Prompt, PromptVersion } from '@shared/data/types/prompt'
import { and, desc, eq, notExists } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:PromptService')

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
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
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
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString()
  }
}

export class PromptService {
  private static instance: PromptService

  private constructor() {}

  public static getInstance(): PromptService {
    if (!PromptService.instance) {
      PromptService.instance = new PromptService()
    }
    return PromptService.instance
  }

  /**
   * Get all prompts, ordered by sortOrder
   */
  async getAll(): Promise<Prompt[]> {
    const db = dbService.getDb()
    const rows = await db.select().from(promptTable).orderBy(promptTable.sortOrder)
    return rows.map(rowToPrompt)
  }

  /**
   * Get all global prompts (not associated with any assistant)
   */
  async getGlobal(): Promise<Prompt[]> {
    const db = dbService.getDb()
    const rows = await db
      .select()
      .from(promptTable)
      .where(notExists(db.select().from(assistantPromptTable).where(eq(assistantPromptTable.promptId, promptTable.id))))
      .orderBy(promptTable.sortOrder)
    return rows.map(rowToPrompt)
  }

  /**
   * Get all prompts for a specific assistant
   */
  async getForAssistant(assistantId: string): Promise<Prompt[]> {
    const db = dbService.getDb()
    const rows = await db
      .select({
        id: promptTable.id,
        title: promptTable.title,
        content: promptTable.content,
        currentVersion: promptTable.currentVersion,
        sortOrder: assistantPromptTable.sortOrder,
        createdAt: promptTable.createdAt,
        updatedAt: promptTable.updatedAt
      })
      .from(promptTable)
      .innerJoin(assistantPromptTable, eq(promptTable.id, assistantPromptTable.promptId))
      .where(eq(assistantPromptTable.assistantId, assistantId))
      .orderBy(assistantPromptTable.sortOrder)

    return rows.map(rowToPrompt)
  }

  /**
   * Get a prompt by ID
   */
  async getById(id: string): Promise<Prompt> {
    const db = dbService.getDb()
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
    const db = dbService.getDb()

    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(promptTable)
        .values({
          title: dto.title,
          content: dto.content,
          currentVersion: 1
        })
        .returning()

      // Create v1 version snapshot
      await tx.insert(promptVersionTable).values({
        promptId: row.id,
        version: 1,
        content: dto.content
      })

      // If associated with an assistant, create mapping
      if (dto.assistantId) {
        await tx.insert(assistantPromptTable).values({
          assistantId: dto.assistantId,
          promptId: row.id
        })
      }

      logger.info('Created prompt', { id: row.id, title: dto.title, assistantId: dto.assistantId })

      return rowToPrompt(row)
    })
  }

  /**
   * Update a prompt. Auto-creates a new version if content changed.
   */
  async update(id: string, dto: UpdatePromptDto): Promise<Prompt> {
    const db = dbService.getDb()

    return db.transaction(async (tx) => {
      // Read inside transaction to prevent race conditions on currentVersion
      const [existing] = await tx.select().from(promptTable).where(eq(promptTable.id, id)).limit(1)
      if (!existing) {
        throw DataApiErrorFactory.notFound('Prompt', id)
      }

      const updates: Partial<typeof promptTable.$inferInsert> = {}
      if (dto.title !== undefined) updates.title = dto.title
      if (dto.content !== undefined) updates.content = dto.content

      // Check if content changed — if so, create a new version
      const contentChanged = dto.content !== undefined && dto.content !== existing.content

      if (contentChanged) {
        const newVersion = existing.currentVersion + 1
        updates.currentVersion = newVersion

        await tx.insert(promptVersionTable).values({
          promptId: id,
          version: newVersion,
          content: dto.content!
        })

        logger.info('Created prompt version', { id, version: newVersion })
      }

      const [row] = await tx.update(promptTable).set(updates).where(eq(promptTable.id, id)).returning()

      logger.info('Updated prompt', { id, changes: Object.keys(dto) })

      return rowToPrompt(row)
    })
  }

  /**
   * Delete a prompt (versions are cascade deleted)
   */
  async delete(id: string): Promise<void> {
    const db = dbService.getDb()

    await this.getById(id) // verify exists

    await db.delete(promptTable).where(eq(promptTable.id, id))

    logger.info('Deleted prompt', { id })
  }

  /**
   * Batch update sort order
   */
  async reorder(dto: ReorderPromptsDto): Promise<void> {
    const db = dbService.getDb()

    await db.transaction(async (tx) => {
      for (const item of dto.items) {
        if (dto.assistantId) {
          await tx
            .update(assistantPromptTable)
            .set({ sortOrder: item.sortOrder })
            .where(
              and(eq(assistantPromptTable.assistantId, dto.assistantId), eq(assistantPromptTable.promptId, item.id))
            )
        } else {
          await tx.update(promptTable).set({ sortOrder: item.sortOrder }).where(eq(promptTable.id, item.id))
        }
      }
    })

    logger.info('Reordered prompts', { count: dto.items.length, assistantId: dto.assistantId })
  }

  /**
   * Get version history for a prompt
   */
  async getVersions(promptId: string): Promise<PromptVersion[]> {
    const db = dbService.getDb()

    await this.getById(promptId) // verify exists

    const rows = await db
      .select()
      .from(promptVersionTable)
      .where(eq(promptVersionTable.promptId, promptId))
      .orderBy(desc(promptVersionTable.version))

    return rows.map(rowToVersion)
  }

  /**
   * Rollback to a previous version.
   * Creates a new version with the target version's content.
   */
  async rollback(promptId: string, dto: RollbackPromptDto): Promise<Prompt> {
    const db = dbService.getDb()

    return db.transaction(async (tx) => {
      // Read inside transaction to prevent race conditions on currentVersion
      const [existing] = await tx.select().from(promptTable).where(eq(promptTable.id, promptId)).limit(1)
      if (!existing) {
        throw DataApiErrorFactory.notFound('Prompt', promptId)
      }

      // Find the target version
      const versions = await tx.select().from(promptVersionTable).where(eq(promptVersionTable.promptId, promptId))

      const targetVersion = versions.find((v) => v.version === dto.version)
      if (!targetVersion) {
        throw DataApiErrorFactory.notFound('PromptVersion', `${promptId}@v${dto.version}`)
      }

      // Create a new version with the target's content
      const newVersion = existing.currentVersion + 1

      await tx.insert(promptVersionTable).values({
        promptId,
        version: newVersion,
        content: targetVersion.content
      })

      // Update prompt to the rolled-back content
      const [row] = await tx
        .update(promptTable)
        .set({
          content: targetVersion.content,
          currentVersion: newVersion
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

export const promptService = PromptService.getInstance()
