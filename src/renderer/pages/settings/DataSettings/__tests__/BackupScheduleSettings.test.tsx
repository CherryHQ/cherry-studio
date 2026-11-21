import '@testing-library/jest-dom/vitest'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import type { BackupSchedule } from '@shared/data/preference/preferenceTypes'

import BackupScheduleSettings, { isBackupScheduleActive } from '../BackupScheduleSettings'

const KEY = 'data.backup.local.schedule'
const tuesday = (hh: number, mm = 0) => new Date(2026, 10, 3, hh, mm)

const renderSettings = (schedule: BackupSchedule) => {
  MockUsePreferenceUtils.setPreferenceValue(KEY, schedule)
  return render(
    <BackupScheduleSettings scheduleKey={KEY}>
      <div>interval-row</div>
    </BackupScheduleSettings>
  )
}

describe('BackupScheduleSettings', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    vi.spyOn(toast, 'error').mockImplementation(() => '')
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows the interval row only in interval mode', () => {
    renderSettings({ mode: 'interval', entries: [] })
    expect(screen.getByText('interval-row')).toBeInTheDocument()
  })

  it('hides the interval row and shows a next-backup line in daily mode', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(tuesday(9))
    renderSettings({ mode: 'daily', entries: [{ time: '17:30', days: [1, 2, 3, 4, 5] }] })
    expect(screen.queryByText('interval-row')).not.toBeInTheDocument()
    expect(screen.getByText(/17:30/)).toBeInTheDocument()
  })

  it('rejects an 11th entry with the limit message and leaves the schedule unchanged', async () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ time: `0${i}:00`, days: [] }))
    renderSettings({ mode: 'daily', entries })
    await userEvent.click(screen.getByRole('button', { name: '添加时间' }))
    expect(toast.error).toHaveBeenCalledOnce()
    expect(MockUsePreferenceUtils.getPreferenceValue(KEY).entries).toHaveLength(10)
  })

  it('adds an entry below the limit', async () => {
    renderSettings({ mode: 'daily', entries: [] })
    await userEvent.click(screen.getByRole('button', { name: '添加时间' }))
    expect(MockUsePreferenceUtils.getPreferenceValue(KEY).entries).toHaveLength(1)
  })

  it('only counts daily schedules with entries or interval schedules with an interval as active', () => {
    expect(isBackupScheduleActive({ mode: 'off', entries: [] }, true)).toBe(false)
    expect(isBackupScheduleActive({ mode: 'daily', entries: [] }, true)).toBe(false)
    expect(isBackupScheduleActive({ mode: 'daily', entries: [{ time: '08:30', days: [] }] }, false)).toBe(true)
    expect(isBackupScheduleActive({ mode: 'interval', entries: [] }, true)).toBe(true)
  })
})
