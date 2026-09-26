import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AutoBackupEvent } from '@shared/types/backup'

import { BackupProtectionSummary } from '../BackupProtectionSummary'

let enabled: Record<string, boolean> = {}
let events: Array<AutoBackupEvent | null> = [null, null, null, null]

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key}:${options.when}` : key)
  })
}))

vi.mock('@data/hooks/usePreference', () => ({
  useMultiplePreferences: () => [enabled, vi.fn()]
}))

vi.mock('@data/hooks/useCache', () => ({
  useSharedCacheSelector: (_keys: unknown, select: (values: unknown) => unknown) => select(events)
}))

vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))

vi.mock('@renderer/components/SettingsPrimitives', () => ({
  SettingGroup: ({ children }: { children?: ReactNode }) => <div>{children}</div>
}))

/** Order matches AUTO_BACKUP_TYPES: webdav, s3, local, nutstore. */
const LOCAL_INDEX = 2

describe('BackupProtectionSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    enabled = { local: false, webdav: false, s3: false, nutstore: false }
    events = [null, null, null, null]
  })

  it('warns plainly when nothing is being backed up', () => {
    render(<BackupProtectionSummary />)

    expect(screen.getByText('settings.data.protection.none')).toBeInTheDocument()
    expect(screen.getByText('settings.data.protection.none_hint')).toBeInTheDocument()
  })

  it('does not claim protection from a target that is switched on but has never run', () => {
    // "Backup is on" is what the settings already implied; whether one exists is the question.
    enabled = { ...enabled, local: true }

    render(<BackupProtectionSummary />)

    expect(screen.getByText('settings.data.protection.not_yet')).toBeInTheDocument()
  })

  it('reports when the last backup actually completed', () => {
    enabled = { ...enabled, local: true }
    events[LOCAL_INDEX] = { id: 1, type: 'local', status: 'succeeded', timestamp: Date.parse('2026-09-19T03:00:00Z') }

    render(<BackupProtectionSummary />)

    expect(screen.getByText(/settings\.data\.protection\.last_backup:/)).toBeInTheDocument()
  })

  it('counts a backup that was written but could not prune old copies', () => {
    // 'warning' means the archive exists; refusing to count it would understate the protection.
    enabled = { ...enabled, local: true }
    events[LOCAL_INDEX] = {
      id: 2,
      type: 'local',
      status: 'warning',
      timestamp: Date.parse('2026-09-19T03:00:00Z'),
      reason: 'cleanup_failed'
    }

    render(<BackupProtectionSummary />)

    expect(screen.getByText(/settings\.data\.protection\.last_backup:/)).toBeInTheDocument()
  })

  it('ignores a success recorded against a target the user has since switched off', () => {
    // Otherwise a stale webdav success would vouch for a machine with no backup at all.
    enabled = { ...enabled, local: true }
    events[0] = { id: 3, type: 'webdav', status: 'succeeded', timestamp: Date.now() }

    render(<BackupProtectionSummary />)

    expect(screen.getByText('settings.data.protection.not_yet')).toBeInTheDocument()
  })

  it('does not count a failed run as a backup', () => {
    enabled = { ...enabled, local: true }
    events[LOCAL_INDEX] = {
      id: 4,
      type: 'local',
      status: 'failed',
      timestamp: Date.now(),
      errorMessage: 'disk full'
    }

    render(<BackupProtectionSummary />)

    expect(screen.getByText('settings.data.protection.not_yet')).toBeInTheDocument()
  })
})
