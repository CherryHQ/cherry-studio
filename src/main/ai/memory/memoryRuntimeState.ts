import { and, eq, isNotNull, ne, or, sql } from 'drizzle-orm'
import * as z from 'zod'

import { application } from '@application'
import { agentSessionContextTable } from '@data/db/schemas/agentSessionContext'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { appStateTable } from '@data/db/schemas/appState'
import { messageTable } from '@data/db/schemas/message'
import type { MemoryScope } from '@shared/types/memory'

import { MemoryError } from './memoryFiles'

export type MemoryRuntimeOwner = { agentSessionId: string } | { topicId: string; assistantId: string }

const stateSchema = z.strictObject({ version: z.literal(1), protection: z.string().nullable() })

function hasHistory(owner: MemoryRuntimeOwner): boolean {
  const db = application.get('DbService').getDb()
  const agent = 'agentSessionId' in owner
  if (
    agent &&
    db
      .select({ id: agentSessionContextTable.id })
      .from(agentSessionContextTable)
      .where(
        and(
          eq(agentSessionContextTable.sessionId, owner.agentSessionId),
          or(eq(agentSessionContextTable.bindingState, 'bound'), isNotNull(agentSessionContextTable.checkpointMapping))
        )
      )
      .get()
  )
    return true
  const table = agent ? agentSessionMessageTable : messageTable
  const conversation = agent
    ? eq(agentSessionMessageTable.sessionId, owner.agentSessionId)
    : eq(messageTable.topicId, owner.topicId)
  // A first turn already has a user row and may have an empty pending assistant placeholder.
  const priorOutput = db
    .select({ id: table.id })
    .from(table)
    .where(
      and(
        conversation,
        or(
          and(
            ne(table.role, 'root'),
            ne(table.role, 'user'),
            or(ne(table.status, 'pending'), sql`json_array_length(${table.data}, '$.parts') > 0`)
          ),
          agent ? isNotNull(agentSessionMessageTable.runtimeResumeToken) : isNotNull(messageTable.compactionSummary)
        )
      )
    )
    .get()
  const users = db
    .select({ id: table.id })
    .from(table)
    .where(and(conversation, eq(table.role, 'user')))
    .limit(2)
    .all()
  return !!priorOutput || users.length > 1
}

function stateKey(owner: MemoryRuntimeOwner, scope: MemoryScope): string {
  // Topic history survives Assistant reassignment. Its isolation boundary must follow that same history.
  const identity = 'agentSessionId' in owner ? ['agent', owner.agentSessionId] : ['topic', owner.topicId]
  return `memory:runtime:${JSON.stringify([...identity, scope.kind, scope.kind === 'private' ? scope.agentId : ''])}`
}

const unexposed = 'never-exposed'

/** Only a fresh conversation can establish that none of its history used shared memory. */
export function hasUnexposedAssistantHistory(owner: { topicId: string; assistantId: string }): boolean {
  const db = application.get('DbService').getDb()
  const key = stateKey(owner, { kind: 'shared' })
  const row = db.select({ value: appStateTable.value }).from(appStateTable).where(eq(appStateTable.key, key)).get()
  if (row) return row.value === unexposed
  if (hasHistory(owner)) return false
  db.insert(appStateTable)
    .values({ key, value: unexposed, description: 'Conversation has never used shared memory' })
    .run()
  return true
}

/** Records the isolation boundary once; a later request cannot bless its own stale transcript. */
export function assertMemoryRuntimeState(
  owner: MemoryRuntimeOwner,
  scope: MemoryScope,
  protection: string | null
): void {
  const db = application.get('DbService').getDb()
  const key = stateKey(owner, scope)
  const row = db.select({ value: appStateTable.value }).from(appStateTable).where(eq(appStateTable.key, key)).get()
  if (row?.value === unexposed) {
    db.update(appStateTable)
      .set({
        value: { version: 1, protection },
        description: 'Conversation memory isolation boundary; no memory content'
      })
      .where(eq(appStateTable.key, key))
      .run()
    return
  }
  const previous = row ? stateSchema.safeParse(row.value) : undefined
  if (
    previous ? !previous.success || previous.data.protection !== protection : protection !== null && hasHistory(owner)
  ) {
    throw new MemoryError('conflict', 'Memory history requires isolation before this runtime can continue')
  }
  if (!row)
    db.insert(appStateTable)
      .values({
        key,
        value: { version: 1, protection },
        description: 'Conversation memory isolation boundary; no memory content'
      })
      .run()
}
