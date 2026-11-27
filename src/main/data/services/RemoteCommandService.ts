import { and, count, eq } from 'drizzle-orm'

import { application } from '@application'
import type { RemoteFailure } from '@cherrystudio/remote-protocol'
import type { CommandReceipt } from '@cherrystudio/remote-protocol/agent'
import { type RemoteCommandRow, remoteCommandTable } from '@data/db/schemas/remoteCommand'
import type { DbOrTx } from '@data/db/types'

const DEVICE_RECEIPTS = 10_000
const GLOBAL_RECEIPTS = 100_000

export interface RemoteCommandKey {
  deviceId: string
  grantId: string
  commandId: string
}

export type RemoteCommandOutcome =
  | { status: 'applied'; sessionId?: string; executionId?: string; result?: unknown }
  | { status: 'rejected'; error: RemoteFailure }
  | { status: 'interrupted'; error: RemoteFailure }

function toReceipt(row: RemoteCommandRow): CommandReceipt {
  return {
    commandId: row.commandId,
    method: row.method,
    status: row.status,
    admittedAt: new Date(row.admittedAt).toISOString(),
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    ...(row.executionId ? { executionId: row.executionId } : {}),
    ...(row.result !== null && row.result !== undefined ? { result: row.result as CommandReceipt['result'] } : {}),
    ...(row.error ? { error: row.error } : {})
  }
}

export class RemoteCommandService {
  private get db() {
    return application.get('DbService').getDb()
  }

  private where(key: RemoteCommandKey) {
    return and(
      eq(remoteCommandTable.deviceId, key.deviceId),
      eq(remoteCommandTable.grantId, key.grantId),
      eq(remoteCommandTable.commandId, key.commandId)
    )
  }

  get(key: RemoteCommandKey): CommandReceipt | undefined {
    const row = this.db.select().from(remoteCommandTable).where(this.where(key)).get()
    return row ? toReceipt(row) : undefined
  }

  apply(
    key: RemoteCommandKey,
    input: { method: string; identityDigest: string; sessionId?: string },
    write: (tx: DbOrTx) => RemoteCommandOutcome
  ) {
    return application.get('DbService').withWriteTx((tx) => {
      const admission = this.admit(key, input)
      if (admission.kind !== 'accepted') return admission
      return { kind: 'accepted' as const, receipt: this.settle(key, write(tx)) }
    })
  }

  reserveExecutionTx(
    tx: DbOrTx,
    key: RemoteCommandKey,
    reservation: { executionId: string; messageId: string; userMessageId: string }
  ): void {
    const row = tx
      .update(remoteCommandTable)
      .set({ executionId: reservation.executionId, result: reservation })
      .where(and(this.where(key), eq(remoteCommandTable.status, 'accepted')))
      .returning()
      .get()
    if (!row) throw new Error('Remote command is no longer accepted')
  }

  /** Returns the existing receipt for an identical retry, or records a fresh `accepted` receipt. */
  admit(
    key: RemoteCommandKey,
    input: { method: string; identityDigest: string; sessionId?: string }
  ):
    | { kind: 'existing'; receipt: CommandReceipt }
    | { kind: 'conflict' }
    | { kind: 'exhausted' }
    | { kind: 'accepted'; receipt: CommandReceipt } {
    return application.get('DbService').withWriteTx((tx) => {
      const existing = tx.select().from(remoteCommandTable).where(this.where(key)).get()
      if (existing) {
        return existing.identityDigest === input.identityDigest
          ? { kind: 'existing', receipt: toReceipt(existing) }
          : { kind: 'conflict' }
      }
      // Keep deduplication receipts for the grant lifetime; reject new work instead of replaying expired commands.
      const deviceCount = tx
        .select({ count: count() })
        .from(remoteCommandTable)
        .where(eq(remoteCommandTable.deviceId, key.deviceId))
        .get()!.count
      if (
        deviceCount >= DEVICE_RECEIPTS ||
        tx.select({ count: count() }).from(remoteCommandTable).get()!.count >= GLOBAL_RECEIPTS
      )
        return { kind: 'exhausted' }
      const row = tx
        .insert(remoteCommandTable)
        .values({
          ...key,
          method: input.method,
          identityDigest: input.identityDigest,
          status: 'accepted',
          sessionId: input.sessionId ?? null,
          admittedAt: Date.now()
        })
        .returning()
        .get()
      return { kind: 'accepted', receipt: toReceipt(row) }
    })
  }

  /** Moves an `accepted` receipt to its terminal state; a settled receipt is never overwritten. */
  settle(key: RemoteCommandKey, outcome: RemoteCommandOutcome): CommandReceipt {
    const values =
      outcome.status === 'applied'
        ? {
            status: outcome.status,
            ...(outcome.sessionId ? { sessionId: outcome.sessionId } : {}),
            executionId: outcome.executionId ?? null,
            ...(outcome.result !== undefined ? { result: outcome.result } : {})
          }
        : { status: outcome.status, error: outcome.error }
    const row = this.db
      .update(remoteCommandTable)
      .set(values)
      .where(and(this.where(key), eq(remoteCommandTable.status, 'accepted')))
      .returning()
      .get()
    const current = row ?? this.db.select().from(remoteCommandTable).where(this.where(key)).get()
    if (!current) throw new Error('Remote command receipt missing')
    return toReceipt(current)
  }

  /** Startup repair: an `accepted` receipt with no owner left to settle it cannot prove its side effect. */
  interruptPending(): number {
    return this.db
      .update(remoteCommandTable)
      .set({
        status: 'interrupted',
        error: { reason: 'INTERNAL', message: 'Desktop restarted before the command settled' }
      })
      .where(eq(remoteCommandTable.status, 'accepted'))
      .returning()
      .all().length
  }
}

export const remoteCommandService = new RemoteCommandService()
