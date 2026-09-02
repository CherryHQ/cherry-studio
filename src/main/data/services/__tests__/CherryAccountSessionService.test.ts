import { cherryAccountSessionTable } from '@data/db/schemas/cherryAccountSession'
import { type CherryAccountSession, cherryAccountSessionService } from '@data/services/CherryAccountSessionService'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

const session: CherryAccountSession = {
  accessToken: 'access-token',
  accessExpiresAt: 1_800_000_000_000,
  refreshToken: 'refresh-token',
  sessionId: 'session-id',
  sessionExpiresAt: 1_900_000_000_000,
  deviceId: 'device-id',
  accountId: 'account-id',
  displayName: 'Sora',
  devicePublicKey: 'public-key',
  devicePrivateKey: 'private-key'
}

describe('CherryAccountSessionService', () => {
  const dbh = setupTestDatabase()

  it('returns null without a saved session', () => {
    expect(cherryAccountSessionService.get()).toBeNull()
  })

  it('atomically replaces the current session', () => {
    cherryAccountSessionService.replace(session)
    cherryAccountSessionService.replace({ ...session, accessToken: 'next-access-token', displayName: null })

    expect(cherryAccountSessionService.get()).toEqual({
      ...session,
      accessToken: 'next-access-token',
      displayName: null
    })
    expect(dbh.db.select().from(cherryAccountSessionTable).all()).toHaveLength(1)
  })

  it('clears the current session', () => {
    cherryAccountSessionService.replace(session)
    cherryAccountSessionService.clear()

    expect(cherryAccountSessionService.get()).toBeNull()
  })
})
