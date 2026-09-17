// Free tiers the provider never reports: the ceiling is declared here, and credential selection
// skips a key that already reached it. Empty means unlimited, which is the default.

import { useTranslation } from 'react-i18next'

import { InputNumber } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import Selector from '@renderer/components/Selector'
import { apiKeyLimitId } from '@shared/utils/apiKeyLimit'

interface Props {
  providerId: string
  keyId: string
}

export const ApiKeyQuotaLimit = ({ providerId, keyId }: Props) => {
  const { t } = useTranslation()
  const [storedLimits, setLimits] = usePreference('chat.routing.api_key_limits')
  // Preferences read as null until the store hydrates, and this drawer renders before that.
  const limits = storedLimits ?? {}
  const entry = limits[apiKeyLimitId(providerId, keyId)]

  const update = (next: { limit: number; period: 'daily' | 'monthly' } | undefined) => {
    const id = apiKeyLimitId(providerId, keyId)
    const { [id]: _removed, ...rest } = limits
    void setLimits(next ? { ...rest, [id]: next } : rest)
  }

  return (
    <div className="flex items-center gap-2 px-4 pb-2">
      <span className="text-muted-foreground text-xs">{t('settings.provider.api_key.quota_limit')}</span>
      <div className="w-[110px]">
        <InputNumber
          min={1}
          step={1}
          className="h-7 rounded-lg px-2"
          placeholder={t('settings.provider.api_key.quota_unlimited')}
          aria-label={t('settings.provider.api_key.quota_limit')}
          value={entry?.limit ?? null}
          onBlur={(value) => update(value ? { limit: value, period: entry?.period ?? 'daily' } : undefined)}
        />
      </div>
      <Selector
        value={entry?.period ?? 'daily'}
        options={[
          { value: 'daily', label: t('settings.provider.api_key.quota_daily') },
          { value: 'monthly', label: t('settings.provider.api_key.quota_monthly') }
        ]}
        onChange={(period: 'daily' | 'monthly') => entry && update({ limit: entry.limit, period })}
      />
    </div>
  )
}
