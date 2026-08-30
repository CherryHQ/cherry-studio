import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  DateTimePicker,
  HorizontalScrollContainer,
  Input,
  InputGroup,
  InputGroupInput,
  InputGroupText,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  Tooltip
} from '@cherrystudio/ui'
import type { Model } from '@shared/data/types/model'
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Plus, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { drawerClasses } from '../../primitives/ProviderSettingsPrimitives'
import {
  buildModelPricingPatch,
  buildPricingTimeline,
  buildVisualCronExpressions,
  createModelPricingDraft,
  createPricingRuleDraft,
  createPricingTimelineAnchor,
  findModelPricingRuleConflicts,
  MODEL_PRICING_CURRENCY_SYMBOLS,
  type ModelPricingDraft,
  type ModelPricingRuleDraft,
  parseModelPricingDraft,
  parseVisualCronExpressions,
  type PricingMetric,
  type PricingRatesDraft,
  type PricingTimelineSegment
} from './modelPricing'

interface ModelPricingFieldsProps {
  pricing: Model['pricing']
  pricingSource?: Model['pricingSource']
  section: 'base' | 'rules' | 'preview'
  showValidation?: boolean
  onCommit: (pricing: NonNullable<Model['pricing']> | undefined) => void
  onValidityChange?: (valid: boolean) => void
  onRestoreProviderPricing?: () => void
}

type PriceField = keyof PricingRatesDraft
type TranslationFunction = ReturnType<typeof useTranslation>['t']

function priceFieldLabel(field: PriceField, t: TranslationFunction): string {
  switch (field) {
    case 'input':
      return t('models.price.input')
    case 'output':
      return t('models.price.output')
    case 'cacheRead':
      return t('models.price.cache_read')
    case 'cacheWrite':
      return t('models.price.cache_write')
  }
}

function sanitizeDecimal(value: string): string {
  const [integer, ...fractions] = value.replace(/[^\d.]/g, '').split('.')
  return fractions.length ? `${integer}.${fractions.join('')}` : integer
}

function PriceFields({
  value,
  currency,
  errors,
  required,
  onChange
}: {
  value: PricingRatesDraft
  currency: string
  errors?: Record<string, string>
  required?: boolean
  onChange: (value: PricingRatesDraft) => void
}) {
  const { t } = useTranslation()
  const renderFields = (fields: PriceField[]) => (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
      {fields.map((field) => {
        const label = priceFieldLabel(field, t)
        const errorId = `pricing-${field}-error`
        const isRequired = required && (field === 'input' || field === 'output')
        return (
          <label key={field} className="grid min-w-0 gap-1.5 text-muted-foreground text-xs">
            <span>{label}</span>
            <div className="relative min-w-0">
              <Input
                value={value[field]}
                aria-label={label}
                required={isRequired}
                inputMode="decimal"
                aria-invalid={Boolean(errors?.[field])}
                aria-describedby={errors?.[field] ? errorId : undefined}
                placeholder={isRequired ? '0.00' : t('models.price.optional')}
                className={`${drawerClasses.input} pr-24`}
                onChange={(event) => onChange({ ...value, [field]: sanitizeDecimal(event.target.value) })}
              />
              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-muted-foreground text-xs">
                {currency} / {t('models.price.million_tokens')}
              </span>
            </div>
            {errors?.[field] ? (
              <span id={errorId} className={drawerClasses.errorText}>
                {t('models.price.validation_price')}
              </span>
            ) : null}
          </label>
        )
      })}
    </div>
  )

  return renderFields(['input', 'output', 'cacheRead', 'cacheWrite'])
}

function ruleLabel(index: number, t: TranslationFunction): string {
  return t('models.price.rule.item', { index: index + 1 })
}

