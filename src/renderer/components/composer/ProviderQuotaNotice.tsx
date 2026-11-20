import { Clock } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { useCommandRuntime } from '@renderer/hooks/command'
import { useCherryCloudSubscriptionOffer } from '@renderer/hooks/useCherryCloudPlans'
import { startCherryCloudSubscription } from '@renderer/services/cherryCloudSubscription'
import { trackSubscriptionEntryView } from '@renderer/services/cherryCloudSubscriptionAnalytics'

/** Sits above the composer after a third-party provider ran out of quota, suggesting a Cherry AI plan. */
export function ProviderQuotaNotice() {
  const { t } = useTranslation()
  const commandRuntime = useCommandRuntime()
  const offerSubscription = useCherryCloudSubscriptionOffer(true)

  useEffect(() => {
    if (offerSubscription) trackSubscriptionEntryView('provider_quota_notice')
  }, [offerSubscription])

  if (!offerSubscription) return null

  return (
    <div
      role="status"
      data-ui="chat.composer.provider-quota-notice"
      className="relative mx-2 mb-1.5 flex items-center gap-2 border-[0.5px] border-border p-1.5 pl-3 backdrop-blur"
      style={{ borderRadius: 16, backgroundColor: 'color-mix(in srgb, var(--background) 88%, transparent)' }}>
      <Clock className="size-3.5 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 flex-1 truncate text-xs text-foreground">
        {t('chat.input.quota_notice.provider_quota')}
      </div>
      <Button type="button" size="sm" onClick={() => void startCherryCloudSubscription('provider_quota_notice')}>
        {t('settings.subscription.go_to_subscribe')}
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={() => commandRuntime.execute('chat.model.select')}>
        {t('chat.input.quota_notice.switch_model')}
      </Button>
    </div>
  )
}
