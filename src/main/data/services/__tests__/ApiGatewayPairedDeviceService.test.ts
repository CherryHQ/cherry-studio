import { apiGatewayPairedDeviceTable } from '@data/db/schemas/apiGatewayPairedDevice'
import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'
import { ErrorCode } from '@shared/data/api/errors'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('ApiGatewayPairedDeviceService', () => {
  const dbh = setupTestDatabase()

  it.each([
    { name: '   ', platform: 'ios' },
    { name: 'a'.repeat(65), platform: 'ios' },
    { name: 'iPhone', platform: '   ' },
    { name: 'iPhone', platform: 'a'.repeat(33) }
  ])('rejects invalid device metadata before persisting: %j', (metadata) => {
    expect(() => apiGatewayPairedDeviceService.create({ ...metadata, tokenHash: 'c'.repeat(64) })).toThrowError(
      expect.objectContaining({ code: ErrorCode.VALIDATION_ERROR })
    )
    expect(dbh.db.select().from(apiGatewayPairedDeviceTable).all()).toEqual([])
  })

  it.each([
    { name: 'Pixel', platform: 'android' },
    { name: 'a'.repeat(64), platform: 'b'.repeat(32) }
  ])('normalizes valid metadata before persisting: %j', (metadata) => {
    const device = apiGatewayPairedDeviceService.create({
      name: `  ${metadata.name}  `,
      platform: `  ${metadata.platform}  `,
      tokenHash: 'd'.repeat(64)
    })

    expect(device).toMatchObject(metadata)
    expect(dbh.db.select().from(apiGatewayPairedDeviceTable).get()).toMatchObject(metadata)
  })

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
