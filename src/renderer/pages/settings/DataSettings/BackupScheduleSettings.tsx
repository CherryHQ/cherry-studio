import dayjs from 'dayjs'
import { Plus, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Input } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import Selector from '@renderer/components/Selector'
import { SettingDivider, SettingHelpText, SettingRow, SettingRowTitle } from '@renderer/components/SettingsPrimitives'
import { toast } from '@renderer/services/toast'
import type { BackupSchedule, BackupScheduleEntry, BackupScheduleMode } from '@shared/data/preference/preferenceTypes'
import { getNextScheduledTime, isValidScheduleTime, MAX_BACKUP_SCHEDULE_ENTRIES } from '@shared/utils/backupSchedule'

type BackupScheduleKey =
  | 'data.backup.local.schedule'
  | 'data.backup.nutstore.schedule'
  | 'data.backup.s3.schedule'
  | 'data.backup.webdav.schedule'

type DayPreset = 'every' | 'weekdays' | 'weekends' | 'custom'

const WEEKDAYS = [1, 2, 3, 4, 5]
const WEEKENDS = [0, 6]
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
const PREVIEW_REFRESH_MS = 30_000

const sameDays = (a: number[], b: number[]) => a.length === b.length && a.every((day, index) => day === b[index])

const getDayPreset = (days: number[]): DayPreset => {
  const sorted = [...days].sort()
  if (sorted.length === 0 || sameDays(sorted, ALL_DAYS)) return 'every'
  if (sameDays(sorted, WEEKDAYS)) return 'weekdays'
  if (sameDays(sorted, WEEKENDS)) return 'weekends'
  return 'custom'
}

const weekdayName = (language: string, day: number, width: 'short' | 'long') =>
  new Intl.DateTimeFormat(language, { weekday: width }).format(new Date(2026, 10, 1 + day))

export function isBackupScheduleActive(schedule: BackupSchedule, intervalActive: boolean): boolean {
  if (schedule.mode === 'daily') return schedule.entries.length > 0
  return schedule.mode === 'interval' && intervalActive
}

interface BackupScheduleSettingsProps {
  scheduleKey: BackupScheduleKey
  disabled?: boolean
  anchorId?: string
  /** Interval-mode row, rendered only while the interval mode is selected. */
  children: ReactNode
}

