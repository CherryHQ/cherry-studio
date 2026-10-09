import { randomUUID } from 'node:crypto'

import { asc, eq, like } from 'drizzle-orm'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { appStateTable } from '@data/db/schemas/appState'
import type { DbOrTx, DbType } from '@data/db/types'
import type { RuntimeForkAnchor } from '@main/ai/runtime/fork'
import { BROWSER_TOOL_GROUP } from '@shared/ai/browserTools'
import { LEGACY_DSH_TOOL_PREFIX } from '@shared/ai/retiredAgentRuntime'

const MIGRATION_KEY_PREFIX = 'agent-runtime-migration:'
const PI_FILE_SHELL_TOOLS = new Set(['read', 'edit', 'write', 'bash'])

export interface RetiredAgentSessionMigration {
  sessionId: string
  resumeToken: string
}

/** Queue before any reader validates AgentType; retain native tokens until fork recovery finishes. */
export function queueRetiredAgentRuntimeMigration(db: DbType): void {
  db.transaction(
    (tx) => {
      const agents = tx.select().from(agentTable).where(eq(agentTable.type, 'dsh')).all()
      for (const agent of agents) {
        const configuration = { ...agent.configuration }
        if (configuration.permission_mode === 'plan') configuration.permission_mode = 'default'
        const disabledTools = [
          ...new Set(
            agent.disabledTools.flatMap((name) => {
              if (PI_FILE_SHELL_TOOLS.has(name) || name === BROWSER_TOOL_GROUP) return [name]
              if (name === 'read_image') return ['read']
              if (name === 'pwsh') return ['bash']
              return name.startsWith('mcp__') ? [`${LEGACY_DSH_TOOL_PREFIX}${name}`] : []
            })
          )
        ]
        for (const session of tx
          .select()
          .from(agentSessionTable)
          .where(eq(agentSessionTable.agentId, agent.id))
          .all()) {
          tx.insert(appStateTable)
            .values({
              key: `${MIGRATION_KEY_PREFIX}${session.id}`,
              value: { sessionId: session.id, resumeToken: randomUUID() } satisfies RetiredAgentSessionMigration
            })
            .onConflictDoNothing()
            .run()
        }
        tx.update(agentTable)
          .set({ type: 'pi', configuration, disabledTools, updatedAt: agent.updatedAt })
          .where(eq(agentTable.id, agent.id))
          .run()
      }
    },
    { behavior: 'immediate' }
  )
}

export function listRetiredAgentSessionMigrations(db: DbOrTx): RetiredAgentSessionMigration[] {
  return db
    .select()
    .from(appStateTable)
    .where(like(appStateTable.key, `${MIGRATION_KEY_PREFIX}%`))
    .all()
    .map((row) => row.value as RetiredAgentSessionMigration)
}

export function getRetiredAgentSessionMigration(
  db: DbOrTx,
  sessionId: string
): RetiredAgentSessionMigration | undefined {
  return db
    .select()
    .from(appStateTable)
    .where(eq(appStateTable.key, `${MIGRATION_KEY_PREFIX}${sessionId}`))
    .get()?.value as RetiredAgentSessionMigration | undefined
}

export function readRetiredAgentSessionHistory(db: DbOrTx, sessionId: string) {
  const session = db
    .select({ path: agentWorkspaceTable.path })
    .from(agentSessionTable)
    .innerJoin(agentWorkspaceTable, eq(agentSessionTable.workspaceId, agentWorkspaceTable.id))
    .where(eq(agentSessionTable.id, sessionId))
    .get()
  if (!session) return undefined
  const messages = db
    .select()
    .from(agentSessionMessageTable)
    .where(eq(agentSessionMessageTable.sessionId, sessionId))
    .orderBy(asc(agentSessionMessageTable.createdAt), asc(agentSessionMessageTable.id))
    .all()
  return { workspacePath: session.path, messages }
}

export function commitRetiredAgentSessionMigration(
  tx: DbOrTx,
  migration: RetiredAgentSessionMigration,
  anchors: ReadonlyMap<string, RuntimeForkAnchor>,
  expectedHistory: ReturnType<typeof readRetiredAgentSessionHistory>
): void {
  if (getRetiredAgentSessionMigration(tx, migration.sessionId)?.resumeToken !== migration.resumeToken)
    throw new Error('Retired session migration changed')
  if (JSON.stringify(readRetiredAgentSessionHistory(tx, migration.sessionId)) !== JSON.stringify(expectedHistory))
    throw new Error('Retired session history changed during migration')
  for (const row of tx
    .select()
    .from(agentSessionMessageTable)
    .where(eq(agentSessionMessageTable.sessionId, migration.sessionId))
    .all()) {
    const data = { ...row.data }
    delete data.runtimeAnchor
    delete data.nativeSessionId
    const anchor = anchors.get(row.id)
    tx.update(agentSessionMessageTable)
      .set({
        data: { ...data, ...(anchor ? { runtimeAnchor: anchor } : {}) },
        runtimeResumeToken: migration.resumeToken,
        updatedAt: row.updatedAt
      })
      .where(eq(agentSessionMessageTable.id, row.id))
      .run()
  }
  tx.delete(appStateTable)
    .where(eq(appStateTable.key, `${MIGRATION_KEY_PREFIX}${migration.sessionId}`))
    .run()
}
