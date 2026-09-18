import { and, eq } from 'drizzle-orm'

import { application } from '@application'
import { remoteCommandTable, type RemoteCommandRow } from '@data/db/schemas/remoteCommand'
import type { DbOrTx } from '@data/db/types'

export class RemoteCommandConflictError extends Error {
  constructor() {
    super('COMMAND_CONFLICT')
    this.name = 'RemoteCommandConflictError'
  }
}

class RemoteCommandService {
  get(
    deviceId: string,
    commandId: string,
    tx: DbOrTx = application.get('DbService').getDb()
  ): RemoteCommandRow | undefined {
    return tx
      .select()
      .from(remoteCommandTable)
      .where(and(eq(remoteCommandTable.deviceId, deviceId), eq(remoteCommandTable.commandId, commandId)))
      .get()
  }

  findMatching(tx: DbOrTx, deviceId: string, commandId: string, requestHash: string): RemoteCommandRow | undefined {
    const row = this.get(deviceId, commandId, tx)
    if (row && row.requestHash !== requestHash) throw new RemoteCommandConflictError()
    return row
  }

  recordTx(tx: DbOrTx, input: Omit<RemoteCommandRow, 'createdAt'>): void {
    tx.insert(remoteCommandTable).values(input).run()
  }

  /** A deleted device's ID never authenticates again, so its receipts can no longer be read or replayed. */
  deleteByDeviceTx(tx: DbOrTx, deviceId: string): void {
    tx.delete(remoteCommandTable).where(eq(remoteCommandTable.deviceId, deviceId)).run()
  }

  complete(deviceId: string, commandId: string, result: Record<string, unknown>): void {
    application
      .get('DbService')
      .getDb()
      .update(remoteCommandTable)
      .set({ result })
      .where(and(eq(remoteCommandTable.deviceId, deviceId), eq(remoteCommandTable.commandId, commandId)))
      .run()
  }
}

export const remoteCommandService = new RemoteCommandService()