const BackupScheduleSettings = ({ scheduleKey, disabled, anchorId, children }: BackupScheduleSettingsProps) => {
  const { t, i18n } = useTranslation()
  const [schedule, setSchedule] = usePreference(scheduleKey)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (schedule.mode !== 'daily') return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), PREVIEW_REFRESH_MS)
    return () => clearInterval(timer)
  }, [schedule.mode, schedule.entries])

  const updateEntries = (entries: BackupScheduleEntry[]) => void setSchedule({ ...schedule, entries })
  const updateEntry = (index: number, patch: Partial<BackupScheduleEntry>) =>
    updateEntries(schedule.entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)))

  const addEntry = () => {
    if (schedule.entries.length >= MAX_BACKUP_SCHEDULE_ENTRIES) {
      toast.error(t('settings.data.backup.schedule.max_entries', { max: MAX_BACKUP_SCHEDULE_ENTRIES }))
      return
    }
    updateEntries([...schedule.entries, { time: '17:30', days: [] }])
  }

  const changePreset = (index: number, preset: DayPreset) => {
    const days = { every: [], weekdays: WEEKDAYS, weekends: WEEKENDS, custom: [1] }[preset]
    updateEntry(index, { days })
  }

  const toggleDay = (index: number, day: number) => {
    const current = schedule.entries[index].days.length === 0 ? ALL_DAYS : schedule.entries[index].days
    const days = current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort()
    if (days.length > 0) updateEntry(index, { days })
  }

  const renderNextBackup = () => {
    const next = getNextScheduledTime(schedule.entries, now)
    if (next === null) return t('settings.data.backup.schedule.next_none')
    const nextDate = dayjs(next)
    const dayDiff = nextDate.startOf('day').diff(dayjs(now).startOf('day'), 'day')
    const time = nextDate.format('HH:mm')
    if (dayDiff === 0) return t('settings.data.backup.schedule.next_today', { time })
    if (dayDiff === 1) return t('settings.data.backup.schedule.next_tomorrow', { time })
    return t('settings.data.backup.schedule.next_day', {
      day: weekdayName(i18n.language, nextDate.day(), 'long'),
      time
    })
  }

  const modeOptions: { label: string; value: BackupScheduleMode }[] = [
    { label: t('settings.data.backup.schedule.mode.interval'), value: 'interval' },
    { label: t('settings.data.backup.schedule.mode.daily'), value: 'daily' },
    { label: t('settings.data.backup.schedule.mode.off'), value: 'off' }
  ]
  const presetOptions: { label: string; value: DayPreset }[] = [
    { label: t('settings.data.backup.schedule.days.every'), value: 'every' },
    { label: t('settings.data.backup.schedule.days.weekdays'), value: 'weekdays' },
    { label: t('settings.data.backup.schedule.days.weekends'), value: 'weekends' },
    { label: t('settings.data.backup.schedule.days.custom'), value: 'custom' }
  ]

  return (
    <>
      <SettingRow id={anchorId} className={anchorId ? 'scroll-mt-6' : undefined}>
        <SettingRowTitle>{t('settings.data.backup.schedule.mode.label')}</SettingRowTitle>
        <Selector
          aria-label={t('settings.data.backup.schedule.mode.label')}
          size={14}
          value={schedule.mode}
          onChange={(mode: BackupScheduleMode) => void setSchedule({ ...schedule, mode })}
          disabled={disabled}
          options={modeOptions}
        />
      </SettingRow>
      {schedule.mode === 'interval' && (
        <>
          <SettingDivider />
          {children}
        </>
      )}
      {schedule.mode === 'daily' && (
        <>
          {schedule.entries.map((entry, index) => {
            const preset = getDayPreset(entry.days)
            return (
              <div key={index}>
                <SettingDivider />
                <SettingRow>
                  <Input
                    type="time"
                    className="w-32"
                    aria-label={t('settings.data.backup.schedule.time')}
                    value={entry.time}
                    disabled={disabled}
                    onChange={(event) =>
                      isValidScheduleTime(event.target.value) && updateEntry(index, { time: event.target.value })
                    }
                  />
                  <div className="flex items-center gap-2">
                    <Selector
                      aria-label={t('settings.data.backup.schedule.days.label')}
                      size={14}
                      value={preset}
                      onChange={(value: DayPreset) => changePreset(index, value)}
                      disabled={disabled}
                      options={presetOptions}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('settings.data.backup.schedule.remove')}
                      disabled={disabled}
                      onClick={() => updateEntries(schedule.entries.filter((_, i) => i !== index))}>
                      <X size={14} />
                    </Button>
                  </div>
                </SettingRow>
                {preset !== 'every' && (
                  <div className="mt-2 flex justify-end gap-1">
                    {ALL_DAYS.map((day) => (
                      <Button
                        key={day}
                        size="sm"
                        variant={entry.days.includes(day) ? 'default' : 'outline'}
                        disabled={disabled}
                        aria-pressed={entry.days.includes(day)}
                        onClick={() => toggleDay(index, day)}>
                        {weekdayName(i18n.language, day, 'short')}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.data.backup.schedule.times_label')}</SettingRowTitle>
            <Button variant="outline" disabled={disabled} onClick={addEntry}>
              <Plus size={14} />
              {t('settings.data.backup.schedule.add')}
            </Button>
          </SettingRow>
          <SettingRow>
            <SettingHelpText>{renderNextBackup()}</SettingHelpText>
          </SettingRow>
        </>
      )}
    </>
  )
}

export default BackupScheduleSettings
