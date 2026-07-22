import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tooltip
} from '@cherrystudio/ui'
import CopyIcon from '@renderer/components/icons/CopyIcon'
import { useModelMutations } from '@renderer/hooks/useModel'
import { useProvider } from '@renderer/hooks/useProvider'
import { toast } from '@renderer/services/toast'
import { getDefaultGroupName } from '@renderer/utils/naming'
import { CURRENCY, type Currency, type EndpointType, type Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import { isNewApiProvider } from '@shared/utils/provider'
import { ChevronDown, ChevronUp, CircleHelp } from 'lucide-react'
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

interface EditModelDrawerProps {
  providerId: string
  open: boolean
  model: Model | null
  onClose: () => void
}

interface BuildPatchOverrides {
  name?: string
  group?: string
  endpointTypes?: EndpointType[]
  caps?: Set<ModelCapabilityToggle>
  supportsStreaming?: boolean
  currencySymbol?: ModelDrawerCurrencySymbol
  inputPrice?: string
  outputPrice?: string
  contextWindow?: string
  maxInputTokens?: string
  maxOutputTokens?: string
}

interface AutoSaveQueueItem {
  providerId: string
  modelId: string
  patch: Partial<Model>
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

export default function EditModelDrawer({ providerId, open, model: modelProp, onClose }: EditModelDrawerProps) {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)
  const { updateModel } = useModelMutations()
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
  const [showMoreSettings, setShowMoreSettings] = useState(true)
  const [selectedCaps, setSelectedCaps] = useState<Set<ModelCapabilityToggle>>(new Set())
  const [hasUserModified, setHasUserModified] = useState(false)
  const [supportsStreaming, setSupportsStreaming] = useState<Model['supportsStreaming']>(true)
  const [currencySymbol, setCurrencySymbol] = useState<ModelDrawerCurrencySymbol>('$')
  const [inputPrice, setInputPrice] = useState('0')
  const [outputPrice, setOutputPrice] = useState('0')
  const [contextWindow, setContextWindow] = useState('')
  const [maxInputTokens, setMaxInputTokens] = useState('')
  const [maxOutputTokens, setMaxOutputTokens] = useState('')
  const autoSavePendingItemsRef = useRef(new Map<string, AutoSaveQueueItem>())
  const autoSaveRunningRef = useRef(false)

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
    setShowMoreSettings(true)
    setSelectedCaps(getInitialSelectedCapabilities(model))
    setHasUserModified(false)
    setSupportsStreaming(model.supportsStreaming)
    setCurrencySymbol(nextCurrencySymbol ?? '$')
    setInputPrice(String(model.pricing?.input?.perMillionTokens ?? 0))
    setOutputPrice(String(model.pricing?.output?.perMillionTokens ?? 0))
    setContextWindow(model.contextWindow != null ? String(model.contextWindow) : '')
    setMaxInputTokens(model.maxInputTokens != null ? String(model.maxInputTokens) : '')
    setMaxOutputTokens(model.maxOutputTokens != null ? String(model.maxOutputTokens) : '')
  }, [model, open])

  const handleUpdateModel = useCallback(
    async ({ providerId, modelId, patch }: AutoSaveQueueItem) => {
      await updateModel(providerId, modelId, {
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
    },
    [updateModel]
  )

  const buildPatch = useCallback(
    (overrides?: BuildPatchOverrides): Partial<Model> => {
      if (!model) {
        return {}
      }

      const nextCurrencySymbol = overrides?.currencySymbol ?? currencySymbol
      const finalCurrency: ModelDrawerCurrency =
        symbolToCurrency(nextCurrencySymbol) ?? symbolToCurrency(readCurrency(model)) ?? CURRENCY.USD
      const nextName = overrides?.name ?? name
      const nextGroup = overrides?.group ?? group
      const nextEndpointTypes = overrides?.endpointTypes ?? endpointTypes

      return {
        name: nextName || model.name,
        group: nextGroup || model.group,
        endpointTypes: mode === 'new-api' && nextEndpointTypes.length ? [...nextEndpointTypes] : undefined,
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
          }
        }
      }
    },
    [
      currencySymbol,
      endpointTypes,
      group,
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

  const processAutoSaveQueue = useCallback(async () => {
    if (autoSaveRunningRef.current) {
      return
    }

    autoSaveRunningRef.current = true
    try {
      while (autoSavePendingItemsRef.current.size > 0) {
        const [key, item] = autoSavePendingItemsRef.current.entries().next().value!
        autoSavePendingItemsRef.current.delete(key)

        try {
          await handleUpdateModel(item)
        } catch {
          toast.error(t('common.error'))
        }
      }
    } finally {
      autoSaveRunningRef.current = false
    }
  }, [handleUpdateModel, t])

  const autoSave = useCallback(
    (overrides?: BuildPatchOverrides) => {
      if (!model) {
        return
      }

      const { modelId } = parseUniqueModelId(model.id)
      const item = {
        providerId: model.providerId ?? providerId,
        modelId,
        patch: buildPatch(overrides)
      }
      autoSavePendingItemsRef.current.set(`${item.providerId}/${item.modelId}`, item)
      void processAutoSaveQueue()
    },
    [buildPatch, model, processAutoSaveQueue, providerId]
  )

  const handleToggleCapability = useCallback(
    (type: ModelCapabilityToggle) => {
      setHasUserModified(true)
      const next = new Set(selectedCaps)

      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }

      setSelectedCaps(next)
      autoSave({ caps: next })
    },
    [autoSave, selectedCaps]
  )

  const handleResetCapabilities = useCallback(() => {
    setSelectedCaps(new Set(savedCaps))
    setHasUserModified(false)
    autoSave({ caps: new Set(savedCaps) })
  }, [autoSave, savedCaps])

  if (!provider || !model) {
    return <ProviderSettingsDrawer open={open} onClose={onClose} title={t('models.edit')} />
  }

  const currentCurrency = currencySymbol || '$'

  return (
    <ProviderSettingsDrawer open={open} onClose={onClose} title={t('models.edit')}>
      <form
        id="provider-settings-model-edit-form"
        data-testid="provider-settings-model-edit-drawer-content"
        className="flex min-h-0 flex-col gap-4 py-0"
        onSubmit={(event) => event.preventDefault()}>
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
              endpointTypeControl="chips"
              modelIdDisabled
              modelIdAction={
                <button
                  type="button"
                  aria-label={t('message.copied')}
                  className={fieldClasses.inputActionButton}
                  onClick={() => {
                    void navigator.clipboard.writeText(apiModelId)
                    toast.success(t('message.copied'))
                  }}>
                  <CopyIcon size={14} />
                </button>
              }
              onModelIdChange={(value) => {
                setName(value)
                setGroup(getDefaultGroupName(value))
              }}
              onNameChange={setName}
              onNameBlur={() => autoSave({ name })}
              onGroupChange={setGroup}
              onGroupBlur={() => autoSave({ group })}
              onEndpointTypesChange={(next) => {
                const nextEndpointTypes = [...next]
                setEndpointTypes(nextEndpointTypes)
                autoSave({ endpointTypes: nextEndpointTypes })
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
                  onContextWindowBlur={() => autoSave({ contextWindow })}
                  onMaxInputTokensChange={setMaxInputTokens}
                  onMaxInputTokensBlur={() => autoSave({ maxInputTokens })}
                  onMaxOutputTokensChange={setMaxOutputTokens}
                  onMaxOutputTokensBlur={() => autoSave({ maxOutputTokens })}
                />
              </div>

              <div className={drawerClasses.switchCard}>
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-normal text-[13px] text-foreground-secondary leading-5">
                      {t('settings.models.add.supported_text_delta.label')}
                    </span>
                    <Tooltip content={t('settings.models.add.supported_text_delta.tooltip')}>
                      <span className="inline-flex h-5 w-4 shrink-0 items-center justify-center text-foreground-secondary">
                        <CircleHelp aria-hidden className="size-3" />
                      </span>
                    </Tooltip>
                  </div>
                  <Switch
                    size="sm"
                    aria-label={t('settings.models.add.supported_text_delta.label')}
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
                        autoSave({ currencySymbol: nextValue })
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
                      onBlur={() => autoSave({ inputPrice })}
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
                      onBlur={() => autoSave({ outputPrice })}
                    />
                    <span className={drawerClasses.valueSuffix}>
                      {currentCurrency} / {t('models.price.million_tokens')}
                    </span>
                  </div>
                </ProviderField>
              </div>
            </div>
          </ProviderSection>
        )}
      </form>
    </ProviderSettingsDrawer>
  )
}
