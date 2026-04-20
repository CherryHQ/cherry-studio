import { loggerService } from '@logger'
import type { InstalledSkill } from '@types'
import { eq } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import { type InsertSkillRow, type SkillRow, skillsTable } from '../database/schema'

const logger = loggerService.withContext('SkillRepository')

/**
 * Database repository for the global `skills` table.
 *
 * All DB access for skills goes through this class.
 * Extends BaseService to reuse DatabaseManager access.
 */
export class SkillRepository extends BaseService {
  private static instance: SkillRepository | null = null

  static getInstance(): SkillRepository {
    if (!SkillRepository.instance) {
      SkillRepository.instance = new SkillRepository()
    }
    return SkillRepository.instance
  }

  async list(): Promise<InstalledSkill[]> {
    const db = await this.getDatabase()
    const rows = await db.select().from(skillsTable)
    return rows.map(this.rowToInstalledSkill)
  }

  async getById(id: string): Promise<InstalledSkill | null> {
    const db = await this.getDatabase()
    const rows = await db.select().from(skillsTable).where(eq(skillsTable.id, id)).limit(1)
    return rows[0] ? this.rowToInstalledSkill(rows[0]) : null
  }

  async getByFolderName(folderName: string): Promise<InstalledSkill | null> {
    const db = await this.getDatabase()
    const rows = await db.select().from(skillsTable).where(eq(skillsTable.folder_name, folderName)).limit(1)
    return rows[0] ? this.rowToInstalledSkill(rows[0]) : null
  }

  async insert(row: InsertSkillRow): Promise<InstalledSkill> {
    const db = await this.getDatabase()
    await db.insert(skillsTable).values(row)

    const inserted = await db.select().from(skillsTable).where(eq(skillsTable.id, row.id!)).limit(1)
    if (!inserted[0]) {
      throw new Error(`Failed to insert skill: ${row.name}`)
    }

    logger.info('Skill inserted', { id: row.id, name: row.name })
    return this.rowToInstalledSkill(inserted[0])
  }

  async toggleEnabled(id: string, isEnabled: boolean): Promise<InstalledSkill | null> {
    const db = await this.getDatabase()
    await db.update(skillsTable).set({ is_enabled: isEnabled }).where(eq(skillsTable.id, id))

    const updated = await db.select().from(skillsTable).where(eq(skillsTable.id, id)).limit(1)
    if (!updated[0]) {
      return null
    }

    logger.info('Skill toggled', { id, isEnabled })
    return this.rowToInstalledSkill(updated[0])
  }

  async updateMetadata(
    id: string,
    data: { name: string; description: string | null; author: string | null; tags: string | null; content_hash: string }
  ): Promise<void> {
    const db = await this.getDatabase()
    await db
      .update(skillsTable)
      .set({ ...data, updated_at: Date.now() })
      .where(eq(skillsTable.id, id))
    logger.info('Skill metadata updated', { id, name: data.name })
  }

  async delete(id: string): Promise<boolean> {
    const db = await this.getDatabase()
    const result = await db.delete(skillsTable).where(eq(skillsTable.id, id))
    const deleted = (result as { rowsAffected?: number }).rowsAffected !== 0
    if (deleted) {
      logger.info('Skill deleted', { id })
    }
    return deleted
  }

  private rowToInstalledSkill(row: SkillRow): InstalledSkill {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      folderName: row.folder_name,
      source: row.source,
      sourceUrl: row.source_url,
      namespace: row.namespace,
      author: row.author,
      tags: row.tags ? JSON.parse(row.tags) : [],
      contentHash: row.content_hash,
      isEnabled: row.is_enabled,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}
