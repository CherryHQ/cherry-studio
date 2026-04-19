import { loggerService } from '@logger'
import { and, eq } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import { type AgentSkillRow, agentSkillsTable } from '../database/schema'

const logger = loggerService.withContext('AgentSkillRepository')

/**
 * Database repository for the `agent_skill` join table.
 *
 * Each row records whether a given skill is enabled for a given agent.
 * Only rows with `isEnabled = true` correspond to an actual symlink under
 * the agent's workspace `.claude/skills/` directory.
 */
export class AgentSkillRepository extends BaseService {
  private static instance: AgentSkillRepository | null = null

  static getInstance(): AgentSkillRepository {
    if (!AgentSkillRepository.instance) {
      AgentSkillRepository.instance = new AgentSkillRepository()
    }
    return AgentSkillRepository.instance
  }

  async getByAgentId(agentId: string): Promise<AgentSkillRow[]> {
    const db = await this.getDatabase()
    return db.select().from(agentSkillsTable).where(eq(agentSkillsTable.agentId, agentId))
  }

  async getBySkillId(skillId: string): Promise<AgentSkillRow[]> {
    const db = await this.getDatabase()
    return db.select().from(agentSkillsTable).where(eq(agentSkillsTable.skillId, skillId))
  }

  async get(agentId: string, skillId: string): Promise<AgentSkillRow | null> {
    const db = await this.getDatabase()
    const rows = await db
      .select()
      .from(agentSkillsTable)
      .where(and(eq(agentSkillsTable.agentId, agentId), eq(agentSkillsTable.skillId, skillId)))
      .limit(1)
    return rows[0] ?? null
  }

  async upsert(agentId: string, skillId: string, isEnabled: boolean): Promise<void> {
    const db = await this.getDatabase()

    await db
      .insert(agentSkillsTable)
      .values({ agentId, skillId, isEnabled })
      .onConflictDoUpdate({
        target: [agentSkillsTable.agentId, agentSkillsTable.skillId],
        set: { isEnabled }
      })

    logger.info('Agent skill upserted', { agentId, skillId, isEnabled })
  }

  async delete(agentId: string, skillId: string): Promise<void> {
    const db = await this.getDatabase()
    await db
      .delete(agentSkillsTable)
      .where(and(eq(agentSkillsTable.agentId, agentId), eq(agentSkillsTable.skillId, skillId)))
  }

  async deleteByAgentId(agentId: string): Promise<void> {
    const db = await this.getDatabase()
    await db.delete(agentSkillsTable).where(eq(agentSkillsTable.agentId, agentId))
  }

  async deleteBySkillId(skillId: string): Promise<void> {
    const db = await this.getDatabase()
    await db.delete(agentSkillsTable).where(eq(agentSkillsTable.skillId, skillId))
  }
}
