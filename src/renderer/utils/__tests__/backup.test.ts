import { BACKUP_ACTIVE_WRITERS_ERROR_CODE } from '@shared/types/backup'
import { describe, expect, it, vi } from 'vitest'

import { formatBackupSyncTime, getLocalizedBackupErrorMessage } from '../backup'

const mocks = vi.hoisted(() => ({
  t: vi.fn((key: string) => `localized:${key}`)
}))

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: mocks.t }
}))

describe('getLocalizedBackupErrorMessage', () => {
  it('maps the active-writer code without exposing the raw English error', () => {
    const result = getLocalizedBackupErrorMessage(
      new Error(`Error invoking remote method: ${BACKUP_ACTIVE_WRITERS_ERROR_CODE}: A conversation is still running.`)
    )

    expect(result).toBe('localized:backup.error.active_data_writers')
    expect(result).not.toContain(BACKUP_ACTIVE_WRITERS_ERROR_CODE)
    expect(result).not.toContain('conversation')
  })

  it('uses the localized fallback for other errors', () => {
    expect(getLocalizedBackupErrorMessage(new Error('Disk is full'), 'message.restore.failed')).toBe(
      'localized:message.restore.failed'
    )
  })
})

describe('formatBackupSyncTime', () => {
  const at = (value: string) => new Date(value).getTime()

  it('keeps a same-day sync to the clock time', () => {
    expect(formatBackupSyncTime(at('2026-08-30T10:51:03'), at('2026-08-30T21:00:00'))).toBe('10:51:03')
  })

  it('dates a sync from an earlier day even when it is minutes old', () => {
    expect(formatBackupSyncTime(at('2026-08-29T23:51:03'), at('2026-08-30T00:05:00'))).toBe('2026-08-29 23:51:03')
  })
})
