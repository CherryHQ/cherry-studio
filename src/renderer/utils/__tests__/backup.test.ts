import { BACKUP_ACTIVE_WRITERS_ERROR_CODE } from '@shared/types/backup'
import { describe, expect, it, vi } from 'vitest'

import { getLocalizedBackupErrorMessage } from '../backup'

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

  it.each([
    Object.assign(new Error('copy failed'), { code: 'ENOSPC' }),
    new Error('Error invoking remote method: ENOSPC: no space left on device')
  ])('maps disk-full failures to an actionable localized error', (error) => {
    expect(getLocalizedBackupErrorMessage(error)).toBe('localized:backup.error.disk_full')
  })

  it('uses the operation-neutral disk-full error for restore failures', () => {
    expect(
      getLocalizedBackupErrorMessage(
        new Error('Error invoking remote method: ENOSPC: no space left on device'),
        'message.restore.failed'
      )
    ).toBe('localized:backup.error.disk_full')
  })

  it('uses the localized fallback for other errors', () => {
    expect(getLocalizedBackupErrorMessage(new Error('Disk is full'), 'message.restore.failed')).toBe(
      'localized:message.restore.failed'
    )
  })
})
