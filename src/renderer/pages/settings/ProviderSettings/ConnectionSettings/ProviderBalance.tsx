import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { useProvider } from '@renderer/hooks/useProvider'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useProviderBalance } from '../hooks/providerSetting/useProviderBalance'
import { balanceErrorKeys } from '../utils/providerBalance'
import { ProviderBalanceConfigDrawer } from './ProviderBalanceConfigDrawer'

export function ProviderBalance({ providerId }: { providerId: string }) {
  const { provider } = useProvider(providerId)
  const { t, i18n } = useTranslation()
  const [selectedKey, setSelectedKey] = useState<string>()
  const [configOpen, setConfigOpen] = useState(false)
  const keys = provider?.apiKeys.filter((key) => key.isEnabled) ?? []
  const keyId = keys.find((key) => key.id === selectedKey)?.id ?? keys[0]?.id
  const { data, error, isValidating, mutate } = useProviderBalance(providerId, keyId)
  const custom = provider && !provider.presetProviderId && !provider.supportsBalance
  const enabled = provider?.supportsBalance || (custom && provider?.settings.balanceQuery?.enabled)

  if (!provider || provider.authType !== 'api-key' || (!custom && !enabled)) return null

  return (
    <section aria-label={t('settings.provider.balance')} className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <span className="text-muted-foreground text-sm">{t('settings.provider.balance')}</span>
        {keys.length > 1 ? (
          <Select value={keyId} onValueChange={setSelectedKey}>
            <SelectTrigger className="max-w-full" aria-label={t('settings.provider.balance_query.key')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {keys.map((key, index) => (
                <SelectItem key={key.id} value={key.id}>
                  {key.label || t('settings.provider.balance_query.key_number', { number: index + 1 })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {enabled ? (
          <>
            <div role="status" aria-live="polite" className="flex min-w-0 flex-wrap gap-x-3 text-sm tabular-nums">
              {data?.balances.map(({ currency, amount }, index) => (
                <bdi key={`${currency}-${index}`} className="whitespace-nowrap font-medium">
                  {new Intl.NumberFormat(i18n.language, {
                    style: 'currency',
                    currency,
                    currencyDisplay: 'code',
                    maximumFractionDigits: 6
                  }).format(amount)}
                </bdi>
              ))}
              {!keyId
                ? t('settings.provider.balance_query.error_auth')
                : !data && isValidating
                  ? t('common.loading')
                  : null}
            </div>
            <div className="flex items-baseline gap-2">
              <Button
                variant="outline"
                size="sm"
                loading={isValidating}
                loadingIconClassName="motion-reduce:animate-none"
                disabled={!keyId}
                onClick={() => void mutate()}>
                {t('common.refresh')}
              </Button>
              {data?.rechargeUrl ? (
                <Button asChild variant="ghost" size="sm">
                  <a href={data.rechargeUrl} target="_blank" rel="noopener noreferrer">
                    {t('settings.provider.balance_query.recharge')}
                  </a>
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
        {custom ? (
          <Button variant="ghost" size="sm" onClick={() => setConfigOpen(true)}>
            {t('common.settings')}
          </Button>
        ) : null}
      </div>
      {enabled ? (
        <>
          {data ? (
            <p className="text-muted-foreground text-xs">
              {t('settings.provider.balance_query.updated_at', {
                time: new Date(data.updatedAt).toLocaleString(i18n.language)
              })}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-error text-xs">
              {t(balanceErrorKeys[error.code] ?? 'settings.provider.oauth.balance_error')}
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-muted-foreground text-xs">{t('settings.provider.balance_query.configure_hint')}</p>
      )}
      {configOpen ? (
        <ProviderBalanceConfigDrawer
          key={`${keyId}-${provider.updatedAt}`}
          providerId={providerId}
          keyId={keyId}
          onClose={() => setConfigOpen(false)}
        />
      ) : null}
    </section>
  )
}
