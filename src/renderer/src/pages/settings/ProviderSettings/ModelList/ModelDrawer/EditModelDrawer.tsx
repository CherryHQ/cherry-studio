import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@cherrystudio/ui'
import CopyIcon from '@renderer/components/Icons/CopyIcon'
import { useModelMutations } from '@renderer/hooks/useModels'
import { useProvider } from '@renderer/hooks/useProviders'
import { getDefaultGroupName } from '@renderer/utils'
import { CURRENCY, type Currency, type EndpointType, type Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import { ChevronDown, ChevronUp, SaveIcon } from 'lucide-react'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderActions from '../../primitives/ProviderActions'
import ProviderField from '../../primitives/ProviderField'
import ProviderSection from '../../primitives/ProviderSection'
import ProviderSettingsDrawer from '../../primitives/ProviderSettingsDrawer'
import { drawerClasses, fieldClasses } from '../../primitives/ProviderSettingsPrimitives'
import { isNewApiProvider } from '../../utils/provider'
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
  caps?: Set<ModelCapabilityToggle>
  supportsStreaming?: boolean
  currencySymbol?: ModelDrawerCurrencySymbol
  inputPrice?: string
  outputPrice?: string
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

const drawerFieldTitleClassName = 'text-[13px] text-foreground/85'

export default function EditModelDrawer({ providerId, open, model: modelProp, onClose }: EditModelDrawerProps) {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)
  const { deleteModel, updateModel } = useModelMutations()
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
  const [contextWindow, setContextWindow] = useState('')
  const [maxInputTokens, setMaxInputTokens] = useState('')
  const [maxOutputTokens, setMaxOutputTokens] = useState('')
  const [endpointTypeTouched, setEndpointTypeTouched] = useState(false)

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
    setContextWindow(model.contextWindow != null ? String(model.contextWindow) : '')
    setMaxInputTokens(model.maxInputTokens != null ? String(model.maxInputTokens) : '')
    setMaxOutputTokens(model.maxOutputTokens != null ? String(model.maxOutputTokens) : '')
    setEndpointTypeTouched(false)
  }, [model, open])

  const handleUpdateModel = useCallback(
    async (patch: Partial<Model>) => {
      if (!model) {
        return
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
    },
    [model, providerId, updateModel]
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

  const autoSave = useCallback(
    (overrides?: BuildPatchOverrides) => {
      void handleUpdateModel(buildPatch(overrides)).catch(() => {
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

    await handleUpdateModel(buildPatch())
    setShowMoreSettings(false)
    onClose()
  }, [buildPatch, endpointTypes.length, handleUpdateModel, mode, onClose])

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
          className="mr-auto px-2.5 text-destructive/80 shadow-none hover:bg-destructive/[0.06] hover:text-destructive"
          onClick={() => void handleDeleteModel()}>
          {t('common.delete')}
        </Button>
      ) : null}
      <Button variant="outline" onClick={onClose}>
        {t('common.cancel')}
      </Button>
      <Button type="button" onClick={() => void saveModel()}>
        <SaveIcon aria-hidden className="size-4 shrink-0 text-white" />
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
        className={drawerClasses.form}
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
            variant="outline"
            className={drawerClasses.toggleButton}
            onClick={() => setShowMoreSettings((current) => !current)}>
            {t('settings.moresetting.label')}
            {showMoreSettings ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </Button>
        </ProviderActions>

        {showMoreSettings && (
          <ProviderSection className={drawerClasses.section}>
            <div className="space-y-4" data-testid="provider-settings-model-more-settings">
              <ModelCapabilityToggles
                selectedCaps={selectedCaps}
                hasUserModified={hasUserModified}
                onToggle={handleToggleCapability}
                onReset={handleResetCapabilities}
              />

              <div className={drawerClasses.divider} />

              <ModelContextWindowFields
                contextWindow={contextWindow}
                maxInputTokens={maxInputTokens}
                maxOutputTokens={maxOutputTokens}
                onContextWindowChange={setContextWindow}
                onMaxInputTokensChange={setMaxInputTokens}
                onMaxOutputTokensChange={setMaxOutputTokens}
              />

              <div className={drawerClasses.divider} />

              <ProviderField
                title={t('settings.models.add.supported_text_delta.label')}
                titleClassName={drawerFieldTitleClassName}
                action={
                  <Switch
                    checked={supportsStreaming ?? false}
                    onCheckedChange={(checked) => {
                      setSupportsStreaming(checked)
                      autoSave({ supportsStreaming: checked })
                    }}
                  />
                }
                help={
                  <div className={drawerClasses.helpText}>{t('settings.models.add.supported_text_delta.tooltip')}</div>
                }>
                {null}
              </ProviderField>

              <div className={drawerClasses.divider} />

              <ProviderField title={t('models.price.currency')} titleClassName={drawerFieldTitleClassName}>
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

              <ProviderField title={t('models.price.input')} titleClassName={drawerFieldTitleClassName}>
                <div className={drawerClasses.valueRow}>
                  <input
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

              <ProviderField title={t('models.price.output')} titleClassName={drawerFieldTitleClassName}>
                <div className={drawerClasses.valueRow}>
                  <input
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
          </ProviderSection>
        )}
      </form>
    </ProviderSettingsDrawer>
  )
}
