import { cherryCloudSessionTable } from '@data/db/schemas/cherryCloudSession'
import { type CherryCloudSession, cherryCloudSessionService } from '@data/services/CherryCloudSessionService'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

const session: CherryCloudSession = {
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

describe('CherryCloudSessionService', () => {
  const dbh = setupTestDatabase()

  it('returns null without a saved session', () => {
    expect(cherryCloudSessionService.get()).toBeNull()
  })

  it('atomically replaces the current session', () => {
    cherryCloudSessionService.replace(session)
    cherryCloudSessionService.replace({ ...session, accessToken: 'next-access-token', displayName: null })

    expect(cherryCloudSessionService.get()).toEqual({
      ...session,
      accessToken: 'next-access-token',
      displayName: null
    })
    expect(dbh.db.select().from(cherryCloudSessionTable).all()).toHaveLength(1)
  })

  it('clears the current session', () => {
    cherryCloudSessionService.replace(session)
    cherryCloudSessionService.clear()

    expect(cherryCloudSessionService.get()).toBeNull()
  })
})
