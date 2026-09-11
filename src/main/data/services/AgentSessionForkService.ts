import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import type { AgentSessionMessageRow } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { appStateTable } from '@data/db/schemas/appState'
import type { DbOrTx } from '@data/db/types'
import { eq, like } from 'drizzle-orm'

import { agentSessionForkContextService } from './AgentSessionForkContextService'
import { agentSessionMessageService } from './AgentSessionMessageService'
import { agentSessionService } from './AgentSessionService'

export interface AgentSessionForkJournal {
  version: 1
  operationId: string
  sourceSessionId: string
  messageId: string
  targetSessionId: string
  createdAt: number
  artifactDirectory: string
  artifactIdentity?: string
  workspace?: string
  workspaceIdentity?: string
  published: Array<{ source: string; target: string; identity?: string }>
  committed: boolean
}

export class AgentSessionForkService {
  private readTx(tx: DbOrTx, sourceSessionId: string, messageId: string, excludedIds: readonly string[]) {
    const source = tx
      .select({ session: agentSessionTable, workspace: agentWorkspaceTable, agent: agentTable })
      .from(agentSessionTable)
      .innerJoin(agentWorkspaceTable, eq(agentWorkspaceTable.id, agentSessionTable.workspaceId))
      .innerJoin(agentTable, eq(agentTable.id, agentSessionTable.agentId))
      .where(eq(agentSessionTable.id, sourceSessionId))
      .get()
    if (!source || source.agent.deletedAt) throw new Error('history_missing')
    const messages = agentSessionMessageService.readForkPrefixTx(tx, sourceSessionId, messageId, excludedIds)
    return { ...source, messages }
  }

  read(sourceSessionId: string, messageId: string, excludedIds: readonly string[] = []) {
    return application
      .get('DbService')
      .getDb()
      .transaction((tx) => this.readTx(tx, sourceSessionId, messageId, excludedIds))
  }

  writeJournal(journal: AgentSessionForkJournal, tx: DbOrTx = application.get('DbService').getDb()): void {
    tx.insert(appStateTable)
      .values({ key: 'agent-session-fork:' + journal.operationId, value: journal })
      .onConflictDoUpdate({ target: appStateTable.key, set: { value: journal, updatedAt: Date.now() } })
      .run()
  }

  journals(): unknown[] {
    return application
      .get('DbService')
      .getDb()
      .select({ value: appStateTable.value })
      .from(appStateTable)
      .where(like(appStateTable.key, 'agent-session-fork:%'))
      .all()
      .map((row) => row.value)
  }

  removeJournal(operationId: string): void {
    application
      .get('DbService')
      .getDb()
      .delete(appStateTable)
      .where(eq(appStateTable.key, 'agent-session-fork:' + operationId))
      .run()
  }

  hasCommittedChild(journal: AgentSessionForkJournal): boolean {
    const row = application
      .get('DbService')
      .getDb()
      .select()
      .from(agentSessionTable)
      .where(eq(agentSessionTable.id, journal.targetSessionId))
      .get()
    return row?.forkedFrom?.operationId === journal.operationId
  }

  commit(input: {
    journal: AgentSessionForkJournal
    source: ReturnType<AgentSessionForkService['read']>
    excludedIds: readonly string[]
    messages: AgentSessionMessageRow[]
    rebuildHistory?: boolean
  }): void {
    const { journal, source } = input
    application.get('DbService').withWriteTx((tx) => {
      const current = this.readTx(tx, journal.sourceSessionId, journal.messageId, input.excludedIds)
      // Appending after the boundary is allowed. Changes to the chosen prefix, Agent or cwd are not.
      if (
        current.agent.type !== source.agent.type ||
        current.agent.id !== source.agent.id ||
        current.workspace.id !== source.workspace.id ||
        current.workspace.path !== source.workspace.path ||
        JSON.stringify(current.messages) !== JSON.stringify(source.messages)
      )
        throw new Error('history_changed')
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
        journal.targetSessionId,
        {
          agentId: source.agent.id,
          name: `${baseName}${separator}(${number})`,
          description: source.session.description,
          workspace:
            source.workspace.type === 'system' ? { type: 'system' } : { type: 'user', workspaceId: source.workspace.id }
        },
        journal.createdAt
      )
      agentSessionService.setForkSourceTx(tx, journal.targetSessionId, {
        sessionId: journal.sourceSessionId,
        messageId: journal.messageId,
        operationId: journal.operationId,
        ...(input.rebuildHistory ? { historyMessageId: input.messages.at(-1)!.id } : {})
      })
      agentSessionMessageService.insertForkMessagesTx(tx, journal.targetSessionId, input.messages)
      if (input.rebuildHistory)
        agentSessionForkContextService.createTx(
          tx,
          journal.targetSessionId,
          input.messages,
          journal.sourceSessionId,
          source.messages
        )
      this.writeJournal({ ...journal, committed: true }, tx)
    })
    agentSessionService.notifyReadModelChange([journal.targetSessionId], 'membership')
  }

  markUnavailable(sourceSessionId: string, messageId: string, reason: string): void {
    // The message owner validates the reason and performs the write.
    agentSessionMessageService.markForkUnavailable(sourceSessionId, messageId, reason)
  }
}

export const agentSessionForkService = new AgentSessionForkService()
