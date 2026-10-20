import { type SetStateAction, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@cherrystudio/ui'
import { useModels } from '@renderer/hooks/useModel'
import { useProvider } from '@renderer/hooks/useProvider'
import { toast } from '@renderer/services/toast'
import type { Provider } from '@shared/data/types/provider'
import { ProviderBillingSchema, type ProviderBilling } from '@shared/data/types/providerBilling'

import ProviderSettingsDrawer from '../primitives/ProviderSettingsDrawer'
import { BillingField } from './BillingField'
import { BillingPeriodEditor } from './BillingPeriodEditor'
import { BillingPreview } from './BillingPreview'
import { billingUtcOffset, billingUtcOffsets } from './billingTimeZone'

type BillingDraft = Omit<ProviderBilling, 'periods'> & {
  periods: Array<Extract<ProviderBilling['periods'][number], { mode: 'multiplier' }>>
}

const defaultBilling = (): BillingDraft => ({
  defaultMultiplier: 1,
  scheduleEnabled: false,
  timeZone: billingUtcOffset(),
  periods: []
})

export default function ProviderBillingDrawer({ provider, onClose }: { provider: Provider; onClose: () => void }) {
  const { t } = useTranslation()
  const { updateProvider } = useProvider(provider.id)
  const { models } = useModels({ providerId: provider.id })
  const [draft, setDraftValue] = useState<BillingDraft>(() => {
    const billing = provider.settings.billing ?? defaultBilling()
    return {
      ...billing,
      timeZone: billingUtcOffset(billing.timeZone),
      periods: billing.periods.map(({ id, start, end, ...rule }) => ({
        id,
        name: `${start}–${end}`,
        start,
        end,
        mode: 'multiplier',
        multiplier: rule.mode === 'multiplier' ? rule.multiplier : billing.defaultMultiplier
      }))
    }
  })
  const [resetRequested, setResetRequested] = useState(false)
  const setDraft = (value: SetStateAction<BillingDraft>) => {
    setResetRequested(false)
    setDraftValue(value)
  }
  const [saving, setSaving] = useState(false)
  const parsed = ProviderBillingSchema.safeParse(draft)
  const errors: Record<string, string> = {}
  const errorMessages = {
    overlap: t('settings.provider.billing.overlap'),
    same_time: t('settings.provider.billing.same_time'),
    invalid_zone: t('settings.provider.billing.invalid_zone'),
    invalid: t('settings.provider.billing.invalid')
  }
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const key =
        issue.message === 'overlap'
          ? 'overlap'
          : issue.message === 'same_time'
            ? 'same_time'
            : issue.message === 'time_zone'
              ? 'invalid_zone'
              : 'invalid'
      errors[issue.path.join('.')] = errorMessages[key]
    }
  const save = async () => {
    if (!parsed.success) return
    setSaving(true)
    try {
      await updateProvider({ providerSettings: { billing: resetRequested ? null : parsed.data } })
      onClose()
    } catch {
      toast.error(t('settings.provider.save_failed'))
    } finally {
      setSaving(false)
    }
  }
  return (
    <ProviderSettingsDrawer
      open
      onClose={() => {
        if (!saving) onClose()
      }}
      title={t('settings.provider.billing.title')}
      description={t('settings.provider.billing.description')}
      contentClassName="w-[min(40rem,calc(100vw-2rem))]"
      footer={
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => {
              setDraftValue(defaultBilling())
              setResetRequested(true)
            }}>
            {t('common.reset')}
          </Button>
          <Button variant="outline" className="ml-auto" disabled={saving} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={saving || !parsed.success} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </div>
      }>
      {provider.reportsActualCost && (
        <p className="text-sm text-muted-foreground">{t('settings.provider.billing.reported_first')}</p>
      )}
      <BillingField label={t('settings.provider.billing.default_multiplier')} error={errors.defaultMultiplier}>
        <Input
          type="number"
          min={0}
          step="any"
          aria-label={t('settings.provider.billing.default_multiplier')}
          aria-invalid={!!errors.defaultMultiplier}
          value={Number.isNaN(draft.defaultMultiplier) ? '' : draft.defaultMultiplier}
          onChange={(event) =>
            setDraft({ ...draft, defaultMultiplier: event.target.value === '' ? NaN : Number(event.target.value) })
          }
        />
      </BillingField>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">{t('settings.provider.billing.schedule')}</span>
        <Switch
          aria-label={t('settings.provider.billing.schedule')}
          checked={draft.scheduleEnabled}
          onCheckedChange={(scheduleEnabled) => setDraft({ ...draft, scheduleEnabled })}
        />
      </div>
      {draft.scheduleEnabled && (
        <>
          <BillingField label={t('settings.provider.billing.time_zone')} error={errors.timeZone}>
            <Select value={draft.timeZone} onValueChange={(timeZone) => setDraft({ ...draft, timeZone })}>
              <SelectTrigger aria-label={t('settings.provider.billing.time_zone')} aria-invalid={!!errors.timeZone}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(!billingUtcOffsets.includes(draft.timeZone)
                  ? [draft.timeZone, ...billingUtcOffsets]
                  : billingUtcOffsets
                ).map((offset) => (
                  <SelectItem key={offset} value={offset}>{`UTC${offset}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </BillingField>
          <p className="text-xs text-muted-foreground">{t('settings.provider.billing.time_help')}</p>
          {draft.periods.map((period, index) => (
            <BillingPeriodEditor
              key={period.id}
              period={period}
              errors={errors}
              path={`periods.${index}`}
              onChange={(next) =>
                setDraft((current) => ({
                  ...current,
                  periods: current.periods.map((item) => (item.id === period.id ? next : item))
                }))
              }
              onRemove={() =>
                setDraft((current) => ({
                  ...current,
                  periods: current.periods.filter((item) => item.id !== period.id)
                }))
              }
            />
          ))}
          <Button
            variant="outline"
            onClick={() =>
              setDraft({
                ...draft,
                periods: [
                  ...draft.periods,
                  {
                    id: crypto.randomUUID(),
                    name: '00:00–24:00',
                    start: '00:00',
                    end: '24:00',
                    mode: 'multiplier',
                    multiplier: 1
                  }
                ]
              })
            }>
            {t('settings.provider.billing.add_period')}
          </Button>
        </>
      )}
      {!draft.scheduleEnabled && !parsed.success && (
        <p role="alert" className="text-xs text-error">
          {t('settings.provider.billing.invalid_schedule')}
        </p>
      )}
      {parsed.success && <BillingPreview billing={parsed.data} models={models} />}
    </ProviderSettingsDrawer>
  )
}
