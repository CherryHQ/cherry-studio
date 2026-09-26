import dayjs from 'dayjs'
import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useSharedCacheSelector } from '@data/hooks/useCache'
import { useMultiplePreferences } from '@data/hooks/usePreference'
import { SettingGroup } from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import { AUTO_BACKUP_TYPES, type AutoBackupEvent, type AutoBackupType } from '@shared/types/backup'

const STATE_KEYS = AUTO_BACKUP_TYPES.map((type) => `backup.auto_sync.state.${type}` as const)

/** The timestamp a backup event carries, if it got far enough to have one. */
function successAt(event: AutoBackupEvent | null | undefined): number | undefined {
  if (!event) return undefined
  return event.status === 'succeeded' || event.status === 'warning' ? event.timestamp : undefined
}

/**
 * What is protected right now, said plainly at the top of the data screen.
 *
 * This fork exists because two weeks of work were lost once. Backups being switched on is not
 * the same as the user knowing they are — nothing on this screen said when the last one ran, or
 * that none had. Risk that is invisible does not get acted on.
 */
export function BackupProtectionSummary() {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [enabled] = useMultiplePreferences({
    local: 'data.backup.local.auto_sync',
    webdav: 'data.backup.webdav.auto_sync',
    s3: 'data.backup.s3.auto_sync',
    nutstore: 'data.backup.nutstore.auto_sync'
  })
  const events = useSharedCacheSelector(STATE_KEYS, (values) => values as Array<AutoBackupEvent | null>)

  const { enabledTypes, lastSuccess } = useMemo(() => {
    const on = AUTO_BACKUP_TYPES.filter((type) => enabled[type as AutoBackupType] === true)
    const times = AUTO_BACKUP_TYPES.map((type, index) =>
      enabled[type as AutoBackupType] === true ? successAt(events?.[index]) : undefined
    ).filter((time): time is number => time !== undefined)
    return { enabledTypes: on, lastSuccess: times.length > 0 ? Math.max(...times) : undefined }
  }, [enabled, events])

  const state = enabledTypes.length === 0 ? 'off' : lastSuccess === undefined ? 'pending' : 'ok'
  const Icon = state === 'ok' ? ShieldCheck : state === 'pending' ? ShieldQuestion : ShieldAlert
  const tone = state === 'ok' ? 'text-success' : state === 'pending' ? 'text-muted-foreground' : 'text-error'

  const headline =
    state === 'ok'
      ? t('settings.data.protection.last_backup', { when: dayjs(lastSuccess).format('YYYY-MM-DD HH:mm') })
      : state === 'pending'
        ? t('settings.data.protection.not_yet')
        : t('settings.data.protection.none')

  return (
    <SettingGroup theme={theme}>
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 size-5 shrink-0 ${tone}`} aria-hidden />
        <div className="min-w-0">
          <div className={`text-sm ${state === 'off' ? 'text-error' : ''}`}>{headline}</div>
          <div className="mt-1 text-muted-foreground text-xs leading-5">
            {state === 'off' ? t('settings.data.protection.none_hint') : t('settings.data.protection.covers')}
          </div>
        </div>
      </div>
    </SettingGroup>
  )
}
