import { useTranslation } from 'react-i18next'

import { Button, Input } from '@cherrystudio/ui'
import type { ProviderBillingPeriod } from '@shared/data/types/providerBilling'

import { BillingField } from './BillingField'
import { BillingTimePicker } from './BillingTimePicker'

export function BillingPeriodEditor({
  period,
  errors,
  path,
  onChange,
  onRemove
}: {
  period: Extract<ProviderBillingPeriod, { mode: 'multiplier' }>
  errors: Record<string, string>
  path: string
  onChange: (period: Extract<ProviderBillingPeriod, { mode: 'multiplier' }>) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const timeLabels = { start: t('settings.provider.billing.start'), end: t('settings.provider.billing.end') }
  return (
    <section aria-label={`${period.start}–${period.end}`} className="space-y-4 border-t border-border-subtle pt-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{t('settings.provider.billing.period')}</span>
        <Button variant="ghost" onClick={onRemove}>
          {t('common.delete')}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {(['start', 'end'] as const).map((field) => (
          <BillingField key={field} label={timeLabels[field]} error={errors[`${path}.${field}`]}>
            <BillingTimePicker
              label={timeLabels[field]}
              invalid={!!errors[`${path}.${field}`]}
              allowEndOfDay={field === 'end'}
              value={period[field]}
              onChange={(value) =>
                onChange({
                  ...period,
                  [field]: value,
                  name: field === 'start' ? `${value}–${period.end}` : `${period.start}–${value}`
                })
              }
            />
          </BillingField>
        ))}
      </div>
      <BillingField label={t('settings.provider.billing.multiplier')} error={errors[`${path}.multiplier`]}>
        <Input
          type="number"
          step="any"
          min={0}
          aria-label={t('settings.provider.billing.multiplier')}
          value={Number.isNaN(period.multiplier) ? '' : period.multiplier}
          onChange={(event) =>
            onChange({ ...period, multiplier: event.target.value === '' ? NaN : Number(event.target.value) })
          }
        />
        <p className="text-xs text-muted-foreground">{t('settings.provider.billing.multiplier_help')}</p>
      </BillingField>
    </section>
  )
}
