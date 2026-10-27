/**
 * MCP Server Service - handles MCP server CRUD operations
 *
 * Provides business logic for:
 * - MCP server CRUD operations
 * - Listing with optional filters (isActive, type)
 */

import { and, asc, eq, inArray, type SQL, sql } from 'drizzle-orm'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentMcpServerTable } from '@data/db/schemas/assistantRelations'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { agentService } from '@data/services/AgentService'
import { mountedServerToolNames } from '@data/services/utils/mcpToolCatalogCache'
import { loggerService } from '@logger'
import { CHERRY_MCP_SERVER } from '@main/utils/agentMcpIdentities'
import {
  migrateAgentDisabledToolsForServerRename,
  migrateDisabledToolsForServerRename,
  sanitizeAgentServerKey
} from '@shared/ai/tools/mcpToolName'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { CreateMcpServerDto, ListMcpServersQuery, UpdateMcpServerDto } from '@shared/data/api/schemas/mcpServers'
import type { McpServer } from '@shared/data/types/mcpServer'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'

import { nullsToUndefined, timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:McpServerService')

/**
 * Convert database row to McpServer entity
 */
function rowToMcpServer(row: typeof mcpServerTable.$inferSelect): McpServer {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    type: clean.type as McpServer['type'],
    installSource: clean.installSource as McpServer['installSource'],
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export class McpServerService {
  private get db() {
    return application.get('DbService').getDb()
  }

  /**
   * Get an MCP server by ID
   */
  getById(id: string): McpServer {
    const [row] = this.db.select().from(mcpServerTable).where(eq(mcpServerTable.id, id)).limit(1).all()

    if (!row) {
      throw DataApiErrorFactory.notFound('McpServer', id)
    }

    return rowToMcpServer(row)
  }

  /**
   * List MCP servers with optional filters
   */
  list(query: ListMcpServersQuery): { items: McpServer[]; total: number; page: number } {
    const conditions: SQL[] = []
    if (query.id !== undefined) {
      conditions.push(eq(mcpServerTable.id, query.id))
    }
    if (query.isActive !== undefined) {
      conditions.push(eq(mcpServerTable.isActive, query.isActive))
    }
    if (query.type !== undefined) {
      conditions.push(eq(mcpServerTable.type, query.type))
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const rows = this.db.select().from(mcpServerTable).where(whereClause).orderBy(asc(mcpServerTable.sortOrder)).all()
    const [{ count }] = this.db
      .select({ count: sql<number>`count(*)` })
      .from(mcpServerTable)
      .where(whereClause)
      .all()

    return {
      items: rows.map(rowToMcpServer),
      total: count,
      page: 1
    }
  }

  /**
   * Create a new MCP server
   */
  create(dto: CreateMcpServerDto): McpServer {
    this.validateName(dto.name)
    this.validateQVerisConfiguration({ name: dto.name, env: dto.env, isActive: dto.isActive ?? false })

    const { sortOrder, isActive, ...rest } = dto

    const [row] = this.db
      .insert(mcpServerTable)
      .values({
        ...rest,
        sortOrder: sortOrder ?? 0,
        isActive: isActive ?? false
      })
      .returning()
      .all()

    logger.info('Created MCP server', { id: row.id, name: row.name })

    return rowToMcpServer(row)
  }

  createMany(dtos: CreateMcpServerDto[]): McpServer[] {
    const created = application.get('DbService').withWriteTx((tx) => {
      const names = new Set<string>()
      for (const dto of dtos) {
        this.validateName(dto.name)
        this.validateQVerisConfiguration({ name: dto.name, env: dto.env, isActive: dto.isActive ?? false })
        if (names.has(dto.name)) {
          throw DataApiErrorFactory.conflict(`MCP server '${dto.name}' already exists`, 'McpServer')
        }
        names.add(dto.name)
      }

      const existing = tx
        .select({ name: mcpServerTable.name })
        .from(mcpServerTable)
        .where(inArray(mcpServerTable.name, [...names]))
        .get()
      if (existing) {
        throw DataApiErrorFactory.conflict(`MCP server '${existing.name}' already exists`, 'McpServer')
      }

      return dtos.map(({ sortOrder, isActive, ...rest }) => {
        const [row] = tx
          .insert(mcpServerTable)
          .values({
            ...rest,
            sortOrder: sortOrder ?? 0,
            isActive: isActive ?? false
          })
          .returning()
          .all()
        return row
      })
    })

    logger.info('Created MCP servers', { count: created.length })
    return created.map(rowToMcpServer)
  }

  /**
   * Update an existing MCP server
   */
  update(id: string, dto: UpdateMcpServerDto): McpServer {
    // Agents whose mounted-server rules moved with the rename, for the post-commit
    // onAgentUpdated refresh consumed by warm agent sessions.
    const policyAffectedAgentIds: string[] = []
    const result = application.get('DbService').withWriteTx((tx) => {
      const [existingRow] = tx.select().from(mcpServerTable).where(eq(mcpServerTable.id, id)).limit(1).all()
      if (!existingRow) {
        throw DataApiErrorFactory.notFound('McpServer', id)
      }

      const existing = rowToMcpServer(existingRow)
      const name = dto.name ?? existing.name
      const env = dto.env ?? existing.env
      const isActive = dto.isActive ?? existing.isActive

      this.validateName(name)
      this.validateQVerisConfiguration({ name, env, isActive })

      const updates = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as Partial<
        typeof mcpServerTable.$inferInsert
      >

      // A rename reallocates the server's runtime record key, orphaning saved
      // `mcp__<old-key>__<tool>` denial rules: the exact-match policy would let the previously
      // disabled tool execute under the new identity. Migrate the server's own rules and every
      // mounting agent's in the same transaction. A PATCH that submits `disabledTools` alongside
      // the rename owns the list — the submitted value (including an explicit empty list) must
      // win over migrating the stored rules.
      if (dto.name !== undefined && dto.name !== existing.name) {
        if (dto.disabledTools === undefined) {
          const migratedServerRules = migrateDisabledToolsForServerRename(
            existing.disabledTools ?? [],
            existing.name,
            name
          )
          if (migratedServerRules) updates.disabledTools = migratedServerRules
        }

        // Only agents that mount the renamed server carry its denial rules. Duplicate names are
        // accepted, so a blanket name match would steal a rule owned by a different server —
        // including one still exposing the tool the rule was written for.
        const mountedBy = tx
          .select({ agentId: agentMcpServerTable.agentId })
          .from(agentMcpServerTable)
          .where(eq(agentMcpServerTable.mcpServerId, id))
          .all()
        const mountedAgentIds = new Set(mountedBy.map(({ agentId }) => agentId))
        const agents = mountedAgentIds.size > 0 ? tx.select().from(agentTable).all() : []
        for (const agent of agents) {
          if (!mountedAgentIds.has(agent.id)) continue
          // Pre-rename mount list with configured names: allocation order decides who owns a
          // duplicated name, mirroring resolveMountedAgentMcpServers. Ties break by mcpServerId
          // — the same total order the runtime readers apply, since rows replaced in one
          // statement can share a createdAt millisecond. The browser stays out of the
          // allocation candidates (the runtime never registers it), but its id joins the
          // reservations: the runtime reserves every mounted id BEFORE skipping the browser,
          // so a configured name equal to the browser's id falls back to the server's own id
          // there, and this allocation must predict the same key.
          const mountedServers = tx
            .select({ mcpServerId: agentMcpServerTable.mcpServerId })
            .from(agentMcpServerTable)
            .where(eq(agentMcpServerTable.agentId, agent.id))
            .orderBy(asc(agentMcpServerTable.createdAt), asc(agentMcpServerTable.mcpServerId))
            .all()
            .flatMap(({ mcpServerId }): { mcpId: string; name?: string; browser?: boolean } => {
              const [mountedRow] = tx
                .select({ name: mcpServerTable.name, type: mcpServerTable.type })
                .from(mcpServerTable)
                .where(eq(mcpServerTable.id, mcpServerId))
                .limit(1)
                .all()
              // The runtime never mounts the in-memory browser (agentMcpServers skips it), so
              // it must not claim an allocation key here either — counting it displaces a
              // server NAMED after its folded segment onto a UUID the runtime never registers.
              if (mountedRow && mountedRow.type === 'inMemory' && mountedRow.name === BuiltinMcpServerNames.browser)
                return { mcpId: mcpServerId, name: mountedRow.name, browser: true }
              return mountedRow ? { mcpId: mcpServerId, name: mountedRow.name } : { mcpId: mcpServerId }
            })
          const migrated = migrateAgentDisabledToolsForServerRename(agent.disabledTools ?? [], {
            mountedServers: mountedServers.flatMap(({ browser, ...ref }) => (browser ? [] : [ref])),
            renamedServerId: id,
            toName: name,
            reservedKeys: [
              ...Object.values(CHERRY_MCP_SERVER),
              ...mountedServers.map(({ mcpId }) => sanitizeAgentServerKey(mcpId))
            ],
            // Raw tool spellings let the migration resolve Pi's camelized saved denials onto
            // the identities that keep the raw tool fragment.
            toolNamesByServerId: mountedServerToolNames(mountedServers.map(({ mcpId }) => mcpId))
          })
          if (migrated) {
            agentService.updateDisabledToolsTx(tx, agent.id, migrated)
            policyAffectedAgentIds.push(agent.id)
            logger.info('Migrated disabled tool rules for renamed MCP server', {
              agentId: agent.id,
              from: existing.name,
              to: name
            })
          }
        }
      }

      const [row] = tx.update(mcpServerTable).set(updates).where(eq(mcpServerTable.id, id)).returning().all()
      return rowToMcpServer(row)
    })

    // Agent-level policy writes go through the owning service (`updateDisabledToolsTx`); the
    // live-policy refresh fires after commit (best-effort, like delete()), so warm sessions
    // re-read the migrated rules instead of reconciling against a stale agent row. A failure
    // must not reject the committed update.
    try {
      agentService.emitAgentUpdatedForIds(policyAffectedAgentIds, 'mcps')
    } catch (error) {
      logger.error('MCP server renamed but agent refresh failed; affected agents may retain stale tool policy', {
        mcpServerId: id,
        affectedAgentIds: policyAffectedAgentIds,
        error
      })
    }

    logger.info('Updated MCP server', { id, changes: Object.keys(dto) })

    return result
  }

  /**
   * Find an MCP server by ID or name. Returns undefined if not found.
   */
  findByIdOrName(idOrName: string): McpServer | undefined {
    const [row] = this.db.select().from(mcpServerTable).where(eq(mcpServerTable.id, idOrName)).limit(1).all()

    if (row) return rowToMcpServer(row)

    const [byName] = this.db.select().from(mcpServerTable).where(eq(mcpServerTable.name, idOrName)).limit(1).all()

    return byName ? rowToMcpServer(byName) : undefined
  }

  /**
   * Delete an MCP server and cascade-remove its associations from all agents.
   * Junction table rows are explicitly removed first so we can identify affected
   * agents for event emission; FK ON DELETE CASCADE is a safety net.
   */
  delete(id: string): void {
    this.getById(id)

    let affectedAgentIds: string[] = []
    application.get('DbService').withWriteTx((tx) => {
      // Removing the server releases its record key: a same-named sibling (or a later mount)
      // inherits it, so the departing server's name-keyed denial rules must move onto its
      // stable id BEFORE the associations go — the same allocation migration the mount-update
      // path applies, in the same transaction.
      const migratedAgentIds = agentService.migrateDisabledToolsForMcpServerRemovalTx(tx, id)
      if (migratedAgentIds.length > 0) {
        logger.info('Migrated disabled tool rules for deleted MCP server', {
          mcpServerId: id,
          agentIds: migratedAgentIds
        })
      }
      affectedAgentIds = agentService.removeMcpFromAllAgentsTx(tx, id)
      tx.delete(mcpServerTable).where(eq(mcpServerTable.id, id)).run()
    })

    // The delete has already committed. `emitAgentUpdatedForIds` runs a
    // best-effort post-commit refresh (fresh reads) whose failure must NOT
    // reject delete() — the server row is already gone. Log the un-refreshed
    // agents so warm sessions can be reconciled, then swallow.
    try {
      agentService.emitAgentUpdatedForIds(affectedAgentIds, 'mcps')
    } catch (error) {
      logger.error('MCP server deleted but agent refresh failed; affected agents may retain stale tool policy', {
        mcpServerId: id,
        affectedAgentIds,
        error
      })
    }

    logger.info('Deleted MCP server', { id })
  }

  /**
   * Reorder MCP servers by updating sortOrder based on ordered IDs
   */
  reorder(orderedIds: string[]): void {
    this.db.transaction((tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        tx.update(mcpServerTable).set({ sortOrder: i }).where(eq(mcpServerTable.id, orderedIds[i])).run()
      }
    })

    logger.info('Reordered MCP servers', { count: orderedIds.length })
  }

  private validateName(name: string): void {
    if (!name?.trim()) {
      throw DataApiErrorFactory.validation({ name: ['Name is required'] })
    }
  }

  private validateQVerisConfiguration(server: Pick<McpServer, 'name' | 'env' | 'isActive'>): void {
    if (server.name === BuiltinMcpServerNames.qveris && server.isActive && !server.env?.QVERIS_API_KEY?.trim()) {
      throw DataApiErrorFactory.validation({ env: ['QVERIS_API_KEY is required when QVeris is enabled'] })
    }
  }
}

export const mcpServerService = new McpServerService()
