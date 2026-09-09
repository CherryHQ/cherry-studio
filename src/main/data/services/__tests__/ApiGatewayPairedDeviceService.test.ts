import { apiGatewayPairedDeviceTable } from '@data/db/schemas/apiGatewayPairedDevice'
import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('ApiGatewayPairedDeviceService', () => {
  const dbh = setupTestDatabase()

  it('returns renderer metadata without exposing the token hash', () => {
    const device = apiGatewayPairedDeviceService.create({
      name: 'Pixel',
      platform: 'android',
      tokenHash: 'a'.repeat(64)
    })

    expect(apiGatewayPairedDeviceService.list()).toEqual([device])
    expect(device).not.toHaveProperty('tokenHash')
    expect(dbh.db.select().from(apiGatewayPairedDeviceTable).get()?.tokenHash).toBe('a'.repeat(64))
  })

  it('revokes the verifier used by paired-device authentication', () => {
    const tokenHash = 'b'.repeat(64)
    const device = apiGatewayPairedDeviceService.create({ name: 'iPhone', platform: 'ios', tokenHash })

    expect(apiGatewayPairedDeviceService.hasTokenHash(tokenHash)).toBe(true)
    apiGatewayPairedDeviceService.delete(device.id)
    expect(apiGatewayPairedDeviceService.hasTokenHash(tokenHash)).toBe(false)
    expect(
      dbh.db.select().from(apiGatewayPairedDeviceTable).where(eq(apiGatewayPairedDeviceTable.id, device.id)).get()
    ).toBeUndefined()
  })
})
