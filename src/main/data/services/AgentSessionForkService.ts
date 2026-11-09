import { and, eq, inArray, sql } from 'drizzle-orm'
import { alias, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentRuntimeBackendTable } from '@data/db/schemas/agentRuntimeBackend'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import {
  agentSessionContextTable,
  type AgentSessionCheckpoints,
  type AgentSessionContextRow
} from '@data/db/schemas/agentSessionContext'
import { type AgentSessionMessageRow, agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import type { DbOrTx } from '@data/db/types'
import type { UniqueModelId } from '@shared/data/types/model'

import { agentSessionContextService } from './AgentSessionContextService'
import { agentSessionMessageService } from './AgentSessionMessageService'
import { agentSessionPathIds, ensureAgentSessionRootTx } from './agentSessionMessageTree'
import { agentSessionService } from './AgentSessionService'

export class AgentSessionForkSourceError extends Error {
  constructor(readonly reason: 'source_missing' | 'source_changed') {
    super(reason)
    this.name = 'AgentSessionForkSourceError'
  }
}

export class AgentSessionForkService {
  readBindingsTx(tx: DbOrTx, sessionId: string, messageId: string) {
    return tx
      .select({
        id: agentSessionContextTable.id,
        backendId: agentSessionContextTable.backendId,
        locator: agentRuntimeBackendTable.locator,
        nativeThreadId: agentSessionContextTable.nativeThreadId,
        anchorMessageId: agentSessionContextTable.anchorMessageId,
        forkMapping: sql<
          AgentSessionCheckpoints['fork'] | null
        >`json_quote(json_extract(${agentSessionContextTable.checkpointMapping}, '$.fork'))`.mapWith(
          (value: string): AgentSessionCheckpoints['fork'] | null => JSON.parse(value)
        )
      })
      .from(agentSessionContextTable)
      .innerJoin(agentRuntimeBackendTable, eq(agentRuntimeBackendTable.id, agentSessionContextTable.backendId))
      .where(
        and(
          eq(agentSessionContextTable.sessionId, sessionId),
          inArray(agentSessionContextTable.anchorMessageId, agentSessionPathIds(sessionId, messageId))
        )
      )
      .orderBy(agentSessionContextTable.id)
      .all()
  }

  readHistoryBoundaries(sessionId: string, messageIds: readonly string[]) {
    if (!messageIds.length) return []
    const parent = alias(agentSessionMessageTable, 'parent')
    const anchor = (data: AnySQLiteColumn) =>
      sql<unknown>`json_quote(json_extract(${data}, '$.runtimeAnchor'))`.mapWith((value: string): unknown =>
        JSON.parse(value)
      )
    return application
      .get('DbService')
      .getDb()
      .select({
        id: agentSessionMessageTable.id,
        role: agentSessionMessageTable.role,
        status: agentSessionMessageTable.status,
        delivery: agentSessionMessageTable.delivery,
        anchor: anchor(agentSessionMessageTable.data),
        parent: { id: parent.id, role: parent.role, status: parent.status, anchor: anchor(parent.data) }
      })
      .from(agentSessionMessageTable)
      .leftJoin(parent, and(eq(parent.sessionId, sessionId), eq(parent.id, agentSessionMessageTable.parentId)))
      .where(and(eq(agentSessionMessageTable.sessionId, sessionId), inArray(agentSessionMessageTable.id, messageIds)))
      .all()
  }

  private readTx(tx: DbOrTx, sourceSessionId: string, messageId: string, excludedIds: readonly string[]) {
    const source = tx
      .select({ session: agentSessionTable, workspace: agentWorkspaceTable, agent: agentTable })
      .from(agentSessionTable)
      .innerJoin(agentWorkspaceTable, eq(agentWorkspaceTable.id, agentSessionTable.workspaceId))
      .innerJoin(agentTable, eq(agentTable.id, agentSessionTable.agentId))
      .where(eq(agentSessionTable.id, sourceSessionId))
      .get()
    if (!source || source.session.deletedAt || source.agent.deletedAt)
      throw new AgentSessionForkSourceError('source_missing')
    const messages = agentSessionMessageService.readForkPrefixTx(tx, sourceSessionId, messageId, excludedIds)
    if (!messages) throw new AgentSessionForkSourceError('source_missing')
    return { ...source, messages, contexts: this.readBindingsTx(tx, sourceSessionId, messageId) }
  }

  read(sourceSessionId: string, messageId: string, excludedIds: readonly string[] = []) {
    return application
      .get('DbService')
      .getDb()
      .transaction((tx) => this.readTx(tx, sourceSessionId, messageId, excludedIds))
  }

  hasPublishedSession(sessionId: string): boolean {
    return Boolean(
      application
        .get('DbService')
        .getDb()
        .select({ id: agentSessionTable.id })
        .from(agentSessionTable)
        .where(eq(agentSessionTable.id, sessionId))
        .get()
    )
  }

  commitTx(
    tx: DbOrTx,
    input: {
      targetSessionId: string
      createdAt: number
      source: ReturnType<AgentSessionForkService['read']>
      excludedIds: readonly string[]
      messageId: string
      messages: AgentSessionMessageRow[]
      contexts: Array<Pick<AgentSessionContextRow, 'backendId' | 'anchorMessageId'> & { nativeThreadId: string }>
    }
  ): void {
    const { source } = input
    const current = this.readTx(tx, source.session.id, input.messageId, input.excludedIds)
    // Appending after the boundary is allowed. Changes to the chosen prefix, Agent, cwd or model are not.
    if (
      current.agent.type !== source.agent.type ||
      current.agent.id !== source.agent.id ||
      current.workspace.id !== source.workspace.id ||
      current.workspace.path !== source.workspace.path ||
      current.session.model !== source.session.model ||
      JSON.stringify(current.messages) !== JSON.stringify(source.messages) ||
      JSON.stringify(current.contexts) !== JSON.stringify(source.contexts)
    )
      throw new AgentSessionForkSourceError('source_changed')
    // Allocate the suffix in the publishing transaction so concurrent forks cannot claim the same name.
    const names = new Set(
      tx
        .select({ name: agentSessionTable.name })
        .from(agentSessionTable)
        .where(eq(agentSessionTable.agentId, current.agent.id))
        .all()
        .map((row) => row.name)
    )
    const suffixPattern = /^(.*?)(\s*)\((\d+)\)$/s
    const suffix = current.session.name.match(suffixPattern)
    const baseName = suffix ? suffix[1] : current.session.name
    const separator = suffix ? suffix[2] : ' '
    let number = 1n
    for (const name of names) {
      const existing = name.match(suffixPattern)
      if (existing?.[1] === baseName) {
        const next = BigInt(existing[3]) + 1n
        if (next > number) number = next
      }
    }
    agentSessionService.createTx(
      tx,
      input.targetSessionId,
      {
        agentId: source.agent.id,
        name: `${baseName}${separator}(${number})`,
        description: source.session.description,
        model: (source.session.model ?? undefined) as UniqueModelId | undefined,
        workspace:
          source.workspace.type === 'system' ? { type: 'system' } : { type: 'user', workspaceId: source.workspace.id }
      },
      'conversation',
      input.createdAt
    )
    agentSessionMessageService.insertForkMessagesTx(tx, input.targetSessionId, input.messages)
    for (const binding of input.contexts) {
      const anchor = binding.anchorMessageId ?? ensureAgentSessionRootTx(tx, input.targetSessionId)
      const context = agentSessionContextService.reserveBranchTx(tx, {
        sessionId: input.targetSessionId,
        backendId: binding.backendId,
        nativeThreadId: binding.nativeThreadId,
        anchorMessageId: anchor
      })
      agentSessionContextService.confirmBranchTx(tx, context.id, input.targetSessionId, anchor, binding.nativeThreadId)
    }
  }
}

export const agentSessionForkService = new AgentSessionForkService()
