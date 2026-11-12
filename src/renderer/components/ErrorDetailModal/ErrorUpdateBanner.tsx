import { AlertCircle, Download, Info } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { updateNoticeIsFailure } from '@renderer/hooks/useAppUpdateCheck'
import { officialDownloadUrl } from '@renderer/services/AppUpdateCheckService'
import { openExternalWebsite } from '@renderer/services/website'
import type { CacheAppUpdateState } from '@shared/data/cache/cacheValueTypes'

const logger = loggerService.withContext('ErrorUpdateBanner')

interface ErrorUpdateBannerProps {
  readonly appUpdateState: CacheAppUpdateState
  readonly noticeKey: string | null
  readonly onRetry: () => void
  /** Newer version found by the automatic check-only query when the dialog opened. */
  readonly availableVersion: string | null
  readonly onUpdate: () => void
}

/** Update check result or download progress, shown above the diagnostics only while there is something to say. */
export function ErrorUpdateBanner({
  appUpdateState,
  noticeKey,
  onRetry,
  availableVersion,
  onUpdate
}: ErrorUpdateBannerProps) {
  const { t } = useTranslation()
  const [releasesOpenFailed, setReleasesOpenFailed] = useState(false)

  const openOfficialReleases = () => {
    setReleasesOpenFailed(false)
    void openExternalWebsite(officialDownloadUrl()).catch((error: unknown) => {
      logger.error('Failed to open official releases', error as Error)
      setReleasesOpenFailed(true)
    })
  }

  if (noticeKey) {
    const failed = updateNoticeIsFailure(noticeKey)
    const checkFailed = noticeKey === 'settings.about.updateError'
    return (
      <div className="space-y-1.5 rounded-lg border border-border-subtle bg-background-subtle px-3 py-2 text-xs text-foreground">
        <div className="flex flex-wrap items-center gap-2">
          {checkFailed ? (
            <AlertCircle size={14} className="shrink-0 text-error" aria-hidden />
          ) : (
            <Info size={14} className="shrink-0 text-muted-foreground" aria-hidden />
          )}
          <p role={failed ? 'alert' : 'status'} className="min-w-0 flex-1">
            {checkFailed ? t('error.update_banner.failed') : t(noticeKey)}
          </p>
          {failed ? (
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={openOfficialReleases}>
                {t('error.update_banner.open_releases')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={appUpdateState.downloading}
                loading={appUpdateState.checking}
                onClick={onRetry}>
                {t('common.retry')}
              </Button>
            </div>
          ) : null}
        </div>
        {failed && releasesOpenFailed ? (
          <p role="alert" className="text-error">
            {t('chat.artifacts.preview.openExternal.error.content')}
          </p>
        ) : null}
      </div>
    )
  }

  if (appUpdateState.downloading && appUpdateState.downloadProgress > 0) {
    const percent = Math.floor(appUpdateState.downloadProgress)
    const version = appUpdateState.info?.version
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-lg border border-border-subtle bg-background-subtle px-3 py-2 text-xs text-muted-foreground">
        <Download size={14} className="shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          {version ? t('error.update_banner.downloading', { version }) : t('settings.about.downloading')}
        </span>
        <div className="h-1 w-30 shrink-0 overflow-hidden rounded-full bg-secondary">
          <div className="h-full bg-foreground" style={{ width: `${percent}%` }} />
        </div>
        <span className="shrink-0 tabular-nums">{percent}%</span>
      </div>
    )
  }

  const readyVersion = appUpdateState.downloaded ? (appUpdateState.info?.version ?? availableVersion) : availableVersion
  if (readyVersion) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-lg border border-border-subtle bg-background-subtle px-3 py-2 text-xs text-foreground">
        <Info size={14} className="shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">{t('error.update_banner.available', { version: readyVersion })}</span>
        <Button
          size="sm"
          className="shrink-0"
          loading={appUpdateState.checking || appUpdateState.downloading}
          onClick={onUpdate}>
          {t('notification.center.update_now')}
        </Button>
      </div>
    )
  }

  return null
}
