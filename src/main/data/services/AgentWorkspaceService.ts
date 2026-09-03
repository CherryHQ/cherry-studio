import { application } from '@application'
import { agentSessionTable as sessionsTable } from '@data/db/schemas/agentSession'
import { type AgentWorkspaceRow, agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { agentChannelService } from '@data/services/AgentChannelService'
import { getDataService } from '@data/services/dataServiceRegistry'
import { applyMoves, insertWithOrderKey } from '@data/services/utils/orderKey'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { isFilesystemRoot } from '@main/utils/file'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import {
  AGENT_WORKSPACE_TYPE,
  type AgentWorkspaceEntity,
  type AgentWorkspaceReferenceItem,
  type AgentWorkspaceReferenceList,
  type AgentWorkspaceReferences,
  AgentWorkspaceTypeSchema,
  type UpdateAgentWorkspaceDto
} from '@shared/data/api/schemas/agentWorkspaces'
import { and, asc, count, desc, eq } from 'drizzle-orm'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

type AgentWorkspaceLookupOptions = { includeSystem?: boolean }
export type FindOrCreateAgentWorkspaceResult = { workspace: AgentWorkspaceEntity; created: boolean }
const AGENT_WORKSPACE_REFERENCE_PREVIEW_LIMIT = 21

function buildReferenceList(items: AgentWorkspaceReferenceItem[], total = items.length): AgentWorkspaceReferenceList {
  return { items: items.slice(0, AGENT_WORKSPACE_REFERENCE_PREVIEW_LIMIT), total }
}

export function rowToAgentWorkspace(row: AgentWorkspaceRow): AgentWorkspaceEntity {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    type: AgentWorkspaceTypeSchema.parse(row.type),
    orderKey: row.orderKey,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

function defaultWorkspaceName(workspacePath: string): string {
  return path.basename(workspacePath) || workspacePath
}

function normalizeWorkspaceName(rawName: string): string {
  const trimmed = rawName.trim()
  if (!trimmed) {
    throw DataApiErrorFactory.validation({ name: ['Workspace name is required'] })
  }
  return trimmed
}

export class AgentWorkspaceService {
  buildSystemWorkspacePath(systemWorkspacesRoot: string, sessionId: string, createdAt: number): string {
    if (!sessionId || sessionId === '.' || sessionId === '..' || /[\\/]/.test(sessionId)) {
      throw new Error(`Invalid agent session id for system workspace: ${sessionId}`)
    }
    const date = new Date(createdAt)
    const year = String(date.getUTCFullYear()).padStart(4, '0')
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    const day = String(date.getUTCDate()).padStart(2, '0')
    return path.join(systemWorkspacesRoot, `${year}-${month}-${day}`, sessionId)
  }

  private normalizeWorkspacePath(rawPath: string): string {
    const trimmed = rawPath.trim()
    if (!trimmed) {
      throw DataApiErrorFactory.validation({ path: ['Workspace path is required'] })
    }
    if (!path.isAbsolute(trimmed)) {
      throw DataApiErrorFactory.validation({ path: ['Workspace path must be absolute'] })
    }
    if (isFilesystemRoot(trimmed)) {
      throw DataApiErrorFactory.validation({ path: ['Filesystem roots cannot be used as Agent workspaces'] })
    }
    const normalized = path.normalize(trimmed)
    const root = path.parse(normalized).root
    let end = normalized.length
    while (end > root.length && /[\\/]/.test(normalized[end - 1])) end -= 1
    return normalized.slice(0, end)
  }

  list(options: AgentWorkspaceLookupOptions = {}): AgentWorkspaceEntity[] {
    const db = application.get('DbService').getDb()
    const rows = db
      .select()
      .from(agentWorkspaceTable)
      .where(options.includeSystem ? undefined : eq(agentWorkspaceTable.type, AGENT_WORKSPACE_TYPE.USER))
      .orderBy(asc(agentWorkspaceTable.orderKey), asc(agentWorkspaceTable.id))
      .all()
    return rows.map(rowToAgentWorkspace)
  }

  getById(id: string, options: AgentWorkspaceLookupOptions = {}): AgentWorkspaceEntity {
    const db = application.get('DbService').getDb()
    const row = this.getRowByIdTx(db, id, options)
    return rowToAgentWorkspace(row)
  }

  getByIdTx(tx: DbOrTx, id: string, options: AgentWorkspaceLookupOptions = {}): AgentWorkspaceEntity {
    const row = this.getRowByIdTx(tx, id, options)
    return rowToAgentWorkspace(row)
  }

  getRowByIdTx(tx: DbOrTx, id: string, options: AgentWorkspaceLookupOptions = {}): AgentWorkspaceRow {
    const predicate = options.includeSystem
      ? eq(agentWorkspaceTable.id, id)
      : and(eq(agentWorkspaceTable.id, id), eq(agentWorkspaceTable.type, AGENT_WORKSPACE_TYPE.USER))
    const [row] = tx.select().from(agentWorkspaceTable).where(predicate).limit(1).all()
    if (!row) throw DataApiErrorFactory.notFound('Workspace', id)
    return row
  }

  getReferences(id: string): AgentWorkspaceReferences {
    const db = application.get('DbService').getDb()
    this.getRowByIdTx(db, id)

    const [{ total: sessionTotal }] = db
      .select({ total: count() })
      .from(sessionsTable)
      .where(eq(sessionsTable.workspaceId, id))
      .all()
    const sessions = db
      .select({ id: sessionsTable.id, name: sessionsTable.name })
      .from(sessionsTable)
      .where(eq(sessionsTable.workspaceId, id))
      .orderBy(desc(sessionsTable.lastActivityAt), asc(sessionsTable.id))
      .limit(AGENT_WORKSPACE_REFERENCE_PREVIEW_LIMIT)
      .all()
    const channels = agentChannelService.listWorkspaceReferencesTx(db, id)
    const tasks = getDataService('AgentTaskService').listWorkspaceReferencesTx(db, id)

    return {
      sessions: buildReferenceList(sessions, sessionTotal),
      channels: buildReferenceList(channels),
      tasks: buildReferenceList(tasks)
    }
  }

  findOrCreateByPath(rawPath: string, options: { name?: string } = {}): AgentWorkspaceEntity {
    return this.findOrCreateByPathResult(rawPath, options).workspace
  }

  findOrCreateByPathResult(rawPath: string, options: { name?: string } = {}): FindOrCreateAgentWorkspaceResult {
    const workspacePath = this.normalizeWorkspacePath(rawPath)
    const result = withSqliteErrors(
      () =>
        application
          .get('DbService')
          .withWriteTx((tx) => this.findOrCreateRowByNormalizedPathTx(tx, workspacePath, options)),
      {
        ...defaultHandlersFor('Workspace', workspacePath),
        unique: () => DataApiErrorFactory.conflict(`Workspace path '${workspacePath}' already exists`, 'Workspace')
      }
    )
    return { workspace: rowToAgentWorkspace(result.row), created: result.created }
  }

  findOrCreateByPathTx(tx: DbOrTx, rawPath: string, options: { name?: string } = {}): AgentWorkspaceEntity {
    const workspacePath = this.normalizeWorkspacePath(rawPath)
    const result = withSqliteErrors(() => this.findOrCreateRowByNormalizedPathTx(tx, workspacePath, options), {
      ...defaultHandlersFor('Workspace', workspacePath),
      unique: () => DataApiErrorFactory.conflict(`Workspace path '${workspacePath}' already exists`, 'Workspace')
    })
    return rowToAgentWorkspace(result.row)
  }

  private findOrCreateRowByNormalizedPathTx(
    tx: DbOrTx,
    workspacePath: string,
    options: { name?: string } = {}
  ): { row: AgentWorkspaceRow; created: boolean } {
    const [existing] = tx
      .select()
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.path, workspacePath))
      .limit(1)
      .all()
    if (existing) {
      // Idempotent find branch: POST/find-or-create never renames an existing workspace.
      // Callers that want to rename must use PATCH /agent-workspaces/:workspaceId.
      if (AgentWorkspaceTypeSchema.parse(existing.type) === AGENT_WORKSPACE_TYPE.USER) {
        return { row: existing, created: false }
      }
      throw DataApiErrorFactory.conflict(`Workspace path '${workspacePath}' already exists`, 'Workspace')
    }

    const id = uuidv4()
    const name = options.name?.trim() || defaultWorkspaceName(workspacePath)
    const row = insertWithOrderKey(
      tx,
      agentWorkspaceTable,
      { id, name, path: workspacePath, type: AGENT_WORKSPACE_TYPE.USER },
      { pkColumn: agentWorkspaceTable.id, position: 'first' }
    ) as AgentWorkspaceRow
    return { row, created: true }
  }

  createSystemWorkspaceForSessionTx(tx: DbOrTx, input: { sessionId: string; createdAt: number }): AgentWorkspaceEntity {
    const workspacePath = this.normalizeWorkspacePath(
      this.buildSystemWorkspacePath(
        application.getPath('feature.agents.system_workspaces'),
        input.sessionId,
        input.createdAt
      )
    )
    const row = withSqliteErrors(
      () =>
        insertWithOrderKey(
          tx,
          agentWorkspaceTable,
          {
            id: uuidv4(),
            name: defaultWorkspaceName(workspacePath),
            path: workspacePath,
            type: AGENT_WORKSPACE_TYPE.SYSTEM
          },
          { pkColumn: agentWorkspaceTable.id, position: 'first' }
        ) as AgentWorkspaceRow,
      {
        ...defaultHandlersFor('Workspace', workspacePath),
        unique: () =>
          DataApiErrorFactory.conflict(`System workspace already exists for session ${input.sessionId}`, 'Workspace')
      }
    )
    return rowToAgentWorkspace(row)
  }

  update(id: string, dto: UpdateAgentWorkspaceDto): AgentWorkspaceEntity {
    const row = withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx((tx) => {
          this.getRowByIdTx(tx, id)
          const [updated] = tx
            .update(agentWorkspaceTable)
            .set({ name: normalizeWorkspaceName(dto.name) })
            .where(and(eq(agentWorkspaceTable.id, id), eq(agentWorkspaceTable.type, AGENT_WORKSPACE_TYPE.USER)))
            .returning()
            .all()
          return updated
        }),
      defaultHandlersFor('Workspace', id)
    )
    if (!row) throw DataApiErrorFactory.notFound('Workspace', id)
    return rowToAgentWorkspace(row)
  }

  deleteByIdTx(tx: DbOrTx, id: string): void {
    const [row] = tx
      .delete(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.id, id))
      .returning({ id: agentWorkspaceTable.id })
      .all()
    if (!row) throw DataApiErrorFactory.notFound('Workspace', id)
  }

  reorder(id: string, anchor: OrderRequest): void {
    application.get('DbService').withWriteTx((tx) => this.reorderTx(tx, id, anchor))
  }

  reorderTx(tx: DbOrTx, id: string, anchor: OrderRequest): void {
    this.assertUserWorkspaceExistsTx(tx, id)
    this.assertUserAnchorExistsTx(tx, anchor)
    applyMoves(tx, agentWorkspaceTable, [{ id, anchor }], { pkColumn: agentWorkspaceTable.id })
  }

  reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): void {
    if (moves.length === 0) return
    application.get('DbService').withWriteTx((tx) => this.reorderBatchTx(tx, moves))
  }

  reorderBatchTx(tx: DbOrTx, moves: Array<{ id: string; anchor: OrderRequest }>): void {
    for (const move of moves) {
      this.assertUserWorkspaceExistsTx(tx, move.id)
      this.assertUserAnchorExistsTx(tx, move.anchor)
    }
    applyMoves(tx, agentWorkspaceTable, moves, { pkColumn: agentWorkspaceTable.id })
  }

  private assertUserWorkspaceExistsTx(tx: DbOrTx, id: string): void {
    const [target] = tx
      .select({ id: agentWorkspaceTable.id })
      .from(agentWorkspaceTable)
      .where(and(eq(agentWorkspaceTable.id, id), eq(agentWorkspaceTable.type, AGENT_WORKSPACE_TYPE.USER)))
      .limit(1)
      .all()
    if (!target) throw DataApiErrorFactory.notFound('Workspace', id)
  }

  private assertUserAnchorExistsTx(tx: DbOrTx, anchor: OrderRequest): void {
    const anchorId = 'before' in anchor ? anchor.before : 'after' in anchor ? anchor.after : undefined
    if (!anchorId) return
    this.assertUserWorkspaceExistsTx(tx, anchorId)
  }
}

export const agentWorkspaceService = new AgentWorkspaceService()
