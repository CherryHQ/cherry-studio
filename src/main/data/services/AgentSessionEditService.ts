import { and, desc, eq, isNotNull } from 'drizzle-orm'

import { application } from '@application'
import { agentSessionEditTable as table } from '@data/db/schemas/agentSessionEdit'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import type { DbOrTx } from '@data/db/types'

import {
  AgentSessionEditError,
  AgentSessionEditOperationSchema,
  type AgentSessionEditOperation
} from './agentSessionEdit'

export class AgentSessionEditService {
  assertMutableTx(tx: DbOrTx, sessionId: string): void {
    const rows = tx.select().from(table).where(eq(table.sessionId, sessionId)).all()
    if (
      rows.some((row) => {
        const operation = AgentSessionEditOperationSchema.parse(row.document)
        return operation.status === 'preparing' || operation.executionUncertain
      })
    )
      throw new AgentSessionEditError('busy')
  }
  get(operationId: string): AgentSessionEditOperation | undefined {
    const row = application
      .get('DbService')
      .getDb()
      .select()
      .from(table)
      .where(eq(table.operationId, operationId))
      .get()
    return row ? AgentSessionEditOperationSchema.parse(row.document) : undefined
  }

  current(sessionId: string): AgentSessionEditOperation | undefined {
    const row = application
      .get('DbService')
      .getDb()
      .select()
      .from(table)
      .where(and(eq(table.sessionId, sessionId), isNotNull(table.committedAt)))
      .orderBy(desc(table.committedAt))
      .get()
    return row ? AgentSessionEditOperationSchema.parse(row.document) : undefined
  }

  list(): AgentSessionEditOperation[] {
    return application
      .get('DbService')
      .getDb()
      .select()
      .from(table)
      .all()
      .flatMap((row) => {
        const result = AgentSessionEditOperationSchema.safeParse(row.document)
        return result.success ? [result.data] : []
      })
  }

  save(operation: AgentSessionEditOperation): void {
    this.saveTx(application.get('DbService').getDb(), operation)
  }

  saveTx(tx: DbOrTx, operation: AgentSessionEditOperation): void {
    const document = AgentSessionEditOperationSchema.parse(operation)
    const value = {
      operationId: document.operationId,
      sessionId: document.sessionId,
      committedAt: document.committedAt ?? null,
      document
    }
    tx.insert(table).values(value).onConflictDoUpdate({ target: table.operationId, set: value }).run()
  }

  beginSend(sessionId: string, assistantMessageId: string): void {
    const operation = this.current(sessionId)
    if (!operation || operation.assistantMessageId !== assistantMessageId) return
    if (operation.status !== 'committed') throw new AgentSessionEditError('send_uncertain')
    operation.status = 'sending'
    this.save(operation)
  }

  resetUnsent(operation: AgentSessionEditOperation): void {
    application.get('DbService').withWriteTx((tx) => {
      const current = this.current(operation.sessionId)
      if (current?.operationId !== operation.operationId || current.status !== 'preparing')
        throw new AgentSessionEditError('send_uncertain')
      const result = tx
        .update(agentSessionMessageTable)
        .set({
          status: 'pending',
          data: { parts: [] },
          runtimeResumeToken: null,
          runtimeForkState: { version: 1, status: 'unavailable', reason: 'not_turn_boundary' }
        })
        .where(
          and(
            eq(agentSessionMessageTable.sessionId, operation.sessionId),
            eq(agentSessionMessageTable.id, operation.assistantMessageId!)
          )
        )
        .run()
      if (!result.changes) throw new AgentSessionEditError('source_missing')
      operation.status = 'committed'
      this.saveTx(tx, operation)
    })
  }

  reconcile(operation: AgentSessionEditOperation): AgentSessionEditOperation {
    if (operation.status !== 'sending') return operation
    const message = application
      .get('DbService')
      .getDb()
      .select()
      .from(agentSessionMessageTable)
      .where(
        and(
          eq(agentSessionMessageTable.sessionId, operation.sessionId),
          eq(agentSessionMessageTable.id, operation.assistantMessageId!)
        )
      )
      .get()
    if (message?.status === 'success' && message.runtimeResumeToken) {
      operation.status = 'sent'
      operation.resumeToken = message.runtimeResumeToken
      this.save(operation)
    }
    return operation
  }

  confirmSend(sessionId: string, assistantMessageId: string, resumeToken: string): void {
    const operation = this.current(sessionId)
    if (!operation || operation.assistantMessageId !== assistantMessageId || operation.status !== 'sending') return
    operation.status = 'sent'
    operation.resumeToken = resumeToken
    this.save(operation)
  }
}

export const agentSessionEditService = new AgentSessionEditService()
