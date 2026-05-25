import { loggerService } from '@logger'
import { and, eq } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import { type AgentSkillRow, agentSkillsTable } from '../database/schema'

const logger = loggerService.withContext('AgentSkillRepository')

/**
 * Database repository for the `agent_skills` join table.
 *
 * Each row records whether a given skill is enabled for a given agent.
 * Only rows with `is_enabled = true` correspond to an actual symlink under
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
    return db.select().from(agentSkillsTable).where(eq(agentSkillsTable.agent_id, agentId))
  }

  async getBySkillId(skillId: string): Promise<AgentSkillRow[]> {
    const db = await this.getDatabase()
    return db.select().from(agentSkillsTable).where(eq(agentSkillsTable.skill_id, skillId))
  }

  async get(agentId: string, skillId: string): Promise<AgentSkillRow | null> {
    const db = await this.getDatabase()
    const rows = await db
      .select()
      .from(agentSkillsTable)
      .where(and(eq(agentSkillsTable.agent_id, agentId), eq(agentSkillsTable.skill_id, skillId)))
      .limit(1)
    return rows[0] ?? null
  }

  async upsert(agentId: string, skillId: string, isEnabled: boolean): Promise<void> {
    const db = await this.getDatabase()
    const now = Date.now()

    // SQLite upsert via ON CONFLICT on the composite primary key.
    await db
      .insert(agentSkillsTable)
      .values({
        agent_id: agentId,
        skill_id: skillId,
        is_enabled: isEnabled,
        created_at: now,
        updated_at: now
      })
      .onConflictDoUpdate({
        target: [agentSkillsTable.agent_id, agentSkillsTable.skill_id],
        set: { is_enabled: isEnabled, updated_at: now }
      })

    logger.info('Agent skill upserted', { agentId, skillId, isEnabled })
  }

  async delete(agentId: string, skillId: string): Promise<void> {
    const db = await this.getDatabase()
    await db
      .delete(agentSkillsTable)
      .where(and(eq(agentSkillsTable.agent_id, agentId), eq(agentSkillsTable.skill_id, skillId)))
  }

  async deleteByAgentId(agentId: string): Promise<void> {
    const db = await this.getDatabase()
    await db.delete(agentSkillsTable).where(eq(agentSkillsTable.agent_id, agentId))
  }

  async deleteBySkillId(skillId: string): Promise<void> {
    const db = await this.getDatabase()
    await db.delete(agentSkillsTable).where(eq(agentSkillsTable.skill_id, skillId))
  }
}