function parseIsoDate(iso: string): Date | undefined {
  if (!iso) return undefined
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function PricingRuleEditor({
  rule,
  errors,
  currency,
  onChange
}: {
  rule: ModelPricingRuleDraft
  errors: Record<string, string>
  currency: string
  onChange: (rule: ModelPricingRuleDraft) => void
}) {
  const { t } = useTranslation()
  const [scheduleExpanded, setScheduleExpanded] = useState(rule.editor === 'advanced')
  const [advancedExpanded, setAdvancedExpanded] = useState(rule.editor === 'advanced')
  const weekdays = [
    t('agent.tasks.schedule.weekdays.monday'),
    t('agent.tasks.schedule.weekdays.tuesday'),
    t('agent.tasks.schedule.weekdays.wednesday'),
    t('agent.tasks.schedule.weekdays.thursday'),
    t('agent.tasks.schedule.weekdays.friday'),
    t('agent.tasks.schedule.weekdays.saturday'),
    t('agent.tasks.schedule.weekdays.sunday')
  ]
  const hasTokenCondition = Boolean(rule.minInputTokens.trim())
  const hasScheduleCondition = rule.editor === 'visual' || Boolean(rule.cron.trim())
  const hasDateCondition = Boolean(rule.startsAt || rule.endsAt)
  const parsedVisualSchedule = useMemo(
    () =>
      parseVisualCronExpressions(
        rule.cron
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
      ),
    [rule.cron]
  )
  const canUseVisualEditor = rule.editor === 'visual' || !rule.cron.trim() || parsedVisualSchedule !== null
  const timezoneInvalid = Object.keys(errors).some((key) => key.includes('timezone'))

  useEffect(() => {
    if (rule.editor === 'advanced' || timezoneInvalid) setAdvancedExpanded(true)
  }, [rule.editor, timezoneInvalid])

  const addCondition = (condition: 'tokens' | 'schedule' | 'dates') => {
    if (condition === 'tokens') {
      onChange({ ...rule, minInputTokens: '100000' })
      return
    }
    if (condition === 'schedule') {
      setScheduleExpanded(true)
      onChange({ ...rule, editor: 'visual' })
      return
    }
    const startsAt = new Date()
    startsAt.setSeconds(0, 0)
    onChange({
      ...rule,
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 86_400_000).toISOString()
    })
  }

  return (
    <div className="space-y-7">
      <section className="space-y-4" aria-labelledby={`${rule.id}-prices`}>
        <div>
          <h3 id={`${rule.id}-prices`} className="font-medium text-foreground text-sm">
            {t('models.price.rule.override')}
          </h3>
          <p className="mt-1 text-muted-foreground text-xs leading-5">{t('models.price.rule.override_help')}</p>
        </div>
        <PriceFields
          value={rule.pricing}
          currency={currency}
          errors={errors}
          onChange={(pricing) => onChange({ ...rule, pricing })}
        />
      </section>

      <section className="space-y-4 border-border-subtle border-t pt-6" aria-labelledby={`${rule.id}-conditions`}>
        <div>
          <h3 id={`${rule.id}-conditions`} className="font-medium text-foreground text-sm">
            {t('models.price.rule.conditions')}
          </h3>
          <p className="mt-1 text-muted-foreground text-xs leading-5">{t('models.price.rule.conditions_help')}</p>
        </div>
        {!hasTokenCondition && !hasScheduleCondition && !hasDateCondition ? (
          <div className="rounded-xl bg-background-subtle p-4">
            <p className="font-medium text-foreground text-sm">{t('models.price.rule.choose_condition')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => addCondition('schedule')}>
                {t('models.price.rule.time_template')}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => addCondition('tokens')}>
                {t('models.price.rule.tier_template')}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => addCondition('dates')}>
                {t('models.price.rule.date_range')}
              </Button>
            </div>
          </div>
        ) : null}

        {hasTokenCondition ? (
          <div className="rounded-xl bg-background-subtle p-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="font-medium text-foreground text-sm">{t('models.price.rule.tier_template')}</h4>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t('models.price.rule.remove_condition')}
                onClick={() => onChange({ ...rule, minInputTokens: '' })}>
                <X aria-hidden className="size-3.5" />
              </Button>
            </div>
            <label className="mt-3 flex items-center gap-3 text-muted-foreground text-xs">
              <span className="shrink-0">{t('models.price.rule.input_at_least')}</span>
              <Input
                value={rule.minInputTokens}
                inputMode="numeric"
                aria-invalid={Boolean(errors.minInputTokens)}
                className={`${drawerClasses.input} max-w-48`}
                onChange={(event) => onChange({ ...rule, minInputTokens: event.target.value.replace(/\D/g, '') })}
              />
              <span>{t('models.price.rule.tokens')}</span>
            </label>
          </div>
        ) : null}

        {hasScheduleCondition ? (
          <div className="rounded-xl bg-background-subtle p-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="font-medium text-foreground text-sm">{t('models.price.rule.time_template')}</h4>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setScheduleExpanded((expanded) => !expanded)}>
                  {t(scheduleExpanded ? 'common.close' : 'common.edit')}
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('models.price.rule.remove_condition')}
                  onClick={() => onChange({ ...rule, editor: 'advanced', cron: '' })}>
                  <X aria-hidden className="size-3.5" />
                </Button>
              </div>
            </div>
            {!scheduleExpanded && rule.editor === 'visual' ? (
              <p className="mt-2 text-muted-foreground text-xs leading-5">
                {rule.weekdays.map((day) => weekdays[day - 1]?.slice(0, 3)).join(', ')} ·{' '}
                {rule.ranges.map((range) => `${range.start}–${range.end}`).join(', ')}
              </p>
            ) : null}
            {scheduleExpanded && rule.editor === 'visual' ? (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-1.5" aria-label={t('models.price.schedule.weekdays')}>
                  {weekdays.map((label, index) => {
                    const day = index + 1
                    const selected = rule.weekdays.includes(day)
                    return (
                      <Button
                        key={day}
                        type="button"
                        size="sm"
                        variant={selected ? 'secondary' : 'outline'}
                        aria-pressed={selected}
                        onClick={() =>
                          onChange({
                            ...rule,
                            weekdays: selected
                              ? rule.weekdays.filter((value) => value !== day)
                              : [...rule.weekdays, day]
                          })
                        }>
                        {label.slice(0, 3)}
                      </Button>
                    )
                  })}
                </div>
                <div className="space-y-2">
                  <div className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-2 text-muted-foreground text-xs">
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3">
                      <span>{t('models.price.schedule.start_time')}</span>
                      <span aria-hidden />
                      <span>{t('models.price.schedule.end_time')}</span>
                    </div>
                    <span aria-hidden />
                  </div>
                  {rule.ranges.map((range, index) => (
                    <div
                      key={`${rule.id}-range-${index}`}
                      className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-2">
                      <InputGroup>
                        <InputGroupInput
                          type="time"
                          value={range.start}
                          step={60}
                          aria-label={t('models.price.schedule.start_time')}
                          aria-invalid={Boolean(errors.ranges)}
                          className="appearance-none text-center font-mono [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                          onChange={(event) =>
                            onChange({
                              ...rule,
                              ranges: rule.ranges.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, start: event.target.value } : item
                              )
                            })
                          }
                        />
                        <InputGroupText>
                          <ArrowRight aria-hidden className="size-4" />
                        </InputGroupText>
                        <InputGroupInput
                          type="time"
                          value={range.end}
                          step={60}
                          aria-label={t('models.price.schedule.end_time')}
                          aria-invalid={Boolean(errors.ranges)}
                          className="appearance-none text-center font-mono [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                          onChange={(event) =>
                            onChange({
                              ...rule,
                              ranges: rule.ranges.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, end: event.target.value } : item
                              )
                            })
                          }
                        />
                      </InputGroup>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('models.price.rule.remove_range')}
                        onClick={() =>
                          onChange({ ...rule, ranges: rule.ranges.filter((_, itemIndex) => itemIndex !== index) })
                        }>
                        <Trash2 aria-hidden className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onChange({ ...rule, ranges: [...rule.ranges, { start: '18:00', end: '20:00' }] })}>
                  <Plus aria-hidden className="size-3.5" /> {t('models.price.rule.add_range')}
                </Button>
              </div>
            ) : null}

            {scheduleExpanded ? (
              <Accordion
                type="single"
                collapsible
                value={advancedExpanded ? 'advanced' : undefined}
                className="mt-3 border-border-subtle border-t"
                onValueChange={(value) => setAdvancedExpanded(value === 'advanced')}>
                <AccordionItem value="advanced" className="border-0">
                  <AccordionTrigger className="py-3 font-normal text-muted-foreground text-xs">
                    {t('common.advanced_settings')}
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 pt-0 pb-0">
                    <label className="grid gap-1.5 text-muted-foreground text-xs">
                      <span>{t('models.price.schedule.timezone')}</span>
                      <Input
                        value={rule.timezone}
                        aria-invalid={timezoneInvalid}
                        className={drawerClasses.input}
                        onChange={(event) => onChange({ ...rule, timezone: event.target.value })}
                      />
                    </label>
                    {rule.editor === 'advanced' ? (
                      <label className="grid gap-1.5 text-muted-foreground text-xs">
                        <span>{t('models.price.rule.cron')}</span>
                        <Textarea.Input
                          value={rule.cron}
                          rows={4}
                          spellCheck={false}
                          aria-invalid={Object.keys(errors).some((key) => key.includes('cron'))}
                          placeholder={'* 1-3 * * 1-5\n* 6-9 * * 1-5'}
                          className="font-mono text-xs"
                          onChange={(event) => onChange({ ...rule, cron: event.target.value })}
                        />
                        <span className={drawerClasses.helpText}>{t('models.price.rule.cron_help')}</span>
                      </label>
                    ) : null}
                    {rule.editor === 'visual' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          onChange({
                            ...rule,
                            editor: 'advanced',
                            cron: buildVisualCronExpressions(rule.weekdays, rule.ranges).join('\n')
                          })
                        }>
                        {t('models.price.rule.edit_cron')}
                      </Button>
                    ) : canUseVisualEditor ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onChange({ ...rule, editor: 'visual', ...parsedVisualSchedule })}>
                        {t('models.price.rule.use_simple_schedule')}
                      </Button>
                    ) : (
                      <p className={drawerClasses.helpText}>{t('models.price.rule.visual_unavailable')}</p>
                    )}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            ) : null}
          </div>
        ) : null}

        {hasDateCondition ? (
          <div className="rounded-xl bg-background-subtle p-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="font-medium text-foreground text-sm">{t('models.price.rule.date_range')}</h4>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t('models.price.rule.remove_condition')}
                onClick={() => onChange({ ...rule, startsAt: '', endsAt: '' })}>
                <X aria-hidden className="size-3.5" />
              </Button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div className="grid gap-1.5 text-muted-foreground text-xs">
                <span>{t('models.price.schedule.starts_at')}</span>
                <DateTimePicker
                  value={parseIsoDate(rule.startsAt)}
                  granularity="minute"
                  format="yyyy-MM-dd HH:mm"
                  triggerClassName="w-full"
                  placeholder={t('models.price.schedule.starts_at')}
                  labels={{
                    hour: t('models.price.schedule.hour'),
                    minute: t('models.price.schedule.minute')
                  }}
                  onChange={(date) => onChange({ ...rule, startsAt: date?.toISOString() ?? '' })}
                />
              </div>
              <div className="grid gap-1.5 text-muted-foreground text-xs">
                <span>{t('models.price.schedule.ends_at')}</span>
                <DateTimePicker
                  value={parseIsoDate(rule.endsAt)}
                  granularity="minute"
                  format="yyyy-MM-dd HH:mm"
                  triggerClassName="w-full"
                  placeholder={t('models.price.schedule.ends_at')}
                  labels={{
                    hour: t('models.price.schedule.hour'),
                    minute: t('models.price.schedule.minute')
                  }}
                  onChange={(date) => onChange({ ...rule, endsAt: date?.toISOString() ?? '' })}
                />
              </div>
            </div>
          </div>
        ) : null}

        {hasTokenCondition || hasScheduleCondition || hasDateCondition ? (
          <Select value="" onValueChange={(value) => addCondition(value as 'tokens' | 'schedule' | 'dates')}>
            <SelectTrigger className="w-auto" aria-label={t('models.price.rule.add_condition')}>
              <Plus aria-hidden className="size-3.5" />
              <SelectValue placeholder={t('models.price.rule.add_condition')} />
            </SelectTrigger>
            <SelectContent>
              {!hasScheduleCondition ? (
                <SelectItem value="schedule">{t('models.price.rule.time_template')}</SelectItem>
              ) : null}
              {!hasTokenCondition ? (
                <SelectItem value="tokens">{t('models.price.rule.tier_template')}</SelectItem>
              ) : null}
              {!hasDateCondition ? <SelectItem value="dates">{t('models.price.rule.date_range')}</SelectItem> : null}
            </SelectContent>
          </Select>
        ) : null}
        {Object.keys(errors).length ? (
          <p role="alert" className={drawerClasses.errorText}>
            {t('models.price.rule.validation')}
          </p>
        ) : null}
      </section>
    </div>
  )
}

