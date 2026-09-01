import { AUTO_BACKUP_TYPES } from '@shared/types/backup'
import { describe, expect, it } from 'vitest'

import { backupRequestSchemas } from '../backup'

describe('backup.get_auto_sync_state', () => {
  it('carries a last success time for every declared backend', () => {
    const lastSuccessTimes = Object.fromEntries(AUTO_BACKUP_TYPES.map((type, index) => [type, index * 1000]))

    const parsed = backupRequestSchemas['backup.get_auto_sync_state'].output.parse({
      lastSuccessTimes,
      events: [],
      pendingNotifications: []
    })

    expect(parsed).toMatchObject({ lastSuccessTimes })
  })

  it('rejects a snapshot missing a backend instead of dropping it silently', () => {
    const [omitted, ...rest] = AUTO_BACKUP_TYPES

    const result = backupRequestSchemas['backup.get_auto_sync_state'].output.safeParse({
      lastSuccessTimes: Object.fromEntries(rest.map((type) => [type, null])),
      events: [],
      pendingNotifications: []
    })

    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error)).toContain(omitted)
  })
})
