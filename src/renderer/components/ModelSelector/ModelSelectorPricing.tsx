import { useTranslation } from 'react-i18next'

import { CURRENCY, parseUniqueModelId, type Model, type RuntimeModelPricing } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { resolveProviderBilling } from '@shared/utils/providerBilling'
import { getDefaultProviderBilling } from '@shared/utils/providerBillingDefaults'

const validRate = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value) && value >= 0

export function ModelSelectorPricing({
  model,
  provider,
  referenceTime
}: {
  model: Model
  provider?: Provider
  referenceTime: Date
}) {
  const { t, i18n } = useTranslation()
  const billing = provider ? (provider.settings?.billing ?? getDefaultProviderBilling(provider, model)) : undefined
  const { pricing } = resolveProviderBilling(
    model.pricing,
    billing,
    model.apiModelId ?? parseUniqueModelId(model.id).modelId,
    referenceTime
  )
  const format = (value: number | null | undefined) =>
    validRate(value)
      ? new Intl.NumberFormat(i18n.language, { maximumSignificantDigits: 12 }).format(value)
      : t('models.reference_price.unavailable')
  const tokenKeys = ['input', 'output', 'cacheRead', 'cacheWrite'] as const
  const tokenLabels = [
    'models.price.input',
    'models.price.output',
    'models.price.cache_read',
    'models.price.cache_write'
  ]
  const rates = (tier: Pick<RuntimeModelPricing, (typeof tokenKeys)[number]>) => (
    <dl className="space-y-1.5">
      {tokenKeys.map((key, index) => (
        <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 text-xs leading-5">
          <dt className="break-words text-muted-foreground">{t(tokenLabels[index])}</dt>
          <dd className="min-w-0 text-right break-words text-foreground tabular-nums">
            {validRate(tier[key]?.perMillionTokens)
              ? `${tier[key]?.currency ?? CURRENCY.USD} ${format(tier[key]?.perMillionTokens)}`
              : t('models.reference_price.unavailable')}
          </dd>
        </div>
      ))}
    </dl>
  )
  const explicitCurrencies = pricing
    ? [pricing, ...(pricing.inputTokenTiers ?? [])].flatMap((tier) =>
        tokenKeys.flatMap((key) => (tier[key]?.currency ? [tier[key]!.currency!] : []))
      )
    : []
  const nonTokenCurrency =
    explicitCurrencies.length > 0 && explicitCurrencies.every((value) => value === explicitCurrencies[0])
      ? explicitCurrencies[0]
      : t('models.reference_price.currency_unspecified')

  return (
    <section aria-label={t('models.reference_price.title')} className="mt-3 space-y-2 border-t border-border pt-3">
      <h3 className="text-xs font-medium">{t('models.reference_price.title')}</h3>
      <p className="text-xs text-muted-foreground">
        {model.hasCustomPricing ? t('models.reference_price.custom') : t('models.reference_price.configured')}
        {!provider ? ` · ${t('models.reference_price.unadjusted')}` : null}
      </p>
      {billing ? (
        <p className="text-xs break-words text-muted-foreground">
          {t('models.reference_price.as_of', { time: referenceTime.toLocaleString(i18n.language) })}
        </p>
      ) : null}
      {pricing ? (
        <>
          <p className="text-xs text-muted-foreground">{t('models.reference_price.token_unit')}</p>
          {rates(pricing)}
          {pricing.inputTokenTiers?.map((tier) => (
            <div key={tier.minInputTokens} className="space-y-1.5 border-t border-border pt-2">
              <p className="text-xs font-medium">
                {t('models.price.tier_from', { boundary: tier.minInputTokens.toLocaleString(i18n.language) })}
              </p>
              {rates(tier)}
            </div>
          ))}
          {[
            {
              key: pricing.perImage?.unit === 'pixel' ? 'models.reference_price.pixel' : 'models.reference_price.image',
              value: pricing.perImage?.price
            },
            { key: 'models.reference_price.minute', value: pricing.perMinute?.price }
          ].map(({ key, value }) =>
            value != null ? (
              <p key={key} className="text-xs break-words text-foreground">
                {t(key)}: {validRate(value) ? `${nonTokenCurrency} ${format(value)}` : format(value)}
              </p>
            ) : null
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{t('models.reference_price.unavailable')}</p>
      )}
      <p className="text-xs text-muted-foreground">{t('models.reference_price.disclaimer')}</p>
    </section>
  )
}
