import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Input,
  PageSidePanelSection,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@cherrystudio/ui'
import { type Model, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { billingTimeMinutes, type ProviderBilling } from '@shared/data/types/providerBilling'
import { resolveProviderBilling } from '@shared/utils/providerBilling'
import { getDefaultProviderBilling } from '@shared/utils/providerBillingDefaults'
import { createAiUsagePricingSnapshot } from '@shared/utils/usagePricing'

dayjs.extend(utc)
dayjs.extend(timezone)

const formatTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

export function BillingPreview({
  billing,
  models,
  defaultProvider
}: {
  billing: ProviderBilling
  models: readonly Model[]
  defaultProvider?: Provider
}) {
  const { t } = useTranslation()
  const [modelId, setModelId] = useState<string>(models[0]?.id ?? '')
  const model = models.find((item) => item.id === modelId) ?? models[0]
  const effectiveBilling = defaultProvider && model ? getDefaultProviderBilling(defaultProvider, model) : billing
  const [date, setDate] = useState('')
  const boundaries = [
    ...new Set([
      0,
      1440,
      ...(effectiveBilling?.scheduleEnabled
        ? effectiveBilling.periods.flatMap((period) => [
            billingTimeMinutes(period.start),
            billingTimeMinutes(period.end)
          ])
        : [])
    ])
  ].sort((a, b) => a - b)
  const now = dayjs().tz(billing.timeZone)
  const today = now.format('YYYY-MM-DD')
  const currentMinute = now.hour() * 60 + now.minute()
  const day = dayjs.tz(date || today, billing.timeZone).startOf('day')
  const ranges = boundaries.slice(0, -1).map((start, index) => {
    const resolved = resolveProviderBilling(
      model?.pricing,
      effectiveBilling,
      model ? parseUniqueModelId(model.id).modelId : '',
      day.add(start, 'minute').toDate()
    )
    return {
      start,
      end: boundaries[index + 1],
      periodId: resolved.billing?.periodId,
      snapshot: createAiUsagePricingSnapshot(resolved.pricing)
    }
  })
  for (let index = ranges.length - 1; index > 0; index--) {
    if (ranges[index].periodId === ranges[index - 1].periodId) {
      ranges[index - 1].end = ranges[index].end
      ranges.splice(index, 1)
    }
  }
  const first = ranges[0]
  const last = ranges.at(-1)!
  if (ranges.length > 1 && first.periodId === last.periodId) {
    last.end = first.end
    ranges.shift()
  }
  const currency = ranges.find((range) => range.snapshot)?.snapshot?.currency
  return (
    <PageSidePanelSection
      role="region"
      title={t('settings.provider.billing.preview')}
      aria-label={t('settings.provider.billing.preview')}>
      <Input
        type="date"
        aria-label={t('settings.provider.billing.preview_date')}
        value={date || today}
        onChange={(event) => setDate(event.target.value)}
      />
      <Select value={model?.id ?? ''} onValueChange={setModelId}>
        <SelectTrigger aria-label={t('settings.provider.billing.model')}>
          <SelectValue placeholder={t('settings.provider.billing.model')} />
        </SelectTrigger>
        <SelectContent>
          {models.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>{`UTC${billing.timeZone}`}</span>
        {currency && <span>{`${currency} / ${t('models.price.million_tokens')}`}</span>}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('settings.provider.billing.period')}</TableHead>
            <TableHead className="text-right">{t('models.price.input')}</TableHead>
            <TableHead className="text-right">{t('models.price.output')}</TableHead>
            <TableHead className="text-right">{t('models.price.cache_read')}</TableHead>
            <TableHead className="text-right">{t('models.price.cache_write')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody aria-live="polite">
          {ranges.flatMap(({ start, end, snapshot }) => {
            const current =
              (!date || date === today) &&
              (end > start
                ? currentMinute >= start && currentMinute < end
                : currentMinute >= start || currentMinute < end)
            const tiers = [{ ...snapshot, minInputTokens: 0 }, ...(snapshot?.inputTokenTiers ?? [])]
            return tiers.map((tier) => {
              const rates = {
                input: tier.inputPerMillionTokens,
                output: tier.outputPerMillionTokens,
                cacheRead: tier.cacheReadPerMillionTokens ?? tier.inputPerMillionTokens,
                cacheWrite: tier.cacheWritePerMillionTokens ?? tier.inputPerMillionTokens
              }
              return (
                <TableRow
                  key={`${start}:${tier.minInputTokens}`}
                  title={current ? t('common.current') : undefined}
                  aria-current={current ? 'time' : undefined}
                  className={current ? 'bg-background-subtle' : undefined}>
                  <TableCell>
                    <span className="whitespace-nowrap tabular-nums">{`${formatTime(start)}–${formatTime(end)}`}</span>
                    {tiers.length > 1 && (
                      <p className="text-xs text-muted-foreground">
                        {t('models.price.tier_from', { boundary: tier.minInputTokens })}
                      </p>
                    )}
                  </TableCell>
                  {Object.entries(rates).map(([key, rate]) => (
                    <TableCell key={key} className="text-right tabular-nums">
                      {rate == null ? t('settings.provider.billing.unpriced') : Number(rate.toPrecision(12))}
                    </TableCell>
                  ))}
                </TableRow>
              )
            })
          })}
        </TableBody>
      </Table>
    </PageSidePanelSection>
  )
}
