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
import { getModelPreferredEndpoint } from '@shared/utils/provider'
import { ChevronDown, ChevronUp, CircleHelp } from 'lucide-react'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderActions from '../../primitives/ProviderActions'
import ProviderField from '../../primitives/ProviderField'
import ProviderSection from '../../primitives/ProviderSection'
import ProviderSettingsDrawer from '../../primitives/ProviderSettingsDrawer'
import { drawerClasses, fieldClasses } from '../../primitives/ProviderSettingsPrimitives'
import {
  areModelClassificationsEqual,
  buildModelCapabilities,
  buildModelInputModalities,
  getInitialModelClassification,
  getModelApiId,
  MODEL_DRAWER_CURRENCY_SYMBOLS,
  readCurrency
} from './helpers'
import { ModelBasicFields } from './ModelBasicFields'
import { ModelClassificationControls } from './ModelClassificationControls'
import { ModelContextWindowFields } from './ModelContextWindowFields'
import {
  applyModelPurpose,
  getInitialChatEndpointType,
  getModelDrawerMode,
  getPreferredEndpointCandidates,
  getProviderChatEndpointTypes,
  inferModelPurpose,
  type ModelPurposeFields
} from './modelPurpose'
import { ModelPurposeFields as ModelPurposeFieldsControl } from './ModelPurposeFields'
import type {
  ModelCapabilityToggle,
  ModelClassificationState,
  ModelDrawerMode,
  ModelInputModality,
  ModelPrimaryType
} from './types'

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
  preferredEndpointType?: EndpointType
  purposeFields?: ModelPurposeFields
  classification?: ModelClassificationState
  supportsStreaming?: boolean
  currencySymbol?: ModelDrawerCurrencySymbol
  inputPrice?: string
  outputPrice?: string
  cacheReadPrice?: string
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
  const [preferredEndpointType, setPreferredEndpointType] = useState<EndpointType | undefined>(undefined)
  const [purposeFields, setPurposeFields] = useState<ModelPurposeFields>({})
  const [showMoreSettings, setShowMoreSettings] = useState(true)
  const [classification, setClassification] = useState<ModelClassificationState>(() => getInitialModelClassification())
  const [supportsStreaming, setSupportsStreaming] = useState<Model['supportsStreaming']>(true)
  const [currencySymbol, setCurrencySymbol] = useState<ModelDrawerCurrencySymbol>('$')
  const [inputPrice, setInputPrice] = useState('0')
  const [outputPrice, setOutputPrice] = useState('0')
  const [cacheReadPrice, setCacheReadPrice] = useState('')
  const [contextWindow, setContextWindow] = useState('')
  const [maxInputTokens, setMaxInputTokens] = useState('')
  const [maxOutputTokens, setMaxOutputTokens] = useState('')
  const [initializedModel, setInitializedModel] = useState<Model | null>(null)
  const autoSavePendingItemsRef = useRef(new Map<string, AutoSaveQueueItem>())
  const autoSaveRunningRef = useRef(false)

  const mode: ModelDrawerMode = provider ? getModelDrawerMode(provider) : 'legacy'
  const providerChatEndpointTypes = provider ? getProviderChatEndpointTypes(provider) : []
  const defaultChatEndpoint = providerChatEndpointTypes[0]
  const preferredEndpointOptions = provider ? getPreferredEndpointCandidates(provider, endpointTypes) : []
  // State holds this session's choice only; everything else derives from the model, so the picker
  // still shows the right chip when the provider resolves after the first render.
  const effectivePreferredEndpoint =
    preferredEndpointType ?? (model ? getModelPreferredEndpoint(model, provider ?? undefined) : undefined)
  const activePreferredEndpoint =
    preferredEndpointOptions.find((candidate) => candidate === effectivePreferredEndpoint) ??
    preferredEndpointOptions[0]
  const modelPurpose = inferModelPurpose(purposeFields)
  const chatEndpointType = getInitialChatEndpointType(purposeFields, defaultChatEndpoint)
  const apiModelId = useMemo(() => (model ? getModelApiId(model) : ''), [model])
  const savedClassification = useMemo(() => getInitialModelClassification(model), [model])
  const hasClassificationChanges = !areModelClassificationsEqual(classification, savedClassification)

  useLayoutEffect(() => {
    if (!open || !model) {
      return
    }

    const nextCurrency = readCurrency(model)
    const nextCurrencySymbol = currencyToSymbol(nextCurrency)

    setName(model.name)
    setGroup(model.group ?? '')
    setEndpointTypes(model.endpointTypes?.length ? [...model.endpointTypes] : [])
    setPreferredEndpointType(undefined)
    setPurposeFields({
      endpointTypes: model.endpointTypes,
      capabilities: model.capabilities,
      inputModalities: model.inputModalities,
      outputModalities: model.outputModalities
    })
    setShowMoreSettings(true)
    setClassification(getInitialModelClassification(model))
    setSupportsStreaming(model.supportsStreaming)
    setCurrencySymbol(nextCurrencySymbol ?? '$')
    setInputPrice(String(model.pricing?.input?.perMillionTokens ?? 0))
    setOutputPrice(String(model.pricing?.output?.perMillionTokens ?? 0))
    const cacheReadRate = model.pricing?.cacheRead?.perMillionTokens
    setCacheReadPrice(cacheReadRate == null ? '' : String(cacheReadRate))
    setContextWindow(model.contextWindow != null ? String(model.contextWindow) : '')
    setMaxInputTokens(model.maxInputTokens != null ? String(model.maxInputTokens) : '')
    setMaxOutputTokens(model.maxOutputTokens != null ? String(model.maxOutputTokens) : '')
    setInitializedModel(model)
  }, [model, open])

  const handleUpdateModel = useCallback(
    async ({ providerId, modelId, patch }: AutoSaveQueueItem) => {
      await updateModel(providerId, modelId, {
        name: patch.name,
        group: patch.group,
        capabilities: patch.capabilities,
        inputModalities: patch.inputModalities,
        outputModalities: patch.outputModalities,
        supportsStreaming: patch.supportsStreaming,
        endpointTypes: patch.endpointTypes,
        preferredEndpointType: patch.preferredEndpointType,
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
      const nextCacheReadPriceValue = overrides?.cacheReadPrice ?? cacheReadPrice
      // Empty means no dedicated rate (fall back to input); literal zero means cache reads are free.
      const nextCacheReadPrice = nextCacheReadPriceValue.trim() === '' ? undefined : Number(nextCacheReadPriceValue)
      const hasCacheReadPrice =
        nextCacheReadPrice !== undefined && Number.isFinite(nextCacheReadPrice) && nextCacheReadPrice >= 0
      const hasEndpointTypesOverride = overrides != null && Object.hasOwn(overrides, 'endpointTypes')
      const hasPurposeFieldsOverride = overrides != null && Object.hasOwn(overrides, 'purposeFields')
      const nextPurposeFields = overrides?.purposeFields ?? purposeFields
      const nextClassification = overrides?.classification
      const shouldApplyPurpose = mode === 'purpose' && (hasPurposeFieldsOverride || nextClassification != null)
      const effectiveClassification = nextClassification ?? classification
      const classifiedCapabilities =
        shouldApplyPurpose || nextClassification
          ? buildModelCapabilities(model.capabilities ?? [], effectiveClassification)
          : undefined
      const classifiedInputModalities =
        shouldApplyPurpose || nextClassification
          ? buildModelInputModalities(model.inputModalities ?? [], effectiveClassification)
          : undefined
      const resolvedPurposeFields =
        shouldApplyPurpose && classifiedCapabilities && classifiedInputModalities
          ? applyModelPurpose(
              {
                ...nextPurposeFields,
                capabilities: classifiedCapabilities,
                inputModalities: classifiedInputModalities
              },
              inferModelPurpose(nextPurposeFields),
              {
                previousPurpose: inferModelPurpose(nextPurposeFields),
                chatEndpointType: getInitialChatEndpointType(nextPurposeFields, defaultChatEndpoint)
              }
            )
          : null

      return {
        name: nextName || model.name,
        group: nextGroup || model.group,
        ...(hasPurposeFieldsOverride && resolvedPurposeFields
          ? { endpointTypes: [...resolvedPurposeFields.endpointTypes] }
          : hasEndpointTypesOverride
            ? {
                endpointTypes: mode === 'endpoint-types' ? [...(overrides.endpointTypes ?? [])] : undefined
              }
            : {}),
        ...(overrides?.preferredEndpointType ? { preferredEndpointType: overrides.preferredEndpointType } : {}),
        ...(resolvedPurposeFields
          ? {
              capabilities: resolvedPurposeFields.capabilities,
              inputModalities: resolvedPurposeFields.inputModalities
            }
          : nextClassification && classifiedCapabilities && classifiedInputModalities
            ? {
                capabilities: classifiedCapabilities,
                inputModalities: classifiedInputModalities
              }
            : {}),
        ...(hasPurposeFieldsOverride && resolvedPurposeFields
          ? { outputModalities: resolvedPurposeFields.outputModalities }
          : {}),
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
          ...(hasCacheReadPrice
            ? { cacheRead: { perMillionTokens: nextCacheReadPrice, currency: finalCurrency } }
            : {}),
          // Cache-write has no field in this drawer, but it must follow the selected currency:
          // `computeLanguageCost` sums every tier and labels the total with the input currency,
          // so a tier left behind in the old currency would be added across currencies.
          ...(model.pricing?.cacheWrite ? { cacheWrite: { ...model.pricing.cacheWrite, currency: finalCurrency } } : {})
        }
      }
    },
    [
      currencySymbol,
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
      purposeFields,
      classification,
      defaultChatEndpoint,
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
      const item: AutoSaveQueueItem = {
        providerId: model.providerId ?? providerId,
        modelId,
        patch: buildPatch(overrides)
      }
      autoSavePendingItemsRef.current.set(`${item.providerId}/${item.modelId}`, item)
      void processAutoSaveQueue()
    },
    [buildPatch, model, processAutoSaveQueue, providerId]
  )

  const commitClassification = useCallback(
    (next: ModelClassificationState) => {
      setClassification(next)
      autoSave({ classification: next })
    },
    [autoSave]
  )

  const handlePrimaryTypeChange = useCallback(
    (primaryType: ModelPrimaryType) => {
      commitClassification({ ...classification, primaryType })
    },
    [classification, commitClassification]
  )

  const handleToggleCapability = useCallback(
    (capability: ModelCapabilityToggle) => {
      const capabilities = new Set(classification.capabilities)
      if (capabilities.has(capability)) {
        capabilities.delete(capability)
      } else {
        capabilities.add(capability)
      }
      commitClassification({ ...classification, capabilities })
    },
    [classification, commitClassification]
  )

  const handleToggleInputModality = useCallback(
    (modality: ModelInputModality) => {
      const inputModalities = new Set(classification.inputModalities)
      if (inputModalities.has(modality)) {
        inputModalities.delete(modality)
      } else {
        inputModalities.add(modality)
      }
      commitClassification({ ...classification, inputModalities })
    },
    [classification, commitClassification]
  )

  const handleResetClassification = useCallback(() => {
    const nextClassification = {
      ...savedClassification,
      capabilities: new Set(savedClassification.capabilities),
      inputModalities: new Set(savedClassification.inputModalities)
    }
    setClassification(nextClassification)
    autoSave({ classification: nextClassification })
  }, [autoSave, savedClassification])

  if (!provider || !model) {
    return <ProviderSettingsDrawer open={open} onClose={onClose} title={t('models.edit')} />
  }

  if (initializedModel !== model) {
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
              showEndpointType={mode === 'endpoint-types'}
              endpointTypeControl="chips"
              preferredEndpointOptions={preferredEndpointOptions}
              preferredEndpointType={activePreferredEndpoint}
              onPreferredEndpointTypeChange={(next) => {
                setPreferredEndpointType(next)
                autoSave({ preferredEndpointType: next })
              }}
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
            {mode === 'purpose' && (
              <ModelPurposeFieldsControl
                purpose={modelPurpose}
                chatEndpointType={chatEndpointType}
                chatEndpointTypes={providerChatEndpointTypes}
                onPurposeChange={(nextPurpose) => {
                  const nextPurposeFields = applyModelPurpose(purposeFields, nextPurpose, {
                    previousPurpose: modelPurpose,
                    chatEndpointType
                  })
                  const nextClassification = {
                    ...classification,
                    primaryType:
                      nextPurpose === 'chat'
                        ? classification.primaryType === 'image'
                          ? ('text' as const)
                          : classification.primaryType
                        : ('image' as const)
                  }
                  setPurposeFields(nextPurposeFields)
                  setEndpointTypes(nextPurposeFields.endpointTypes)
                  setClassification(nextClassification)
                  autoSave({ purposeFields: nextPurposeFields, classification: nextClassification })
                }}
                onChatEndpointTypeChange={(nextEndpointType) => {
                  const nextPurposeFields = applyModelPurpose(purposeFields, 'chat', {
                    previousPurpose: modelPurpose,
                    chatEndpointType: nextEndpointType
                  })
                  setPurposeFields(nextPurposeFields)
                  setEndpointTypes(nextPurposeFields.endpointTypes)
                  autoSave({ purposeFields: nextPurposeFields })
                }}
              />
            )}
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
                <ModelClassificationControls
                  value={classification}
                  hasChanges={hasClassificationChanges}
                  onPrimaryTypeChange={handlePrimaryTypeChange}
                  onCapabilityToggle={handleToggleCapability}
                  onInputModalityToggle={handleToggleInputModality}
                  onReset={handleResetClassification}
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
                    <span className="truncate font-normal text-[13px] text-muted-foreground leading-5">
                      {t('settings.models.add.supported_text_delta.label')}
                    </span>
                    <Tooltip content={t('settings.models.add.supported_text_delta.tooltip')}>
                      <span className="inline-flex h-5 w-4 shrink-0 items-center justify-center text-muted-foreground">
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
                      onBlur={() => autoSave({ cacheReadPrice })}
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
