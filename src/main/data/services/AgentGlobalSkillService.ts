import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import {
  type AgentGlobalSkillRow,
  agentGlobalSkillTable,
  type InsertAgentGlobalSkillRow
} from '@data/db/schemas/agentGlobalSkill'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSkillTable } from '@data/db/schemas/agentSkill'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import type { DbOrTx } from '@data/db/types'
import { agentService } from '@data/services/AgentService'
import { registerDataService } from '@data/services/dataServiceRegistry'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { DataApiErrorFactory } from '@shared/data/api/errors'
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

  getById(id: string): InstalledSkill | null {
    const rows = this.db.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.id, id)).limit(1).all()
    if (!rows[0]) return null
    return this.rowToInstalledSkill(rows[0])
  }

  getByFolderName(folderName: string): InstalledSkill | null {
    const rows = this.db
      .select()
      .from(agentGlobalSkillTable)
      .where(eq(agentGlobalSkillTable.folderName, folderName))
      .limit(1)
      .all()
    if (!rows[0]) return null
    return this.rowToInstalledSkill(rows[0])
  }

  /**
   * List skills with optional search + per-agent `isEnabled` projection.
   *
   * When `query.agentId` is provided each row's `isEnabled` reflects the
   * `agent_skill` join state; otherwise it is forced to `false`.
   */
  list(query: ListSkillsQuery = {}): InstalledSkill[] {
    const conditions: SQL[] = []

    if (query.agentId) {
      const agent = agentService.getAgent(query.agentId)
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
        ? this.db
            .select()
            .from(agentGlobalSkillTable)
            .where(and(...conditions))
            .orderBy(asc(agentGlobalSkillTable.createdAt))
            .all()
        : this.db.select().from(agentGlobalSkillTable).orderBy(asc(agentGlobalSkillTable.createdAt)).all()
    const skills = rows.map((row) => this.rowToInstalledSkill(row))
    if (!query.agentId) {
      return skills.map((s) => ({ ...s, isEnabled: false }))
    }

    const enabledMap = this.loadEnabledMap(query.agentId)
    return skills.map((s) => ({ ...s, isEnabled: enabledMap.get(s.id) ?? false }))
  }

  /** Every row from `agent_global_skill`, ordered by createdAt. Used to seed new agents with builtins. */
  listAll(): InstalledSkill[] {
    const rows = this.db.select().from(agentGlobalSkillTable).orderBy(asc(agentGlobalSkillTable.createdAt)).all()
    return rows.map((row) => this.rowToInstalledSkill(row))
  }

  insert(values: InsertAgentGlobalSkillRow): AgentGlobalSkillRow {
    return this.insertTx(application.get('DbService').getDb(), values)
  }

  insertTx(tx: DbOrTx, values: InsertAgentGlobalSkillRow): AgentGlobalSkillRow {
    const [inserted] = tx.insert(agentGlobalSkillTable).values(values).returning().all()
    if (!inserted) throw new Error(`Failed to insert agent_global_skill row: ${values.folderName}`)
    return inserted
  }

  update(id: string, patch: Partial<Omit<InsertAgentGlobalSkillRow, 'id' | 'createdAt' | 'updatedAt'>>): void {
    this.updateTx(application.get('DbService').getDb(), id, patch)
  }

  updateTx(
    tx: DbOrTx,
    id: string,
    patch: Partial<Omit<InsertAgentGlobalSkillRow, 'id' | 'createdAt' | 'updatedAt'>>
  ): void {
    tx.update(agentGlobalSkillTable).set(patch).where(eq(agentGlobalSkillTable.id, id)).run()
  }

  /** Hard delete a global-skill row. FK cascades remove the agent_skill join rows. */
  deleteById(id: string): void {
    this.deleteByIdTx(application.get('DbService').getDb(), id)
  }

  deleteByIdTx(tx: DbOrTx, id: string): void {
    tx.delete(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.id, id)).run()
  }

  listJoinByAgent(agentId: string): Array<{ skillId: string; isEnabled: boolean }> {
    const rows = this.db
      .select({ skillId: agentSkillTable.skillId, isEnabled: agentSkillTable.isEnabled })
      .from(agentSkillTable)
      .where(eq(agentSkillTable.agentId, agentId))
      .all()
    return rows
  }

  listJoinBySkill(skillId: string): Array<{ agentId: string; isEnabled: boolean }> {
    const rows = this.db
      .select({ agentId: agentSkillTable.agentId, isEnabled: agentSkillTable.isEnabled })
      .from(agentSkillTable)
      .where(eq(agentSkillTable.skillId, skillId))
      .all()
    return rows
  }

  upsertJoin(agentId: string, skillId: string, isEnabled: boolean): void {
    this.upsertJoinTx(application.get('DbService').getDb(), agentId, skillId, isEnabled)
  }

  upsertJoinTx(tx: DbOrTx, agentId: string, skillId: string, isEnabled: boolean): void {
    tx.insert(agentSkillTable)
      .values({ agentId, skillId, isEnabled })
      .onConflictDoUpdate({
        target: [agentSkillTable.agentId, agentSkillTable.skillId],
        set: { isEnabled }
      })
      .run()
  }

  /** Upsert the join row for every agent in `agent`. Returns the affected agent ids. */
  upsertJoinForAllAgents(skillId: string, isEnabled: boolean): string[] {
    return application.get('DbService').withWriteTx((tx) => this.upsertJoinForAllAgentsTx(tx, skillId, isEnabled))
  }

  upsertJoinForAllAgentsTx(tx: DbOrTx, skillId: string, isEnabled: boolean): string[] {
    const agents = tx.select({ id: agentTable.id }).from(agentTable).all()
    for (const agent of agents) {
      this.upsertJoinTx(tx, agent.id, skillId, isEnabled)
    }
    return agents.map((a) => a.id)
  }

  /**
   * Distinct workspace paths from `agent_session` LEFT JOIN `workspace` for
   * the given agent. The result is DB-state-only — callers that need to
   * confirm the path is reachable on disk must layer their own filesystem
   * check on top.
   */
  listAgentSessionWorkspacePaths(agentId: string): string[] {
    const rows = this.db
      .select({ workspacePath: agentWorkspaceTable.path })
      .from(agentSessionTable)
      .leftJoin(agentWorkspaceTable, eq(agentSessionTable.workspaceId, agentWorkspaceTable.id))
      .where(eq(agentSessionTable.agentId, agentId))
      .all()
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

  private loadEnabledMap(agentId: string): Map<string, boolean> {
    const rows = this.listJoinByAgent(agentId)
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

// Self-register so AgentService (which would otherwise form an import cycle via the
// create-time skill validation/join) can resolve this sibling lazily through the registry.
registerDataService('AgentGlobalSkillService', agentGlobalSkillService)
