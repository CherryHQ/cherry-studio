import { Bell, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { useMultiplePreferences } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'

const logger = loggerService.withContext('NotificationPrimingBanner')

/**
 * Dismissible prompt above the composer that nudges the user to turn on system notifications.
 * "Allow" enables the agent notification toggles and fires one OS notification, which is what
 * makes the OS ask for notification permission. Renders via `ComposerSurface.queueContent`.
 */
export function NotificationPrimingBanner() {
  const { t } = useTranslation()
  const [prefs, setPrefs] = useMultiplePreferences({
    completion: 'app.notification.assistant.enabled',
    approval: 'app.notification.approval.enabled',
    scheduledTask: 'app.notification.scheduled_task.enabled',
    dismissed: 'app.notification.priming_banner.dismissed'
  })

  if (prefs.dismissed || prefs.completion || prefs.approval || prefs.scheduledTask) return null

  const handleAllow = () => {
    void setPrefs({ completion: true, approval: true, scheduledTask: true, dismissed: true })
      .then(() =>
        ipcApi.request('notification.send', {
          id: 'notification-priming-enabled',
          type: 'success',
          title: t('notification.priming.enabled_title'),
          message: t('notification.priming.enabled_message'),
          timestamp: Date.now(),
          source: 'assistant'
        })
      )
      .catch((error) => logger.error('Failed to enable notifications', error as Error))
  }

  const handleDismiss = () => {
    void setPrefs({ dismissed: true }).catch((error) =>
      logger.error('Failed to dismiss notification banner', error as Error)
    )
  }

  return (
    <div
      role="region"
      aria-label={t('notification.priming.title')}
      className="relative mx-2 mb-1.5 flex items-center gap-2 rounded-2xl border-[0.5px] border-border bg-background/90 p-1.5 pl-3 backdrop-blur">
      <Bell className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground text-xs">{t('notification.priming.title')}</div>
        <div className="truncate text-muted-foreground text-xs">{t('notification.priming.description')}</div>
      </div>
      <Button type="button" size="sm" className="h-7 min-h-0 px-3 text-xs" onClick={handleAllow}>
        {t('notification.priming.allow')}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-7 min-h-0 shrink-0 text-muted-foreground shadow-none"
        aria-label={t('common.close')}
        onClick={handleDismiss}>
        <X className="size-3.5" />
      </Button>
    </div>
  )
}
