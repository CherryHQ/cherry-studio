import { Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { useCommandRuntime } from '@renderer/hooks/command'
import type { CherryCloudQuotaExhaustion } from '@renderer/hooks/useCherryCloudQuotaExhaustion'
import { startCherryCloudSubscription } from '@renderer/services/cherryCloudSubscription'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'

/** Sits above the composer input while the current Cherry Cloud model is out of quota. */
export function CherryCloudQuotaNotice({ exhaustion }: { exhaustion: CherryCloudQuotaExhaustion }) {
  const { t, i18n } = useTranslation()
  const commandRuntime = useCommandRuntime()
  const offerSubscription = exhaustion.isFreeModel && !exhaustion.isSubscribed

  return (
    <div
      role="status"
      data-ui="chat.composer.quota-notice"
      className="relative mx-2 mb-1.5 flex items-center gap-2 border-[0.5px] border-border p-1.5 pl-3 backdrop-blur"
      style={{ borderRadius: 16, backgroundColor: 'color-mix(in srgb, var(--background) 88%, transparent)' }}>
      <Clock className="size-3.5 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 flex-1 truncate text-xs text-foreground">
        {t(exhaustion.isFreeModel ? 'models.detail.free_quota_exhausted' : 'models.detail.quota_exhausted')}
        {exhaustion.recoversAt ? (
          <span className="ml-1.5 text-muted-foreground">
            {t('settings.subscription.next_recovery', {
              time: new Date(exhaustion.recoversAt).toLocaleString(i18n.language)
            })}
          </span>
        ) : null}
      </div>
      <Button
        type="button"
        size="sm"
        variant={offerSubscription ? 'default' : 'outline'}
        onClick={() =>
          offerSubscription ? void startCherryCloudSubscription() : openSettingsTab('/settings/profile')
        }>
        {t(offerSubscription ? 'settings.subscription.go_to_subscribe' : 'settings.subscription.view_usage')}
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={() => commandRuntime.execute('chat.model.select')}>
        {t('chat.input.quota_notice.switch_model')}
      </Button>
    </div>
  )
}
