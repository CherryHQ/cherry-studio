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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@cherrystudio/ui'
import { type Model, parseUniqueModelId } from '@shared/data/types/model'
import { billingTimeMinutes, type ProviderBilling } from '@shared/data/types/providerBilling'
import { resolveProviderBilling } from '@shared/utils/providerBilling'
import { createAiUsagePricingSnapshot } from '@shared/utils/usagePricing'

dayjs.extend(utc)
dayjs.extend(timezone)

const formatTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

export function BillingPreview({ billing, models }: { billing: ProviderBilling; models: readonly Model[] }) {
  const { t } = useTranslation()
  const [modelId, setModelId] = useState<string>(models[0]?.id ?? '')
  const model = models.find((item) => item.id === modelId) ?? models[0]
  const boundaries = [
    ...new Set([
      0,
      1440,
      ...(billing.scheduleEnabled
        ? billing.periods.flatMap((period) => [billingTimeMinutes(period.start), billingTimeMinutes(period.end)])
        : [])
    ])
  ].sort((a, b) => a - b)
  const day = dayjs().tz(billing.timeZone).startOf('day')
  const ranges = boundaries.slice(0, -1).map((start, index) => {
    const resolved = resolveProviderBilling(
      model?.pricing,
      billing,
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
  const first = ranges[0]
  const last = ranges.at(-1)!
  if (ranges.length > 1 && first.periodId === last.periodId) {
    last.end = first.end
    ranges.shift()
  }
  const currency = ranges.find((range) => range.snapshot)?.snapshot?.currency
  return (
    <section
      className="space-y-3 border-t border-border-subtle pt-4"
      aria-label={t('settings.provider.billing.preview')}>
      <h3 className="text-sm font-medium">{t('settings.provider.billing.preview')}</h3>
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
            const tiers = [{ ...snapshot, minInputTokens: 0 }, ...(snapshot?.inputTokenTiers ?? [])]
            return tiers.map((tier) => {
              const rates = {
                input: tier.inputPerMillionTokens,
                output: tier.outputPerMillionTokens,
                cacheRead: tier.cacheReadPerMillionTokens ?? tier.inputPerMillionTokens,
                cacheWrite: tier.cacheWritePerMillionTokens ?? tier.inputPerMillionTokens
              }
              return (
                <TableRow key={`${start}:${tier.minInputTokens}`}>
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
    </section>
  )
}
