import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { application } from '@application'

import { apiGatewayPairedDeviceService } from '../ApiGatewayPairedDeviceService'
import { remoteCommandService } from '../RemoteCommandService'

describe('durable remote command receipts', () => {
  setupTestDatabase()
  const pairedCommand = () => ({
    deviceId: apiGatewayPairedDeviceService.create({ name: 'phone', platform: 'ios', tokenHash: 'a'.repeat(64) }).id,
    commandId: 'command',
    requestHash: 'original',
    agentId: 'agent',
    result: { userMessageId: 'stable-message', status: 'accepted' }
  })

  it('keeps the original result across service reads and refuses command ID reuse with different input', () => {
    const command = pairedCommand()
    const { deviceId } = command
    application.get('DbService').withWriteTx((tx) => remoteCommandService.recordTx(tx, command))
    const db = application.get('DbService').getDb()
    expect(remoteCommandService.findMatching(db, deviceId, 'command', 'original')?.result).toEqual(command.result)
    expect(() => remoteCommandService.findMatching(db, deviceId, 'command', 'changed')).toThrow('COMMAND_CONFLICT')
    expect(remoteCommandService.get('another-phone', 'command')).toBeUndefined()
    expect(remoteCommandService.get(deviceId, 'command')?.result.userMessageId).toBe('stable-message')
  })

  it('does not leave an accepted receipt behind when the containing business transaction rolls back', () => {
    const command = pairedCommand()
    expect(() =>
      application.get('DbService').withWriteTx((tx) => {
        remoteCommandService.recordTx(tx, command)
        throw new Error('business write failed')
      })
    ).toThrow('business write failed')
    expect(remoteCommandService.get(command.deviceId, 'command')).toBeUndefined()
  })

  it('refuses a receipt for a device that is not paired', () => {
    expect(() =>
      application
        .get('DbService')
        .withWriteTx((tx) => remoteCommandService.recordTx(tx, { ...pairedCommand(), deviceId: 'never-paired' }))
    ).toThrow()
  })
})
