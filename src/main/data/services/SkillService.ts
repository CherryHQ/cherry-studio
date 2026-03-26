/**
 * Skill Service - handles skill registry CRUD and version tracking
 *
 * Provides business logic for:
 * - Skill registration and lookup
 * - Enable/disable toggle
 * - Version history (diff-based)
 */

import { skillTable, skillVersionTable } from '@data/db/schemas/skill'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateSkillDto, UpdateSkillDto } from '@shared/data/api/schemas/skills'
import type { Skill, SkillVersion } from '@shared/data/types/skill'
import { desc, eq } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:SkillService')

function rowToSkill(row: typeof skillTable.$inferSelect): Skill {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    author: row.author,
    version: row.version,
    tags: row.tags,
    tools: row.tools,
    source: row.source,
    sourcePath: row.sourcePath,
    packageName: row.packageName,
    packageVersion: row.packageVersion,
    marketplaceId: row.marketplaceId,
    contentHash: row.contentHash,
    size: row.size,
    isEnabled: row.isEnabled ?? true,
    versionDirPath: row.versionDirPath,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
  }
}

function rowToSkillVersion(row: typeof skillVersionTable.$inferSelect): SkillVersion {
  return {
    id: row.id,
    skillId: row.skillId,
    version: row.version,
    contentHash: row.contentHash,
    diffPath: row.diffPath,
    message: row.message,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
  }
}

export class SkillService {
  /**
   * List all registered skills
   */
  async list(): Promise<Skill[]> {
    const db = application.get('DbService').getDb()
    const rows = await db.select().from(skillTable)
    return rows.map(rowToSkill)
  }

  /**
   * Get a skill by ID
   */
  async getById(id: string): Promise<Skill> {
    const db = application.get('DbService').getDb()
    const [row] = await db.select().from(skillTable).where(eq(skillTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Skill', id)
    }

    return rowToSkill(row)
  }

  /**
   * Register a new skill
   */
  async create(dto: CreateSkillDto): Promise<Skill> {
    const db = application.get('DbService').getDb()

    const [row] = await db
      .insert(skillTable)
      .values({
        name: dto.name,
        slug: dto.slug,
        description: dto.description,
        author: dto.author,
        version: dto.version,
        tags: dto.tags,
        tools: dto.tools,
        source: dto.source,
        sourcePath: dto.sourcePath,
        packageName: dto.packageName,
        packageVersion: dto.packageVersion,
        marketplaceId: dto.marketplaceId,
        contentHash: dto.contentHash,
        size: dto.size
      })
      .returning()

    logger.info('Registered skill', { id: row.id, slug: dto.slug, source: dto.source })

    return rowToSkill(row)
  }

  /**
   * Update a skill
   */
  async update(id: string, dto: UpdateSkillDto): Promise<Skill> {
    const db = application.get('DbService').getDb()

    await this.getById(id)

    const updates: Partial<typeof skillTable.$inferInsert> = {}

    if (dto.name !== undefined) updates.name = dto.name
    if (dto.description !== undefined) updates.description = dto.description
    if (dto.author !== undefined) updates.author = dto.author
    if (dto.version !== undefined) updates.version = dto.version
    if (dto.tags !== undefined) updates.tags = dto.tags
    if (dto.tools !== undefined) updates.tools = dto.tools
    if (dto.sourcePath !== undefined) updates.sourcePath = dto.sourcePath
    if (dto.packageName !== undefined) updates.packageName = dto.packageName
    if (dto.packageVersion !== undefined) updates.packageVersion = dto.packageVersion
    if (dto.marketplaceId !== undefined) updates.marketplaceId = dto.marketplaceId
    if (dto.contentHash !== undefined) updates.contentHash = dto.contentHash
    if (dto.size !== undefined) updates.size = dto.size
    if (dto.isEnabled !== undefined) updates.isEnabled = dto.isEnabled
    if (dto.versionDirPath !== undefined) updates.versionDirPath = dto.versionDirPath

    const [row] = await db.update(skillTable).set(updates).where(eq(skillTable.id, id)).returning()

    logger.info('Updated skill', { id, changes: Object.keys(dto) })

    return rowToSkill(row)
  }

  /**
   * Unregister a skill and its version history
   */
  async delete(id: string): Promise<void> {
    const db = application.get('DbService').getDb()

    await this.getById(id)

    // Versions are cascade-deleted via foreign key
    await db.delete(skillTable).where(eq(skillTable.id, id))

    logger.info('Unregistered skill', { id })
  }

  /**
   * Enable a skill
   */
  async enable(id: string): Promise<Skill> {
    return this.update(id, { isEnabled: true })
  }

  /**
   * Disable a skill
   */
  async disable(id: string): Promise<Skill> {
    return this.update(id, { isEnabled: false })
  }

  /**
   * List version history for a skill, newest first
   */
  async listVersions(skillId: string): Promise<SkillVersion[]> {
    const db = application.get('DbService').getDb()

    await this.getById(skillId)

    const rows = await db
      .select()
      .from(skillVersionTable)
      .where(eq(skillVersionTable.skillId, skillId))
      .orderBy(desc(skillVersionTable.createdAt))

    return rows.map(rowToSkillVersion)
  }
}

export const skillService = new SkillService()
