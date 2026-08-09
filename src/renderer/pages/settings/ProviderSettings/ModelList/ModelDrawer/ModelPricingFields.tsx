import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tooltip } from '@cherrystudio/ui'
import type { Model } from '@shared/data/types/model'
import type { TFunction } from 'i18next'
import { Plus, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderField from '../../primitives/ProviderField'
import { drawerClasses } from '../../primitives/ProviderSettingsPrimitives'
import {
  appendModelPricingTier,
  buildModelPricingFromDraft,
  clearModelPricingDraftError,
  createModelPricingDraft,
  getModelPricingCurrencySymbol,
  isModelPricingCurrencySymbol,
  MODEL_PRICING_CURRENCY_SYMBOLS,
  type ModelPricingCurrencySymbol,
  type ModelPricingDraft,
  type ModelPricingDraftError,
  type ModelPricingDraftErrors,
  type ModelPricingDraftField,
  type ModelPricingTierDraft,
  removeModelPricingTier,
  updateModelPricingTier
} from './modelPricing'

interface ModelPricingFieldsProps {
  pricing: Model['pricing']
  onCommit: (pricing: NonNullable<Model['pricing']>) => void
}

interface TierPriceFieldProps {
  tierIndex: number
  field: Exclude<ModelPricingDraftField, 'minInputTokens'>
  label: string
  ariaLabel: string
  value: string
  currencySymbol: ModelPricingCurrencySymbol
  error?: string
  optional?: boolean
  onChange: (field: ModelPricingDraftField, value: string) => void
  onBlur: () => void
}

function TierPriceField({
  tierIndex,
  field,
  label,
  ariaLabel,
  value,
  currencySymbol,
  error,
  optional = false,
  onChange,
  onBlur
}: TierPriceFieldProps) {
  const { t } = useTranslation()
  const errorId = `model-pricing-tier-${tierIndex}-${field}-error`

  return (
    <ProviderField
      title={label}
      titleClassName={drawerClasses.fieldTitle}
      className={drawerClasses.field}
      help={
        error ? (
          <div id={errorId} role="alert" className={drawerClasses.errorText}>
            {error}
          </div>
        ) : null
      }>
      <div className={drawerClasses.responsiveValueRow}>
        <Input
          type="number"
          min="0"
          step="any"
          required={!optional}
          aria-label={ariaLabel}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          value={value}
          placeholder={optional ? t('models.price.use_input_price') : '0.00'}
          className={drawerClasses.input}
          onChange={(event) => onChange(field, event.target.value)}
          onBlur={onBlur}
        />
        <span className={drawerClasses.valueSuffix}>
          {currencySymbol} / {t('models.price.million_tokens')}
        </span>
      </div>
    </ProviderField>
  )
}

interface ModelPricingTierFieldsProps {
  tier: ModelPricingTierDraft
  tierIndex: number
  currencySymbol: ModelPricingCurrencySymbol
  errors: Partial<Record<ModelPricingDraftField, string>>
  onChange: (tierIndex: number, field: ModelPricingDraftField, value: string) => void
  onBlur: () => void
  onRemove: (tierIndex: number) => void
}

function ModelPricingTierFields({
  tier,
  tierIndex,
  currencySymbol,
  errors,
  onChange,
  onBlur,
  onRemove
}: ModelPricingTierFieldsProps) {
  const { t } = useTranslation()
  const displayIndex = tierIndex + 1
  const removeLabel = t('models.price.remove_tier', { index: displayIndex })
  const minInputTokensLabel = t('models.price.min_input_tokens')
  const minInputTokensAriaLabel = t('models.price.field_for_tier', {
    field: minInputTokensLabel,
    index: displayIndex
  })
  const minInputTokensHelpId = `model-pricing-tier-${tierIndex}-min-input-tokens-help`
  const fieldLabel = (label: string) =>
    tierIndex === 0 ? label : t('models.price.field_for_tier', { field: label, index: displayIndex })

  return (
    <div className="space-y-3.5">
      {tierIndex > 0 ? <div className={drawerClasses.divider} /> : null}
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-foreground text-sm leading-5">
            {t('models.price.tier', { index: displayIndex })}
          </div>
          {tier.minInputTokens.trim() ? (
            <div className={drawerClasses.helpText}>
              {t('models.price.tier_from', { boundary: tier.minInputTokens })}
            </div>
          ) : null}
        </div>
        {tierIndex > 0 ? (
          <Tooltip content={removeLabel}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground shadow-none hover:bg-accent hover:text-destructive"
              aria-label={removeLabel}
              onClick={() => onRemove(tierIndex)}>
              <Trash2 aria-hidden className="size-3.5" />
            </Button>
          </Tooltip>
        ) : null}
      </div>

      {tierIndex > 0 ? (
        <ProviderField
          title={minInputTokensLabel}
          titleClassName={drawerClasses.fieldTitle}
          className={drawerClasses.field}
          help={
            <div
              id={minInputTokensHelpId}
              role={errors.minInputTokens ? 'alert' : undefined}
              className={errors.minInputTokens ? drawerClasses.errorText : drawerClasses.helpText}>
              {errors.minInputTokens ?? t('models.price.min_input_tokens_help')}
            </div>
          }>
          <Input
            type="number"
            min="1"
            step="1"
            required
            aria-label={minInputTokensAriaLabel}
            aria-invalid={Boolean(errors.minInputTokens)}
            aria-describedby={minInputTokensHelpId}
            value={tier.minInputTokens}
            placeholder="0"
            className={drawerClasses.input}
            onChange={(event) => onChange(tierIndex, 'minInputTokens', event.target.value)}
            onBlur={onBlur}
          />
        </ProviderField>
      ) : null}

      <TierPriceField
        tierIndex={tierIndex}
        field="inputPrice"
        label={t('models.price.input')}
        ariaLabel={fieldLabel(t('models.price.input'))}
        value={tier.inputPrice}
        currencySymbol={currencySymbol}
        error={errors.inputPrice}
        onChange={(field, value) => onChange(tierIndex, field, value)}
        onBlur={onBlur}
      />
      <TierPriceField
        tierIndex={tierIndex}
        field="outputPrice"
        label={t('models.price.output')}
        ariaLabel={fieldLabel(t('models.price.output'))}
        value={tier.outputPrice}
        currencySymbol={currencySymbol}
        error={errors.outputPrice}
        onChange={(field, value) => onChange(tierIndex, field, value)}
        onBlur={onBlur}
      />
      <TierPriceField
        tierIndex={tierIndex}
        field="cacheReadPrice"
        label={t('models.price.cache_read')}
        ariaLabel={fieldLabel(t('models.price.cache_read'))}
        value={tier.cacheReadPrice}
        currencySymbol={currencySymbol}
        error={errors.cacheReadPrice}
        optional
        onChange={(field, value) => onChange(tierIndex, field, value)}
        onBlur={onBlur}
      />
      <TierPriceField
        tierIndex={tierIndex}
        field="cacheWritePrice"
        label={t('models.price.cache_write')}
        ariaLabel={fieldLabel(t('models.price.cache_write'))}
        value={tier.cacheWritePrice}
        currencySymbol={currencySymbol}
        error={errors.cacheWritePrice}
        optional
        onChange={(field, value) => onChange(tierIndex, field, value)}
        onBlur={onBlur}
      />
    </div>
  )
}

function getPricingErrorMessage(error: ModelPricingDraftError | undefined, t: TFunction) {
  switch (error) {
    case 'invalidPrice':
      return t('models.price.validation_price')
    case 'invalidMinInputTokens':
      return t('models.price.validation_min_input_tokens')
    case 'minInputTokensNotIncreasing':
      return t('models.price.validation_min_input_tokens_order')
    default:
      return undefined
  }
}

function translateErrors(errors: ModelPricingDraftErrors, t: TFunction) {
  return errors.map(
    (tierErrors) =>
      Object.fromEntries(
        Object.entries(tierErrors).map(([field, error]) => [field, getPricingErrorMessage(error, t)])
      ) as Partial<Record<ModelPricingDraftField, string>>
  )
}

export function ModelPricingFields({ pricing, onCommit }: ModelPricingFieldsProps) {
  const { t } = useTranslation()
  const [currencySymbol, setCurrencySymbol] = useState<ModelPricingCurrencySymbol>(() =>
    getModelPricingCurrencySymbol(pricing)
  )
  const [draft, setDraft] = useState<ModelPricingDraft>(() => createModelPricingDraft(pricing))
  const [errors, setErrors] = useState<ModelPricingDraftErrors>([])

  const commitDraft = useCallback(
    (nextDraft: ModelPricingDraft, nextCurrencySymbol: ModelPricingCurrencySymbol = currencySymbol) => {
      const result = buildModelPricingFromDraft(pricing, nextDraft, nextCurrencySymbol)
      setErrors(result.errors)
      if (result.pricing) {
        onCommit(result.pricing)
      }
    },
    [currencySymbol, onCommit, pricing]
  )

  const handleTierChange = useCallback((tierIndex: number, field: ModelPricingDraftField, value: string) => {
    setDraft((current) => updateModelPricingTier(current, tierIndex, field, value))
    setErrors((current) => clearModelPricingDraftError(current, tierIndex, field))
  }, [])

  const handleAddTier = useCallback(() => {
    setDraft((current) => appendModelPricingTier(current))
    setErrors((current) => [...current, {}])
  }, [])

  const handleRemoveTier = useCallback(
    (tierIndex: number) => {
      const nextDraft = removeModelPricingTier(draft, tierIndex)
      setDraft(() => nextDraft)
      setErrors((current) => current.filter((_, index) => index !== tierIndex))
      commitDraft(nextDraft)
    },
    [commitDraft, draft]
  )

  const translatedErrors = translateErrors(errors, t)

  return (
    <>
      <ProviderField title={t('models.price.currency')} titleClassName={drawerClasses.fieldTitle}>
        <div className={drawerClasses.inlineRow}>
          <Select
            value={currencySymbol}
            onValueChange={(nextValue) => {
              if (!isModelPricingCurrencySymbol(nextValue)) {
                return
              }

              setCurrencySymbol(nextValue)
              commitDraft(draft, nextValue)
            }}>
            <SelectTrigger aria-label={t('models.price.currency')} className={drawerClasses.selectTrigger}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className={drawerClasses.selectContent}>
              {MODEL_PRICING_CURRENCY_SYMBOLS.map((symbol) => (
                <SelectItem key={symbol} value={symbol}>
                  {symbol}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </ProviderField>

      <div className={drawerClasses.helpText}>{t('models.price.cache_fallback_help')}</div>

      <div className="space-y-3.5">
        {draft.tiers.map((tier, tierIndex) => (
          <ModelPricingTierFields
            key={tierIndex}
            tier={tier}
            tierIndex={tierIndex}
            currencySymbol={currencySymbol}
            errors={translatedErrors[tierIndex] ?? {}}
            onChange={handleTierChange}
            onBlur={() => commitDraft(draft)}
            onRemove={handleRemoveTier}
          />
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        className="h-auto w-full gap-1.5 rounded-md border-border-subtle border-dashed py-2 text-muted-foreground text-xs shadow-none hover:border-border-strong hover:bg-accent/40 hover:text-foreground"
        onClick={handleAddTier}>
        <Plus aria-hidden className="size-3.5" />
        {t('models.price.add_tier')}
      </Button>
    </>
  )
}
