import { application } from '@application'
import { type CherryAccountSessionRow, cherryAccountSessionTable } from '@data/db/schemas/cherryAccountSession'
import { eq } from 'drizzle-orm'

const CURRENT_SESSION_ID = 'current'

export type CherryAccountSession = Omit<CherryAccountSessionRow, 'createdAt' | 'id' | 'updatedAt'>

export class CherryAccountSessionService {
  get(): CherryAccountSession | null {
    const row = application
      .get('DbService')
      .getDb()
      .select()
      .from(cherryAccountSessionTable)
      .where(eq(cherryAccountSessionTable.id, CURRENT_SESSION_ID))
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

  replace(session: CherryAccountSession): void {
    application
      .get('DbService')
      .getDb()
      .insert(cherryAccountSessionTable)
      .values({ id: CURRENT_SESSION_ID, ...session })
      .onConflictDoUpdate({ target: cherryAccountSessionTable.id, set: session })
      .run()
  }

  clear(): void {
    application
      .get('DbService')
      .getDb()
      .delete(cherryAccountSessionTable)
      .where(eq(cherryAccountSessionTable.id, CURRENT_SESSION_ID))
      .run()
  }
}

export const cherryAccountSessionService = new CherryAccountSessionService()
