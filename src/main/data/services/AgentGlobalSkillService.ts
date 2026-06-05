import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import {
  type AgentGlobalSkillRow,
  agentGlobalSkillTable,
  type InsertAgentGlobalSkillRow
} from '@data/db/schemas/agentGlobalSkill'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSkillTable } from '@data/db/schemas/agentSkill'
import { workspaceTable } from '@data/db/schemas/workspace'
import type { DbOrTx } from '@data/db/types'
import { agentService } from '@data/services/AgentService'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { DataApiErrorFactory } from '@shared/data/api'
import type { InstalledSkill, ListSkillsQuery } from '@shared/data/api/schemas/skills'
import { and, asc, eq, or, type SQL, sql } from 'drizzle-orm'

/**
 * DataApi service for the `agent_global_skill` and `agent_skill` join tables.
 *
 * Pure DB CRUD — no filesystem, HTTP, or symlink work. The workflow service
 * `services/skills/SkillService` builds on top of this for install /
 * uninstall / toggle, owning all FS-side effects.
 */
export class AgentGlobalSkillService {
  private get db() {
    return application.get('DbService').getDb()
  }

  async getById(id: string): Promise<InstalledSkill | null> {
    const rows = await this.db.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.id, id)).limit(1)
    if (!rows[0]) return null
    return this.rowToInstalledSkill(rows[0])
  }

  async getByFolderName(folderName: string): Promise<InstalledSkill | null> {
    const rows = await this.db
      .select()
      .from(agentGlobalSkillTable)
      .where(eq(agentGlobalSkillTable.folderName, folderName))
      .limit(1)
    if (!rows[0]) return null
    return this.rowToInstalledSkill(rows[0])
  }

  /**
   * List skills with optional search + per-agent `isEnabled` projection.
   *
   * When `query.agentId` is provided each row's `isEnabled` reflects the
   * `agent_skill` join state; otherwise it is forced to `false`.
   */
  async list(query: ListSkillsQuery = {}): Promise<InstalledSkill[]> {
    const conditions: SQL[] = []

    if (query.agentId) {
      const agent = await agentService.getAgent(query.agentId)
      if (!agent) throw DataApiErrorFactory.notFound('Agent', query.agentId)
    }

    if (query.search) {
      const pattern = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`
      const nameMatch = sql`${agentGlobalSkillTable.name} LIKE ${pattern} ESCAPE '\\'`
      const descMatch = sql`${agentGlobalSkillTable.description} LIKE ${pattern} ESCAPE '\\'`
      const searchClause = or(nameMatch, descMatch)
      if (searchClause) conditions.push(searchClause)
    }

    const rows =
      conditions.length > 0
        ? await this.db
            .select()
            .from(agentGlobalSkillTable)
            .where(and(...conditions))
            .orderBy(asc(agentGlobalSkillTable.createdAt))
        : await this.db.select().from(agentGlobalSkillTable).orderBy(asc(agentGlobalSkillTable.createdAt))
    const skills = rows.map((row) => this.rowToInstalledSkill(row))
    if (!query.agentId) {
      return skills.map((s) => ({ ...s, isEnabled: false }))
    }

    const enabledMap = await this.loadEnabledMap(query.agentId)
    return skills.map((s) => ({ ...s, isEnabled: enabledMap.get(s.id) ?? false }))
  }

  /** Every row from `agent_global_skill`, ordered by createdAt. Used to seed new agents with builtins. */
  async listAll(): Promise<InstalledSkill[]> {
    const rows = await this.db.select().from(agentGlobalSkillTable).orderBy(asc(agentGlobalSkillTable.createdAt))
    return rows.map((row) => this.rowToInstalledSkill(row))
  }

  async insert(values: InsertAgentGlobalSkillRow): Promise<AgentGlobalSkillRow> {
    return application.get('DbService').withWriteTx((tx) => this.insertTx(tx, values))
  }

  async insertTx(tx: DbOrTx, values: InsertAgentGlobalSkillRow): Promise<AgentGlobalSkillRow> {
    const [inserted] = await tx.insert(agentGlobalSkillTable).values(values).returning()
    if (!inserted) throw new Error(`Failed to insert agent_global_skill row: ${values.folderName}`)
    return inserted
  }

  async update(
    id: string,
    patch: Partial<Omit<InsertAgentGlobalSkillRow, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<void> {
    await application.get('DbService').withWriteTx((tx) => this.updateTx(tx, id, patch))
  }

  async updateTx(
    tx: DbOrTx,
    id: string,
    patch: Partial<Omit<InsertAgentGlobalSkillRow, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<void> {
    await tx.update(agentGlobalSkillTable).set(patch).where(eq(agentGlobalSkillTable.id, id))
  }

  /** Hard delete a global-skill row. FK cascades remove the agent_skill join rows. */
  async deleteById(id: string): Promise<void> {
    await application.get('DbService').withWriteTx((tx) => this.deleteByIdTx(tx, id))
  }

  async deleteByIdTx(tx: DbOrTx, id: string): Promise<void> {
    await tx.delete(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.id, id))
  }

  async listJoinByAgent(agentId: string): Promise<Array<{ skillId: string; isEnabled: boolean }>> {
    const rows = await this.db
      .select({ skillId: agentSkillTable.skillId, isEnabled: agentSkillTable.isEnabled })
      .from(agentSkillTable)
      .where(eq(agentSkillTable.agentId, agentId))
    return rows
  }

  async listJoinBySkill(skillId: string): Promise<Array<{ agentId: string; isEnabled: boolean }>> {
    const rows = await this.db
      .select({ agentId: agentSkillTable.agentId, isEnabled: agentSkillTable.isEnabled })
      .from(agentSkillTable)
      .where(eq(agentSkillTable.skillId, skillId))
    return rows
  }

  async upsertJoin(agentId: string, skillId: string, isEnabled: boolean): Promise<void> {
    await application.get('DbService').withWriteTx((tx) => this.upsertJoinTx(tx, agentId, skillId, isEnabled))
  }

  async upsertJoinTx(tx: DbOrTx, agentId: string, skillId: string, isEnabled: boolean): Promise<void> {
    await tx
      .insert(agentSkillTable)
      .values({ agentId, skillId, isEnabled })
      .onConflictDoUpdate({
        target: [agentSkillTable.agentId, agentSkillTable.skillId],
        set: { isEnabled }
      })
  }

  /** Upsert the join row for every agent in `agent`. Returns the affected agent ids. */
  async upsertJoinForAllAgents(skillId: string, isEnabled: boolean): Promise<string[]> {
    return application.get('DbService').withWriteTx((tx) => this.upsertJoinForAllAgentsTx(tx, skillId, isEnabled))
  }

  async upsertJoinForAllAgentsTx(tx: DbOrTx, skillId: string, isEnabled: boolean): Promise<string[]> {
    const agents = await tx.select({ id: agentTable.id }).from(agentTable)
    for (const agent of agents) {
      await this.upsertJoinTx(tx, agent.id, skillId, isEnabled)
    }
    return agents.map((a) => a.id)
  }

  /**
   * Distinct workspace paths from `agent_session` LEFT JOIN `workspace` for
   * the given agent. The result is DB-state-only — callers that need to
   * confirm the path is reachable on disk must layer their own filesystem
   * check on top.
   */
  async listAgentSessionWorkspacePaths(agentId: string): Promise<string[]> {
    const rows = await this.db
      .select({ workspacePath: workspaceTable.path })
      .from(agentSessionTable)
      .leftJoin(workspaceTable, eq(agentSessionTable.workspaceId, workspaceTable.id))
      .where(eq(agentSessionTable.agentId, agentId))
    const seen = new Set<string>()
    const paths: string[] = []
    for (const row of rows) {
      const p = row.workspacePath ?? undefined
      if (!p || seen.has(p)) continue
      seen.add(p)
      paths.push(p)
    }
    return paths
  }

  private async loadEnabledMap(agentId: string): Promise<Map<string, boolean>> {
    const rows = await this.listJoinByAgent(agentId)
    const map = new Map<string, boolean>()
    for (const row of rows) map.set(row.skillId, row.isEnabled)
    return map
  }

  private rowToInstalledSkill(row: AgentGlobalSkillRow): InstalledSkill {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      folderName: row.folderName,
      source: row.source,
      sourceUrl: row.sourceUrl,
      namespace: row.namespace,
      author: row.author,
      sourceTags: row.tags,
      contentHash: row.contentHash,
      isEnabled: row.isEnabled,
      createdAt: timestampToISO(row.createdAt),
      updatedAt: timestampToISO(row.updatedAt)
    }
  }
}

export const agentGlobalSkillService = new AgentGlobalSkillService()
