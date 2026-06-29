import {
  Button,
  DescriptionSwitch,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { useInvalidateCache } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import CopyIcon from '@renderer/components/Icons/CopyIcon'
import { useModelMutations } from '@renderer/hooks/useModel'
import { useProvider } from '@renderer/hooks/useProvider'
import { getDefaultGroupName } from '@renderer/utils/naming'
import type { UsageLedgerCostBackfillPreviewResponse } from '@shared/data/api/schemas/usageLedger'
import { CURRENCY, type Currency, type EndpointType, type Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import { isNewApiProvider } from '@shared/utils/provider'
import { ChevronDown, ChevronUp, RefreshCw, SaveIcon } from 'lucide-react'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderActions from '../../primitives/ProviderActions'
import ProviderField from '../../primitives/ProviderField'
import ProviderSection from '../../primitives/ProviderSection'
import ProviderSettingsDrawer from '../../primitives/ProviderSettingsDrawer'
import { drawerClasses, fieldClasses } from '../../primitives/ProviderSettingsPrimitives'
import {
  getInitialSelectedCapabilities,
  getModelApiId,
  MODEL_DRAWER_CURRENCY_SYMBOLS,
  readCurrency,
  toggleSetToCaps
} from './helpers'
import { ModelBasicFields } from './ModelBasicFields'
import { ModelCapabilityToggles } from './ModelCapabilityToggles'
import { ModelContextWindowFields } from './ModelContextWindowFields'
import type { ModelCapabilityToggle, ModelDrawerMode } from './types'

const logger = loggerService.withContext('EditModelDrawer')

interface EditModelDrawerProps {
  providerId: string
  open: boolean
  model: Model | null
  onClose: () => void
}

interface BuildPatchOverrides {
  caps?: Set<ModelCapabilityToggle>
  supportsStreaming?: boolean
  currencySymbol?: ModelDrawerCurrencySymbol
  inputPrice?: string
  outputPrice?: string
  cacheReadPrice?: string
  contextWindow?: string
  maxInputTokens?: string
  maxOutputTokens?: string
}

type ModelDrawerCurrencySymbol = (typeof MODEL_DRAWER_CURRENCY_SYMBOLS)[number]
type ModelDrawerCurrency = Currency
const isModelDrawerCurrencySymbol = (value: string): value is ModelDrawerCurrencySymbol =>
  MODEL_DRAWER_CURRENCY_SYMBOLS.includes(value as ModelDrawerCurrencySymbol)
// Pricing persists the shared Currency enum, so this drawer intentionally offers
// only the symbols that round-trip through that enum today.
const CURRENCY_SYMBOL_TO_CODE = {
  $: CURRENCY.USD,
  '¥': CURRENCY.CNY
} as const satisfies Record<string, ModelDrawerCurrency>
const CURRENCY_CODE_TO_SYMBOL = {
  [CURRENCY.USD]: '$',
  [CURRENCY.CNY]: '¥'
} as const satisfies Record<ModelDrawerCurrency, ModelDrawerCurrencySymbol>

const symbolToCurrency = (symbol: string): ModelDrawerCurrency | undefined => CURRENCY_SYMBOL_TO_CODE[symbol]
const currencyToSymbol = (currency: string): ModelDrawerCurrencySymbol | undefined =>
  CURRENCY_CODE_TO_SYMBOL[currency as ModelDrawerCurrency]

function hasBillableTokenPricing(pricing: Model['pricing'] | undefined): boolean {
  return [pricing?.input, pricing?.output, pricing?.cacheRead, pricing?.cacheWrite].some(
    (tier) => (tier?.perMillionTokens ?? 0) > 0
  )
}

function pricingSignature(pricing: Model['pricing'] | undefined): string {
  return JSON.stringify({
    input: pricing?.input,
    output: pricing?.output,
    cacheRead: pricing?.cacheRead,
    cacheWrite: pricing?.cacheWrite
  })
}

function formatBackfillCost(value: number, currency: string): string {
  const symbol = currency.toUpperCase() === 'CNY' ? '¥' : '$'
  const fractionDigits = value > 0 && value < 1 ? 4 : 2
  return `${symbol}${value.toFixed(fractionDigits)}`
}

function formatBackfillEstimate(preview: UsageLedgerCostBackfillPreviewResponse): string {
  return preview.estimatedCostByCurrency.map((item) => formatBackfillCost(item.cost, item.currency)).join(' / ')
}

export default function EditModelDrawer({ providerId, open, model: modelProp, onClose }: EditModelDrawerProps) {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)
  const { deleteModel, updateModel } = useModelMutations()
  const invalidateCache = useInvalidateCache()
  // Keep the last opened model around so `PageSidePanel`'s exit animation has stable content
  // after the parent clears its `editingModel` selection on close.
  const previousModelRef = useRef<Model | null>(modelProp)
  if (modelProp) {
    previousModelRef.current = modelProp
  }
  const model = modelProp ?? previousModelRef.current
  const [name, setName] = useState('')
  const [group, setGroup] = useState('')
  const [endpointTypes, setEndpointTypes] = useState<EndpointType[]>([])
  const [showMoreSettings, setShowMoreSettings] = useState(false)
  const [selectedCaps, setSelectedCaps] = useState<Set<ModelCapabilityToggle>>(new Set())
  const [hasUserModified, setHasUserModified] = useState(false)
  const [supportsStreaming, setSupportsStreaming] = useState<Model['supportsStreaming']>(true)
  const [currencySymbol, setCurrencySymbol] = useState<ModelDrawerCurrencySymbol>('$')
  const [inputPrice, setInputPrice] = useState('0')
  const [outputPrice, setOutputPrice] = useState('0')
  const [cacheReadPrice, setCacheReadPrice] = useState('0')
  const [contextWindow, setContextWindow] = useState('')
  const [maxInputTokens, setMaxInputTokens] = useState('')
  const [maxOutputTokens, setMaxOutputTokens] = useState('')
  const [endpointTypeTouched, setEndpointTypeTouched] = useState(false)
  const [costBackfillPreview, setCostBackfillPreview] = useState<UsageLedgerCostBackfillPreviewResponse | null>(null)
  const [isCostBackfillPreviewing, setIsCostBackfillPreviewing] = useState(false)
  const [isCostBackfillRunning, setIsCostBackfillRunning] = useState(false)

  const mode: ModelDrawerMode = provider && isNewApiProvider(provider) ? 'new-api' : 'legacy'
  const apiModelId = useMemo(() => (model ? getModelApiId(model) : ''), [model])
  const savedCaps = useMemo(
    () => (model ? getInitialSelectedCapabilities(model) : new Set<ModelCapabilityToggle>()),
    [model]
  )

  useEffect(() => {
    if (!open || !model) {
      return
    }

    const nextCurrency = readCurrency(model)
    const nextCurrencySymbol = currencyToSymbol(nextCurrency)

    setName(model.name)
    setGroup(model.group ?? '')
    setEndpointTypes(model.endpointTypes?.length ? [...model.endpointTypes] : [])
    setShowMoreSettings(false)
    setSelectedCaps(getInitialSelectedCapabilities(model))
    setHasUserModified(false)
    setSupportsStreaming(model.supportsStreaming)
    setCurrencySymbol(nextCurrencySymbol ?? '$')
    setInputPrice(String(model.pricing?.input?.perMillionTokens ?? 0))
    setOutputPrice(String(model.pricing?.output?.perMillionTokens ?? 0))
    setCacheReadPrice(String(model.pricing?.cacheRead?.perMillionTokens ?? 0))
    setContextWindow(model.contextWindow != null ? String(model.contextWindow) : '')
    setMaxInputTokens(model.maxInputTokens != null ? String(model.maxInputTokens) : '')
    setMaxOutputTokens(model.maxOutputTokens != null ? String(model.maxOutputTokens) : '')
    setEndpointTypeTouched(false)
    setCostBackfillPreview(null)
  }, [model, open])

  const previewCostBackfill = useCallback(
    async (pricing: Model['pricing'] | undefined) => {
      if (!model || !hasBillableTokenPricing(pricing)) {
        setCostBackfillPreview(null)
        return null
      }

      setIsCostBackfillPreviewing(true)
      try {
        const preview = await dataApiService.get('/usage-ledger/cost-backfill/preview', {
          query: { modelId: model.id }
        })
        const nextPreview = preview.recalculableCount > 0 ? preview : null
        setCostBackfillPreview(nextPreview)
        return nextPreview
      } catch (error) {
        logger.warn('Cost backfill preview failed', { modelId: model.id, error })
        setCostBackfillPreview(null)
        return null
      } finally {
        setIsCostBackfillPreviewing(false)
      }
    },
    [model]
  )

  const handleUpdateModel = useCallback(
    async (patch: Partial<Model>, options?: { previewCostBackfill?: boolean }) => {
      if (!model) {
        return null
      }

      const { modelId } = parseUniqueModelId(model.id)
      await updateModel(model.providerId ?? providerId, modelId, {
        name: patch.name,
        group: patch.group,
        capabilities: patch.capabilities,
        supportsStreaming: patch.supportsStreaming,
        endpointTypes: patch.endpointTypes,
        contextWindow: patch.contextWindow,
        maxInputTokens: patch.maxInputTokens,
        maxOutputTokens: patch.maxOutputTokens,
        pricing: patch.pricing
      })

      if (options?.previewCostBackfill) {
        return await previewCostBackfill(patch.pricing)
      }

      return null
    },
    [model, previewCostBackfill, providerId, updateModel]
  )

  const buildPatch = useCallback(
    (overrides?: BuildPatchOverrides): Partial<Model> => {
      if (!model) {
        return {}
      }

      const nextCurrencySymbol = overrides?.currencySymbol ?? currencySymbol
      const finalCurrency: ModelDrawerCurrency =
        symbolToCurrency(nextCurrencySymbol) ?? symbolToCurrency(readCurrency(model)) ?? CURRENCY.USD

      return {
        name: name || model.name,
        group: group || model.group,
        endpointTypes: mode === 'new-api' && endpointTypes.length ? [...endpointTypes] : undefined,
        capabilities: toggleSetToCaps(
          model.capabilities ?? [],
          overrides?.caps ?? selectedCaps
        ) as Model['capabilities'],
        supportsStreaming: overrides?.supportsStreaming ?? supportsStreaming,
        contextWindow: Number(overrides?.contextWindow ?? contextWindow) || undefined,
        maxInputTokens: Number(overrides?.maxInputTokens ?? maxInputTokens) || undefined,
        maxOutputTokens: Number(overrides?.maxOutputTokens ?? maxOutputTokens) || undefined,
        pricing: {
          input: {
            perMillionTokens: Number(overrides?.inputPrice ?? inputPrice) || 0,
            currency: finalCurrency
          },
          output: {
            perMillionTokens: Number(overrides?.outputPrice ?? outputPrice) || 0,
            currency: finalCurrency
          },
          cacheRead: {
            perMillionTokens: Number(overrides?.cacheReadPrice ?? cacheReadPrice) || 0,
            currency: finalCurrency
          },
          ...(model.pricing?.cacheWrite ? { cacheWrite: model.pricing.cacheWrite } : {})
        }
      }
    },
    [
      currencySymbol,
      endpointTypes,
      group,
      cacheReadPrice,
      contextWindow,
      inputPrice,
      maxInputTokens,
      maxOutputTokens,
      mode,
      model,
      name,
      outputPrice,
      selectedCaps,
      supportsStreaming
    ]
  )

  const autoSave = useCallback(
    (overrides?: BuildPatchOverrides, options?: { previewCostBackfill?: boolean }) => {
      void handleUpdateModel(buildPatch(overrides), options).catch(() => {
        window.toast.error(t('common.error'))
      })
    },
    [buildPatch, handleUpdateModel, t]
  )

  const handleToggleCapability = useCallback((type: ModelCapabilityToggle) => {
    setHasUserModified(true)
    setSelectedCaps((current) => {
      const next = new Set(current)

      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }

      return next
    })
  }, [])

  const handleResetCapabilities = useCallback(() => {
    setSelectedCaps(new Set(savedCaps))
    setHasUserModified(false)
  }, [savedCaps])

  const saveModel = useCallback(async () => {
    if (mode === 'new-api' && endpointTypes.length === 0) {
      setEndpointTypeTouched(true)
      return
    }

    const patch = buildPatch()
    const preview = await handleUpdateModel(patch, {
      previewCostBackfill: pricingSignature(patch.pricing) !== pricingSignature(model?.pricing)
    })
    if (!preview) {
      setShowMoreSettings(false)
      onClose()
    }
  }, [buildPatch, endpointTypes.length, handleUpdateModel, mode, model?.pricing, onClose])

  const runCostBackfill = useCallback(async () => {
    if (!model || !costBackfillPreview || costBackfillPreview.recalculableCount <= 0) {
      return
    }

    setIsCostBackfillRunning(true)
    try {
      const result = await dataApiService.post('/usage-ledger/cost-backfill/run', {
        body: { modelId: model.id }
      })
      setCostBackfillPreview(null)
      await invalidateCache(['/usage-ledger/entries', '/usage-ledger/stats', '/usage-ledger/timeline'])
      window.toast.success(t('settings.usage.costBackfill.success', { count: result.updatedCount }))
    } catch (error) {
      logger.warn('Cost backfill run failed', { modelId: model.id, error })
      window.toast.error(t('common.error'))
    } finally {
      setIsCostBackfillRunning(false)
    }
  }, [costBackfillPreview, invalidateCache, model, t])

  const handleFormSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      await saveModel()
    },
    [saveModel]
  )

  const handleDeleteModel = useCallback(async () => {
    if (!model) {
      return
    }

    const { modelId } = parseUniqueModelId(model.id)

    window.modal.confirm({
      title: t('common.delete_confirm'),
      content: t('settings.models.manage.remove_model'),
      okButtonProps: { danger: true },
      okText: t('common.delete'),
      centered: true,
      onOk: async () => {
        await deleteModel(model.providerId ?? providerId, modelId)
        window.toast.success(t('common.delete_success'))
        onClose()
      }
    })
  }, [deleteModel, model, onClose, providerId, t])

  if (!provider || !model) {
    return <ProviderSettingsDrawer open={open} onClose={onClose} title={t('models.edit')} />
  }

  const footer = (
    <ProviderActions className={drawerClasses.footer}>
      {!model.isEnabled ? (
        <Button
          type="button"
          variant="ghost"
          className="mr-auto px-2.5 text-destructive shadow-none hover:bg-error-bg hover:text-error-text"
          onClick={() => void handleDeleteModel()}>
          {t('common.delete')}
        </Button>
      ) : null}
      <Button variant="outline" onClick={onClose}>
        {t('common.cancel')}
      </Button>
      <Button type="button" onClick={() => void saveModel()}>
        <SaveIcon aria-hidden className="size-4 shrink-0 text-current" />
        {t('common.save')}
      </Button>
    </ProviderActions>
  )

  const currentCurrency = currencySymbol || '$'

  return (
    <ProviderSettingsDrawer open={open} onClose={onClose} title={t('models.edit')} footer={footer}>
      <form
        id="provider-settings-model-edit-form"
        data-testid="provider-settings-model-edit-drawer-content"
        className="flex min-h-0 flex-col gap-4 py-0"
        onSubmit={(event) => void handleFormSubmit(event)}>
        <ProviderSection className={drawerClasses.section}>
          <div className={drawerClasses.fieldList}>
            <ModelBasicFields
              values={{
                modelId: apiModelId,
                name,
                group,
                contextWindow,
                maxInputTokens,
                maxOutputTokens,
                endpointTypes
              }}
              showEndpointType={mode === 'new-api'}
              modelIdDisabled
              modelIdAction={
                <button
                  type="button"
                  aria-label={t('message.copied')}
                  className={fieldClasses.iconButton}
                  onClick={() => {
                    void navigator.clipboard.writeText(apiModelId)
                    window.toast.success(t('message.copied'))
                  }}>
                  <CopyIcon size={14} />
                </button>
              }
              endpointTypeError={endpointTypeTouched ? t('settings.models.add.endpoint_type.required') : undefined}
              onModelIdChange={(value) => {
                setName(value)
                setGroup(getDefaultGroupName(value))
              }}
              onNameChange={setName}
              onGroupChange={setGroup}
              onEndpointTypesChange={(next) => {
                setEndpointTypeTouched(false)
                setEndpointTypes([...next])
              }}
            />
          </div>
        </ProviderSection>

        <ProviderActions>
          <Button
            type="button"
            variant="ghost"
            className={drawerClasses.toggleButton}
            onClick={() => setShowMoreSettings((current) => !current)}>
            {t('settings.moresetting.label')}
            {showMoreSettings ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </Button>
        </ProviderActions>

        {showMoreSettings && (
          <ProviderSection className={drawerClasses.section}>
            <div data-testid="provider-settings-model-more-settings" className="space-y-4">
              <div className={drawerClasses.sectionCard}>
                <ModelCapabilityToggles
                  selectedCaps={selectedCaps}
                  hasUserModified={hasUserModified}
                  onToggle={handleToggleCapability}
                  onReset={handleResetCapabilities}
                />
              </div>

              <div className={drawerClasses.sectionCard}>
                <ModelContextWindowFields
                  contextWindow={contextWindow}
                  maxInputTokens={maxInputTokens}
                  maxOutputTokens={maxOutputTokens}
                  onContextWindowChange={setContextWindow}
                  onMaxInputTokensChange={setMaxInputTokens}
                  onMaxOutputTokensChange={setMaxOutputTokens}
                />
              </div>

              <div className={drawerClasses.sectionCard}>
                <div className={drawerClasses.switchCard}>
                  <DescriptionSwitch
                    size="sm"
                    label={t('settings.models.add.supported_text_delta.label')}
                    description={t('settings.models.add.supported_text_delta.tooltip')}
                    checked={supportsStreaming ?? false}
                    onCheckedChange={(checked) => {
                      setSupportsStreaming(checked)
                      autoSave({ supportsStreaming: checked })
                    }}
                  />
                </div>
              </div>

              <div className={drawerClasses.sectionCard}>
                <ProviderField title={t('models.price.currency')} titleClassName={drawerClasses.fieldTitle}>
                  <div className={drawerClasses.inlineRow}>
                    <Select
                      value={currencySymbol}
                      onValueChange={(nextValue) => {
                        if (!isModelDrawerCurrencySymbol(nextValue)) {
                          return
                        }

                        setCurrencySymbol(nextValue)
                        autoSave({ currencySymbol: nextValue }, { previewCostBackfill: true })
                      }}>
                      <SelectTrigger aria-label={t('models.price.currency')} className={drawerClasses.selectTrigger}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className={drawerClasses.selectContent}>
                        {MODEL_DRAWER_CURRENCY_SYMBOLS.map((symbol) => (
                          <SelectItem key={symbol} value={symbol}>
                            {symbol}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </ProviderField>

                <ProviderField title={t('models.price.input')} titleClassName={drawerClasses.fieldTitle}>
                  <div className={drawerClasses.responsiveValueRow}>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      aria-label={t('models.price.input')}
                      value={inputPrice}
                      placeholder="0.00"
                      className={drawerClasses.input}
                      onChange={(event) => {
                        setInputPrice(event.target.value)
                      }}
                      onBlur={() => autoSave({ inputPrice }, { previewCostBackfill: true })}
                    />
                    <span className={drawerClasses.valueSuffix}>
                      {currentCurrency} / {t('models.price.million_tokens')}
                    </span>
                  </div>
                </ProviderField>

                <ProviderField title={t('models.price.output')} titleClassName={drawerClasses.fieldTitle}>
                  <div className={drawerClasses.responsiveValueRow}>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      aria-label={t('models.price.output')}
                      value={outputPrice}
                      placeholder="0.00"
                      className={drawerClasses.input}
                      onChange={(event) => {
                        setOutputPrice(event.target.value)
                      }}
                      onBlur={() => autoSave({ outputPrice }, { previewCostBackfill: true })}
                    />
                    <span className={drawerClasses.valueSuffix}>
                      {currentCurrency} / {t('models.price.million_tokens')}
                    </span>
                  </div>
                </ProviderField>

                <ProviderField title={t('models.price.cache_read')} titleClassName={drawerClasses.fieldTitle}>
                  <div className={drawerClasses.responsiveValueRow}>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      aria-label={t('models.price.cache_read')}
                      value={cacheReadPrice}
                      placeholder="0.00"
                      className={drawerClasses.input}
                      onChange={(event) => {
                        setCacheReadPrice(event.target.value)
                      }}
                      onBlur={() => autoSave({ cacheReadPrice }, { previewCostBackfill: true })}
                    />
                    <span className={drawerClasses.valueSuffix}>
                      {currentCurrency} / {t('models.price.million_tokens')}
                    </span>
                  </div>
                </ProviderField>

                {costBackfillPreview ? (
                  <div className="mt-3 flex flex-col gap-2 border-border border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="font-medium text-foreground text-sm">
                        {t('settings.usage.costBackfill.available', {
                          count: costBackfillPreview.recalculableCount
                        })}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {t('settings.usage.costBackfill.confirm', {
                          count: costBackfillPreview.recalculableCount,
                          cost: formatBackfillEstimate(costBackfillPreview)
                        })}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0"
                      disabled={isCostBackfillRunning || isCostBackfillPreviewing}
                      onClick={() => void runCostBackfill()}>
                      <RefreshCw
                        aria-hidden
                        className={`size-4 shrink-0 text-current ${isCostBackfillRunning ? 'animate-spin' : ''}`}
                      />
                      {t('settings.usage.costBackfill.action')}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          </ProviderSection>
        )}
      </form>
    </ProviderSettingsDrawer>
  )
}
