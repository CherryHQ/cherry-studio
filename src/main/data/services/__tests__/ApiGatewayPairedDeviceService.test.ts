import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { application } from '@application'
import { apiGatewayPairedDeviceTable } from '@data/db/schemas/apiGatewayPairedDevice'
import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'
import { remoteCommandService } from '@data/services/RemoteCommandService'
import { ErrorCode } from '@shared/data/api/errors'

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
    expect(apiGatewayPairedDeviceService.get(device.id)).toEqual(device)
    expect(apiGatewayPairedDeviceService.findByTokenHash('a'.repeat(64))).toEqual(device)
    expect(apiGatewayPairedDeviceService.findByTokenHash('f'.repeat(64))).toBeUndefined()
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
    const credentialsVisibleAtRevocation: boolean[] = []
    const subscription = apiGatewayPairedDeviceService.onDeleted((id) => {
      expect(id).toBe(device.id)
      credentialsVisibleAtRevocation.push(apiGatewayPairedDeviceService.hasTokenHash(tokenHash))
    })
    try {
      apiGatewayPairedDeviceService.delete(device.id)
    } finally {
      subscription.dispose()
    }
    expect(credentialsVisibleAtRevocation).toEqual([false])
    expect(apiGatewayPairedDeviceService.hasTokenHash(tokenHash)).toBe(false)
    expect(apiGatewayPairedDeviceService.get(device.id)).toBeUndefined()
    expect(apiGatewayPairedDeviceService.findByTokenHash(tokenHash)).toBeUndefined()
    expect(
      dbh.db.select().from(apiGatewayPairedDeviceTable).where(eq(apiGatewayPairedDeviceTable.id, device.id)).get()
    ).toBeUndefined()
  })

  it("removes a revoked device's command receipts and keeps other devices' receipts", () => {
    const revoked = apiGatewayPairedDeviceService.create({ name: 'iPhone', platform: 'ios', tokenHash: 'e'.repeat(64) })
    const kept = apiGatewayPairedDeviceService.create({ name: 'Pixel', platform: 'android', tokenHash: 'f'.repeat(64) })
    const receipt = { commandId: 'command', requestHash: 'hash', agentId: 'agent', sessionId: null, result: {} }
    application.get('DbService').withWriteTx((tx) => {
      remoteCommandService.recordTx(tx, { ...receipt, deviceId: revoked.id })
      remoteCommandService.recordTx(tx, { ...receipt, deviceId: kept.id })
    })

    apiGatewayPairedDeviceService.delete(revoked.id)

    expect(remoteCommandService.get(revoked.id, 'command')).toBeUndefined()
    expect(remoteCommandService.get(kept.id, 'command')).toBeDefined()
  })
})
