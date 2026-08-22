import { application } from '@application'
import { type CherryCloudSessionRow, cherryCloudSessionTable } from '@data/db/schemas/cherryCloudSession'
import { eq } from 'drizzle-orm'

const CURRENT_SESSION_ID = 'current'

export type CherryCloudSession = Omit<CherryCloudSessionRow, 'id'>

export class CherryCloudSessionService {
  get(): CherryCloudSession | null {
    const row = application
      .get('DbService')
      .getDb()
      .select()
      .from(cherryCloudSessionTable)
      .where(eq(cherryCloudSessionTable.id, CURRENT_SESSION_ID))
      .get()

    if (!row) return null
    return {
      accessToken: row.accessToken,
      accessExpiresAt: row.accessExpiresAt,
      refreshToken: row.refreshToken,
      sessionId: row.sessionId,
      sessionExpiresAt: row.sessionExpiresAt,
      deviceId: row.deviceId,
      accountId: row.accountId,
      displayName: row.displayName,
      devicePublicKey: row.devicePublicKey,
      devicePrivateKey: row.devicePrivateKey
    }
  }

  replace(session: CherryCloudSession): void {
    application
      .get('DbService')
      .getDb()
      .insert(cherryCloudSessionTable)
      .values({ id: CURRENT_SESSION_ID, ...session })
      .onConflictDoUpdate({ target: cherryCloudSessionTable.id, set: session })
      .run()
  }

  clear(): void {
    application
      .get('DbService')
      .getDb()
      .delete(cherryCloudSessionTable)
      .where(eq(cherryCloudSessionTable.id, CURRENT_SESSION_ID))
      .run()
  }
}

export const cherryCloudSessionService = new CherryCloudSessionService()
