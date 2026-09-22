import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { apiGatewayPairedDeviceTable } from '@data/db/schemas/apiGatewayPairedDevice'
import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'
import { ErrorCode } from '@shared/data/api/errors'

describe('ApiGatewayPairedDeviceService', () => {
  const dbh = setupTestDatabase()

  it('grants only the capabilities confirmed during pairing and binds them to the proven key', () => {
    const { device, authorization } = apiGatewayPairedDeviceService.approveRemote({
      name: 'Phone',
      platform: 'ios',
      peerIdentity: 'key-one',
      capabilities: ['agent']
    })
    expect(authorization.grants).toEqual([{ domain: 'agent', grantId: expect.any(String) }])
    expect(device.remoteAccess?.capabilities).toEqual(['agent'])
    expect(apiGatewayPairedDeviceService.getRemoteAuthorization(device.id, 'key-one')).toEqual(authorization)
    expect(apiGatewayPairedDeviceService.getRemoteAuthorization(device.id, 'key-two')).toBeUndefined()
    expect(dbh.db.select().from(apiGatewayPairedDeviceTable).get()?.tokenHash).toBeNull()
    const legacy = apiGatewayPairedDeviceService.create({ name: 'Legacy', platform: 'ios', tokenHash: 'f'.repeat(64) })
    expect(apiGatewayPairedDeviceService.getRemoteAuthorization(legacy.id, 'key-one')).toBeUndefined()
  })

  it('revokes capabilities independently and rotates authority on a new pairing', () => {
    const input = {
      name: 'Phone',
      platform: 'ios',
      peerIdentity: 'key-one',
      capabilities: ['agent', 'configuration'] as const
    }
    const first = apiGatewayPairedDeviceService.approveRemote({ ...input, capabilities: [...input.capabilities] })
    apiGatewayPairedDeviceService.revokeRemoteCapability(first.device.id, 'agent')
    expect(apiGatewayPairedDeviceService.getRemoteAuthorization(first.device.id, 'key-one')?.grants).toEqual(
      first.authorization.grants.filter((grant) => grant.domain === 'configuration')
    )
    const second = apiGatewayPairedDeviceService.approveRemote({ ...input, capabilities: [...input.capabilities] })
    expect(second.device.id).toBe(first.device.id)
    expect(
      second.authorization.grants.every(
        (grant) => !first.authorization.grants.some((old) => old.grantId === grant.grantId)
      )
    ).toBe(true)
    apiGatewayPairedDeviceService.delete(first.device.id)
    expect(apiGatewayPairedDeviceService.getRemoteAuthorization(first.device.id, 'key-one')).toBeUndefined()
  })

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

  it('reports duplicate token hashes as a conflict without replacing the paired device', () => {
    const tokenHash = 'e'.repeat(64)
    const device = apiGatewayPairedDeviceService.create({ name: 'Pixel', platform: 'android', tokenHash })

    expect(() => apiGatewayPairedDeviceService.create({ name: 'iPhone', platform: 'ios', tokenHash })).toThrowError(
      expect.objectContaining({ code: ErrorCode.CONFLICT, status: 409 })
    )
    expect(apiGatewayPairedDeviceService.list()).toEqual([device])
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
