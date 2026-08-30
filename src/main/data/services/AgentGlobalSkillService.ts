import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
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
import type { AgentSkillUpdateDto } from '@shared/data/api/schemas/agents'
import {
  type InstalledSkill,
  type ListSkillsQuery,
  SKILL_LIST_MEMBERSHIP_DIMENSIONS
} from '@shared/data/api/schemas/skills'
import type { SkillSearchSource } from '@shared/types/skill'
import { and, asc, eq, inArray, or, type SQL, sql } from 'drizzle-orm'

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
    return this.getByIdTx(this.db, id)
  }

  getByIdTx(tx: DbOrTx, id: string): InstalledSkill | null {
    const rows = tx.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.id, id)).limit(1).all()
    if (!rows[0]) return null
    return this.rowToInstalledSkill(rows[0])
  }

  getByIdWithProvenance(id: string): {
    skill: InstalledSkill
    installSource: string | null
    upstreamHash: string | null
  } | null {
    return this.getByIdWithProvenanceTx(this.db, id)
  }

  getByIdWithProvenanceTx(
    tx: DbOrTx,
    id: string
  ): { skill: InstalledSkill; installSource: string | null; upstreamHash: string | null } | null {
    const row = tx.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.id, id)).limit(1).get()
    if (!row) return null
    return {
      skill: this.rowToInstalledSkill(row),
      installSource: row.installSource,
      upstreamHash: row.upstreamHash
    }
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
   * Without an agent, every installed skill is returned for the global
   * settings catalog and `isEnabled` is false. With `query.agentId`, globally
   * disabled skills are excluded from the Agent capability catalog; remaining
   * rows project the `agent_skill` preference (with builtins enabled by default).
   */
  list(query: ListSkillsQuery = {}): InstalledSkill[] {
    const conditions: SQL[] = []

    if (query.agentId) {
      const agent = agentService.getAgent(query.agentId)
      if (!agent) throw DataApiErrorFactory.notFound('Agent', query.agentId)
      conditions.push(eq(agentGlobalSkillTable.isEnabled, true))
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
    if (!query.agentId) return skills

    const enabledMap = this.loadEnabledMap(query.agentId)
    return skills.map((s) => ({
      ...s,
      isEnabled: enabledMap.get(s.id) ?? s.source === 'builtin'
    }))
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
    const [inserted] = tx
      .insert(agentGlobalSkillTable)
      .values({ isEnabled: true, ...values })
      .returning()
      .all()
    if (!inserted) throw new Error(`Failed to insert agent_global_skill row: ${values.folderName}`)
    return inserted
  }

  update(id: string, patch: Partial<Omit<InsertAgentGlobalSkillRow, 'id' | 'createdAt' | 'updatedAt'>>): void {
    this.updateTx(application.get('DbService').getDb(), id, patch)
  }

  updateGlobalEnabled(id: string, isGlobalEnabled: boolean): InstalledSkill | null {
    const [updated] = this.db
      .update(agentGlobalSkillTable)
      .set({ isEnabled: isGlobalEnabled })
      .where(eq(agentGlobalSkillTable.id, id))
      .returning()
      .all()
    if (!updated) return null

    notifyDataApiDataChange([
      { endpoint: '/skills', kind: 'projection', entityIds: [id] },
      {
        endpoint: '/skills',
        kind: 'membership',
        dimension: SKILL_LIST_MEMBERSHIP_DIMENSIONS.AGENT_ID,
        entityIds: [id]
      },
      { endpoint: '/skills/:skillId', entityIds: [id] }
    ])
    return this.rowToInstalledSkill(updated)
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

  /** Publish the agent-scoped Skill projection only after its caller-owned transaction commits. */
  notifyAgentSkillChange(skillId: string): void {
    notifyDataApiDataChange([
      {
        endpoint: '/skills',
        kind: 'membership',
        dimension: SKILL_LIST_MEMBERSHIP_DIMENSIONS.AGENT_ID,
        entityIds: [skillId]
      }
    ])
  }

  notifySkillProjectionChange(skillId: string): void {
    notifyDataApiDataChange([
      { endpoint: '/skills', kind: 'projection', entityIds: [skillId] },
      { endpoint: '/skills/:skillId', entityIds: [skillId] }
    ])
  }

  notifySkillMembershipChange(skillId: string): void {
    notifyDataApiDataChange([
      { endpoint: '/skills', kind: 'membership', entityIds: [skillId] },
      {
        endpoint: '/skills',
        kind: 'membership',
        dimension: SKILL_LIST_MEMBERSHIP_DIMENSIONS.AGENT_ID,
        entityIds: [skillId]
      },
      { endpoint: '/skills/:skillId', entityIds: [skillId] }
    ])
  }

  /**
   * Assert every id in `skillIds` still exists in `agent_global_skill` within the
   * caller's write tx. Callers pre-validate the same ids outside the tx to surface
   * a precise `Skill` not-found error; this in-tx recheck closes the
   * delete-after-prevalidation race. `operation` labels the resulting error (e.g.
   * 'create agent', 'update agent'). Dedupes internally so the count comparison
   * holds even if the caller passes duplicates.
   */
  assertSkillsExistTx(tx: DbOrTx, skillIds: readonly string[], operation: string): void {
    const uniqueSkillIds = Array.from(new Set(skillIds))
    if (uniqueSkillIds.length === 0) return

    const rows = tx
      .select({ id: agentGlobalSkillTable.id })
      .from(agentGlobalSkillTable)
      .where(inArray(agentGlobalSkillTable.id, uniqueSkillIds))
      .all()
    if (rows.length !== uniqueSkillIds.length) {
      throw DataApiErrorFactory.invalidOperation(operation, 'a selected skill no longer exists')
    }
  }

  applyJoinUpdatesByAgentTx(tx: DbOrTx, agentId: string, skillUpdates: readonly AgentSkillUpdateDto[]): void {
    const bySkillId = new Map<string, AgentSkillUpdateDto>()
    for (const update of skillUpdates) bySkillId.set(update.skillId, update)

    const uniqueUpdates = Array.from(bySkillId.values())
    this.assertSkillsExistTx(
      tx,
      uniqueUpdates.map((update) => update.skillId),
      'update agent'
    )

    for (const update of uniqueUpdates) {
      this.upsertJoinTx(tx, agentId, update.skillId, update.isEnabled)
    }
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
    const sourceRegistry = this.getSourceRegistry(row.installSource)
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      folderName: row.folderName,
      source: row.source,
      sourceUrl: row.sourceUrl,
      namespace: row.namespace,
      author: row.author,
      version: row.version,
      sourceTags: row.tags,
      contentHash: row.contentHash,
      sourceRegistry,
      canUpdateFromRemote:
        row.source === 'marketplace' &&
        sourceRegistry !== null &&
        row.installSource !== null &&
        row.upstreamHash !== null,
      isGlobalEnabled: row.isEnabled,
      isEnabled: false,
      createdAt: timestampToISO(row.createdAt),
      updatedAt: timestampToISO(row.updatedAt)
    }
  }

  private getSourceRegistry(installSource: string | null): SkillSearchSource | null {
    const prefix = installSource?.split(':', 1)[0]
    switch (prefix) {
      case 'claude-plugins':
        return 'claude-plugins.dev'
      case 'skills.sh':
        return 'skills.sh'
      case 'clawhub':
        return 'clawhub.ai'
      case 'github':
        return 'github'
      default:
        return null
    }
  }
}

export const agentGlobalSkillService = new AgentGlobalSkillService()

// Self-register so AgentService (which would otherwise form an import cycle via the
// create-time skill validation/join) can resolve this sibling lazily through the registry.
registerDataService('AgentGlobalSkillService', agentGlobalSkillService)
