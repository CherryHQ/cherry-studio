import { Button, Input } from '@cherrystudio/ui'
import ProviderField from '@renderer/pages/settings/ProviderSettings/primitives/ProviderField'
import { drawerClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import type { ModelPricingThreshold } from '@shared/data/types/model'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** A threshold row while it is being typed — every field is free-form text. */
export interface ModelPricingThresholdDraft {
  aboveInputTokens: string
  input: string
  output: string
  cacheRead: string
}

export const EMPTY_PRICING_THRESHOLD_DRAFT: ModelPricingThresholdDraft = {
  aboveInputTokens: '',
  input: '',
  output: '',
  cacheRead: ''
}

export function toPricingThresholdDrafts(thresholds: ModelPricingThreshold[] | undefined) {
  return (thresholds ?? []).map((threshold) => ({
    aboveInputTokens: String(threshold.aboveInputTokens),
    input: String(threshold.input),
    output: String(threshold.output),
    cacheRead: threshold.cacheRead == null ? '' : String(threshold.cacheRead)
  }))
}

const toRate = (value: string): number | undefined => {
  const parsed = Number(value.trim())
  return value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

/**
 * Drop half-typed rows: a threshold only bills once it has a boundary and both
 * required rates, and persisting a partial one would silently reprice requests.
 */
export function fromPricingThresholdDrafts(drafts: ModelPricingThresholdDraft[]): ModelPricingThreshold[] {
  return drafts.flatMap((draft) => {
    const aboveInputTokens = toRate(draft.aboveInputTokens)
    const input = toRate(draft.input)
    const output = toRate(draft.output)
    if (!aboveInputTokens || input === undefined || output === undefined) return []

    const cacheRead = toRate(draft.cacheRead)
    return [
      {
        aboveInputTokens: Math.floor(aboveInputTokens),
        input,
        output,
        ...(cacheRead !== undefined ? { cacheRead } : {})
      }
    ]
  })
}

interface ModelPricingThresholdFieldsProps {
  drafts: ModelPricingThresholdDraft[]
  currencySymbol: string
  onChange: (drafts: ModelPricingThresholdDraft[]) => void
  onCommit: (drafts: ModelPricingThresholdDraft[]) => void
}

export function ModelPricingThresholdFields({
  drafts,
  currencySymbol,
  onChange,
  onCommit
}: ModelPricingThresholdFieldsProps) {
  const { t } = useTranslation()

  const update = (index: number, patch: Partial<ModelPricingThresholdDraft>) =>
    drafts.map((draft, position) => (position === index ? { ...draft, ...patch } : draft))

  const priceField = (index: number, key: 'input' | 'output' | 'cacheRead', label: string, placeholder: string) => (
    <ProviderField title={label} titleClassName={drawerClasses.fieldTitle} className={drawerClasses.field}>
      <div className={drawerClasses.responsiveValueRow}>
        <Input
          type="number"
          min="0"
          step="0.01"
          aria-label={`${label} — ${t('models.price.threshold.label')} ${index + 1}`}
          value={drafts[index][key]}
          placeholder={placeholder}
          className={drawerClasses.input}
          onChange={(event) => onChange(update(index, { [key]: event.target.value }))}
          onBlur={() => onCommit(drafts)}
        />
        <span className={drawerClasses.valueSuffix}>
          {currencySymbol} / {t('models.price.million_tokens')}
        </span>
      </div>
    </ProviderField>
  )

  return (
    <div className="space-y-3" data-testid="provider-settings-model-pricing-thresholds">
      <p className={drawerClasses.sectionDescription}>{t('models.price.threshold.description')}</p>

      {drafts.map((draft, index) => (
        // Rows carry no id and cannot be reordered; every input is controlled from
        // `drafts`, so an index key stays consistent across add and remove.
        <div key={index} className="space-y-3.5 rounded-md border border-border-subtle px-3 py-3">
          <div className="flex items-end gap-2">
            <ProviderField
              title={t('models.price.threshold.above')}
              titleClassName={drawerClasses.fieldTitle}
              className={`${drawerClasses.field} min-w-0 flex-1`}>
              <Input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                aria-label={`${t('models.price.threshold.above')} ${index + 1}`}
                value={draft.aboveInputTokens}
                placeholder="512000"
                className={drawerClasses.input}
                onChange={(event) =>
                  onChange(update(index, { aboveInputTokens: event.target.value.replace(/[^\d]/g, '') }))
                }
                onBlur={() => onCommit(drafts)}
              />
            </ProviderField>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
              aria-label={`${t('models.price.threshold.remove')} ${index + 1}`}
              onClick={() => {
                const next = drafts.filter((_, position) => position !== index)
                onChange(next)
                onCommit(next)
              }}>
              <Trash2 size={14} />
            </Button>
          </div>

          {priceField(index, 'input', t('models.price.input'), '0.00')}
          {priceField(index, 'output', t('models.price.output'), '0.00')}
          {priceField(index, 'cacheRead', t('models.price.cache_read'), '0.00')}
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => onChange([...drafts, { ...EMPTY_PRICING_THRESHOLD_DRAFT }])}>
        <Plus size={14} />
        {t('models.price.threshold.add')}
      </Button>
    </div>
  )
}
