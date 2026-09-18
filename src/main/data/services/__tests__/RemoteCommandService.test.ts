import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { application } from '@application'

import { remoteCommandService } from '../RemoteCommandService'

describe('durable remote command receipts', () => {
  setupTestDatabase()
  const command = {
    deviceId: 'phone',
    commandId: 'command',
    requestHash: 'original',
    agentId: 'agent',
    sessionId: 'session',
    result: { userMessageId: 'stable-message', status: 'accepted' }
  }

  it('keeps the original result across service reads and refuses command ID reuse with different input', () => {
    application.get('DbService').withWriteTx((tx) => remoteCommandService.recordTx(tx, command))
    const db = application.get('DbService').getDb()
    expect(remoteCommandService.findMatching(db, 'phone', 'command', 'original')?.result).toEqual(command.result)
    expect(() => remoteCommandService.findMatching(db, 'phone', 'command', 'changed')).toThrow('COMMAND_CONFLICT')
    expect(remoteCommandService.get('another-phone', 'command')).toBeUndefined()
    expect(remoteCommandService.get('phone', 'command')?.result.userMessageId).toBe('stable-message')
  })

  it('does not leave an accepted receipt behind when the containing business transaction rolls back', () => {
    expect(() =>
      application.get('DbService').withWriteTx((tx) => {
        remoteCommandService.recordTx(tx, command)
        throw new Error('business write failed')
      })
    ).toThrow('business write failed')
    expect(remoteCommandService.get('phone', 'command')).toBeUndefined()
  })
})