function formatClock(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(date)
}

function PricingPreview({ draft }: { draft: ModelPricingDraft }) {
  const { t } = useTranslation()
  const parsed = useMemo(() => parseModelPricingDraft(draft), [draft])
  const [week, setWeek] = useState(() => new Date())
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  const [inputTokens, setInputTokens] = useState(0)
  const [metric, setMetric] = useState<PricingMetric>('input')
  const [selected, setSelected] = useState<PricingTimelineSegment | null>(null)
  const timeline = useMemo(() => {
    if (!parsed.pricing) return []
    try {
      return buildPricingTimeline(parsed.pricing, { week, displayTimezone: timezone, inputTokens, metric })
    } catch {
      return []
    }
  }, [inputTokens, metric, parsed.pricing, timezone, week])
  const values = timeline
    .flatMap((day) => day.segments.map((segment) => segment.value))
    .filter((value): value is number => value !== null)
  const min = Math.min(...values)
  const max = Math.max(...values)

  if (!parsed.pricing || timeline.length === 0) {
    return (
      <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
        {t('models.price.preview.invalid')}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-medium text-foreground text-sm">{t('models.price.preview.title')}</h2>
        <p className="mt-1 text-muted-foreground text-xs leading-5">{t('models.price.preview.help')}</p>
      </div>
      <div className="grid grid-cols-2 items-end gap-3 border-border-subtle border-y py-3">
        <div className="flex gap-1">
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label={t('models.price.preview.previous_week')}
            onClick={() => setWeek(new Date(week.getTime() - 7 * 86_400_000))}>
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label={t('models.price.preview.next_week')}
            onClick={() => setWeek(new Date(week.getTime() + 7 * 86_400_000))}>
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        </div>
        <label className="grid gap-1 text-muted-foreground text-xs">
          <span>{t('models.price.preview.week')}</span>
          <Input
            type="date"
            value={timeline[0].date}
            className={drawerClasses.input}
            onChange={(event) => {
              if (event.target.value) setWeek(createPricingTimelineAnchor(event.target.value, timezone))
            }}
          />
        </label>
        <label className="grid gap-1 text-muted-foreground text-xs">
          <span>{t('models.price.schedule.timezone')}</span>
          <Input
            value={timezone}
            className={drawerClasses.input}
            onChange={(event) => setTimezone(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-muted-foreground text-xs">
          <span>{t('models.price.preview.tokens')}</span>
          <Input
            value={String(inputTokens)}
            inputMode="numeric"
            className={drawerClasses.input}
            onChange={(event) => setInputTokens(Number(event.target.value.replace(/\D/g, '')) || 0)}
          />
        </label>
        <label className="grid gap-1 text-muted-foreground text-xs">
          <span>{t('models.price.preview.metric')}</span>
          <Select value={metric} onValueChange={(value) => setMetric(value as PricingMetric)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['input', 'output', 'cacheRead', 'cacheWrite'] as const).map((value) => (
                <SelectItem key={value} value={value}>
                  {priceFieldLabel(value, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      <div className="space-y-2.5">
        {timeline.map((day) => (
          <div key={day.date} className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-3">
            <div className="text-xs">
              <div className="font-medium text-foreground">{day.date.slice(5)}</div>
              {day.clockChangeMinutes ? (
                <div className="text-muted-foreground">
                  {day.clockChangeMinutes > 0 ? '+' : ''}
                  {day.clockChangeMinutes} min
                </div>
              ) : null}
            </div>
            <div className="flex h-8 overflow-hidden rounded-lg border border-border-subtle bg-background-subtle">
              {day.segments.map((segment) => {
                const intensity = max === min ? 0.55 : 0.2 + 0.65 * (((segment.value ?? min) - min) / (max - min))
                return (
                  <button
                    key={segment.startsAt.toISOString()}
                    type="button"
                    className="min-w-px border-chart-1/20 border-r bg-chart-1 focus-visible:z-10 focus-visible:ring-2"
                    style={{
                      width: `${((segment.endsAt.getTime() - segment.startsAt.getTime()) / (day.durationMinutes * 60000)) * 100}%`,
                      opacity: intensity
                    }}
                    aria-label={`${formatClock(segment.startsAt, timezone)}–${formatClock(segment.endsAt, timezone)}: ${segment.value ?? '—'}`}
                    onClick={() => setSelected(segment)}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>
      {selected ? (
        <div className="rounded-xl border border-border-subtle bg-background-subtle p-4">
          <div className="font-medium text-sm">
            {formatClock(selected.startsAt, timezone)} – {formatClock(selected.endsAt, timezone)}
          </div>
          <div className="mt-1 text-muted-foreground text-xs">
            {t('models.price.base_title')}{' '}
            {selected.appliedRuleIndexes.map((index) => ` → ${ruleLabel(index, t)}`).join('')}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            {(['input', 'output', 'cacheRead', 'cacheWrite'] as const).map((field) => (
              <div key={field}>
                <div className="text-muted-foreground">{priceFieldLabel(field, t)}</div>
                <div className="mt-1 font-medium text-foreground">
                  {selected.rates[field]?.perMillionTokens ?? selected.rates.input.perMillionTokens ?? '—'}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function ModelPricingFields({
  pricing,
  pricingSource,
  section,
  showValidation = false,
  onCommit,
  onValidityChange,
  onRestoreProviderPricing
}: ModelPricingFieldsProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(() => createModelPricingDraft(pricing))
  const [activeRuleId, setActiveRuleId] = useState<string | null>(() => draft.rules[0]?.id ?? null)
  const parsed = useMemo(() => parseModelPricingDraft(draft), [draft])
  const conflicts = useMemo(
    () => (parsed.pricing ? findModelPricingRuleConflicts(parsed.pricing) : []),
    [parsed.pricing]
  )
  const activeIndex = Math.max(
    0,
    draft.rules.findIndex((rule) => rule.id === activeRuleId)
  )
  useEffect(() => {
    if (showValidation && parsed.firstInvalidRuleIndex !== undefined) {
      setActiveRuleId(draft.rules[parsed.firstInvalidRuleIndex]?.id ?? null)
    }
  }, [draft.rules, parsed.firstInvalidRuleIndex, showValidation])
  const updateDraft = useCallback(
    (next: ModelPricingDraft) => {
      setDraft(next)
      const result = parseModelPricingDraft(next)
      onValidityChange?.(Boolean(result.pricing))
      if (result.pricing) onCommit(buildModelPricingPatch(pricing, next) ?? undefined)
    },
    [onCommit, onValidityChange, pricing]
  )
  const updateRule = (index: number, rule: ModelPricingRuleDraft) =>
    updateDraft({
      ...draft,
      rules: draft.rules.map((current, currentIndex) => (currentIndex === index ? rule : current))
    })
  const moveRule = (from: number, to: number) => {
    if (to < 0 || to >= draft.rules.length) return
    const rules = [...draft.rules]
    const [rule] = rules.splice(from, 1)
    rules.splice(to, 0, rule)
    updateDraft({ ...draft, rules })
  }
  const addRule = () => {
    const rule = createPricingRuleDraft('empty', draft.rules.length)
    updateDraft({ ...draft, rules: [...draft.rules, rule] })
    setActiveRuleId(rule.id)
  }

  if (section === 'preview') return <PricingPreview draft={draft} />

  if (section === 'base')
    return (
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-medium text-foreground text-sm">{t('models.price.base_title')}</h2>
            <p className="mt-1 text-muted-foreground text-xs leading-5">
              {t(pricingSource === 'user' ? 'models.price.source_user_help' : 'models.price.source_provider_help')}
            </p>
          </div>
          {onRestoreProviderPricing ? (
            <Button type="button" variant="outline" size="sm" onClick={onRestoreProviderPricing}>
              {t('models.price.restore_provider')}
            </Button>
          ) : null}
        </div>
        <div className="flex items-center justify-between border-border-subtle border-y py-3">
          <span className="text-sm">{t('models.price.currency')}</span>
          <Select
            value={draft.currency}
            onValueChange={(currency) =>
              updateDraft({ ...draft, currency: currency as ModelPricingDraft['currency'] })
            }>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODEL_PRICING_CURRENCY_SYMBOLS.map((symbol) => (
                <SelectItem key={symbol} value={symbol}>
                  {symbol}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-3">
          <p className="text-muted-foreground text-xs leading-5">{t('models.price.cache_fallback_help')}</p>
          <PriceFields
            value={draft.base}
            currency={draft.currency}
            errors={showValidation ? parsed.errors.base : undefined}
            required
            onChange={(base) => updateDraft({ ...draft, base })}
          />
        </div>
      </div>
    )

  const activeRule = draft.rules[activeIndex]
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-medium text-foreground text-sm">{t('models.price.rule.title')}</h2>
        <p className="mt-1 text-muted-foreground text-xs leading-5">{t('models.price.rule.help')}</p>
      </div>
      <div className="flex min-w-0 items-center gap-2 border-border-subtle border-y py-2">
        <HorizontalScrollContainer
          className="min-w-0 flex-1"
          scrollLeftLabel={t('common.previous')}
          scrollRightLabel={t('common.next')}>
          {draft.rules.map((rule, index) => (
            <Button
              key={rule.id}
              type="button"
              size="sm"
              variant={rule.id === activeRuleId ? 'secondary' : 'ghost'}
              className="shrink-0"
              aria-pressed={rule.id === activeRuleId}
              onClick={() => setActiveRuleId(rule.id)}>
              {ruleLabel(index, t)}
            </Button>
          ))}
        </HorizontalScrollContainer>
        <div className="flex shrink-0 gap-1">
          {activeRule ? (
            <>
              <Tooltip content={t('models.price.rule.move_left')}>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={activeIndex === 0}
                  aria-label={t('models.price.rule.move_left')}
                  onClick={() => moveRule(activeIndex, activeIndex - 1)}>
                  <ArrowLeft aria-hidden className="size-3.5" />
                </Button>
              </Tooltip>
              <Tooltip content={t('models.price.rule.move_right')}>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={activeIndex === draft.rules.length - 1}
                  aria-label={t('models.price.rule.move_right')}
                  onClick={() => moveRule(activeIndex, activeIndex + 1)}>
                  <ArrowRight aria-hidden className="size-3.5" />
                </Button>
              </Tooltip>
              <Tooltip content={t('models.price.schedule.remove_rule', { index: activeIndex + 1 })}>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('models.price.schedule.remove_rule', { index: activeIndex + 1 })}
                  onClick={() => {
                    const rules = draft.rules.filter((_, index) => index !== activeIndex)
                    updateDraft({ ...draft, rules })
                    setActiveRuleId(rules[Math.min(activeIndex, rules.length - 1)]?.id ?? null)
                  }}>
                  <Trash2 aria-hidden className="size-3.5" />
                </Button>
              </Tooltip>
            </>
          ) : null}
          {activeRule ? (
            <Button type="button" size="sm" variant="outline" onClick={addRule}>
              <Plus aria-hidden className="size-3.5" />
              {t('models.price.schedule.add_rule')}
            </Button>
          ) : null}
        </div>
      </div>
      {conflicts.some(([left, right]) => left === activeIndex || right === activeIndex) ? (
        <p role="status" className="rounded-lg bg-amber-500/10 px-3 py-2 text-amber-700 text-xs dark:text-amber-300">
          {t('models.price.rule.conflict')}
        </p>
      ) : null}
      {activeRule ? (
        <PricingRuleEditor
          key={activeRule.id}
          rule={activeRule}
          errors={showValidation ? (parsed.errors.rules[activeIndex] ?? {}) : {}}
          currency={draft.currency}
          onChange={(rule) => updateRule(activeIndex, rule)}
        />
      ) : (
        <div className="rounded-xl border border-border-subtle border-dashed p-8 text-center">
          <p className="text-muted-foreground text-sm">{t('models.price.rule.empty')}</p>
          <Button type="button" size="sm" variant="outline" className="mt-3" onClick={addRule}>
            <Plus aria-hidden className="size-3.5" />
            {t('models.price.schedule.add_rule')}
          </Button>
        </div>
      )}
    </div>
  )
}
