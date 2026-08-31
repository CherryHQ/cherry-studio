import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  MenuItem,
  MenuList,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip
} from '@cherrystudio/ui'
import CopyIcon from '@renderer/components/icons/CopyIcon'
import { useModelMutations } from '@renderer/hooks/useModel'
import { useProvider } from '@renderer/hooks/useProvider'
import { toast } from '@renderer/services/toast'
import { getDefaultGroupName } from '@renderer/utils/naming'
import type { UpdateModelDto } from '@shared/data/api/schemas/models'
import { type EndpointType, type Model, parseUniqueModelId } from '@shared/data/types/model'
import { CircleHelp } from 'lucide-react'
import { type FormEvent, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { drawerClasses, fieldClasses } from '../../primitives/ProviderSettingsPrimitives'
import {
  areModelClassificationsEqual,
  buildModelCapabilities,
  buildModelInputModalities,
  getInitialModelClassification,
  getModelApiId
} from './helpers'
import { ModelBasicFields } from './ModelBasicFields'
import { ModelClassificationControls } from './ModelClassificationControls'
import { ModelContextWindowFields } from './ModelContextWindowFields'
import { ModelPricingFields } from './ModelPricingFields'
import {
  applyModelPurpose,
  getInitialChatEndpointType,
  getModelDrawerMode,
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

type ModelPricingSection = 'base' | 'rules' | 'preview'
type ModelDialogTab = 'general' | 'capabilities' | 'limits' | `pricing.${ModelPricingSection}`

const railItemClassName =
  'h-8 flex-none justify-start rounded-[10px] border-transparent px-2.5 font-normal text-muted-foreground text-sm shadow-none hover:!bg-foreground/[0.04] hover:!text-foreground focus-visible:!border-transparent focus-visible:!ring-1 focus-visible:!ring-foreground/20 focus-visible:!ring-offset-0 data-[active=true]:!border-transparent data-[active=true]:!bg-foreground/[0.08] data-[active=true]:!font-medium data-[active=true]:!text-foreground data-[state=active]:!shadow-none'
const railSecondaryItemClassName =
  'h-7 flex-none justify-start rounded-lg border-transparent px-2.5 pl-5 font-normal text-muted-foreground text-xs shadow-none hover:!bg-foreground/[0.04] hover:!text-foreground focus-visible:!border-transparent focus-visible:!ring-1 focus-visible:!ring-foreground/20 focus-visible:!ring-offset-0 data-[active=true]:!border-transparent data-[active=true]:!bg-foreground/[0.08] data-[active=true]:!font-medium data-[active=true]:!text-foreground data-[state=active]:!shadow-none'

export default function EditModelDrawer({ providerId, open, model: modelProp, onClose }: EditModelDrawerProps) {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)
  const { updateModel } = useModelMutations()
  const previousModelRef = useRef<Model | null>(modelProp)
  if (modelProp) previousModelRef.current = modelProp

  const model = modelProp ?? previousModelRef.current
  const [activeTab, setActiveTab] = useState<ModelDialogTab>('general')
  const [name, setName] = useState('')
  const [group, setGroup] = useState('')
  const [endpointTypes, setEndpointTypes] = useState<EndpointType[]>([])
  const [purposeFields, setPurposeFields] = useState<ModelPurposeFields>({})
  const [classification, setClassification] = useState<ModelClassificationState>(() => getInitialModelClassification())
  const [supportsStreaming, setSupportsStreaming] = useState<Model['supportsStreaming']>(true)
  const [contextWindow, setContextWindow] = useState('')
  const [maxInputTokens, setMaxInputTokens] = useState('')
  const [maxOutputTokens, setMaxOutputTokens] = useState('')
  const [pricingOverride, setPricingOverride] = useState<Model['pricing'] | null | undefined>(undefined)
  const [isPricingValid, setIsPricingValid] = useState(true)
  const [showPricingValidation, setShowPricingValidation] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [initializedModel, setInitializedModel] = useState<Model | null>(null)
  const saveInFlightRef = useRef(false)

  const mode: ModelDrawerMode = provider ? getModelDrawerMode(provider) : 'legacy'
  const providerChatEndpointTypes = provider ? getProviderChatEndpointTypes(provider) : []
  const defaultChatEndpoint = providerChatEndpointTypes[0]
  const modelPurpose = inferModelPurpose(purposeFields)
  const chatEndpointType = getInitialChatEndpointType(purposeFields, defaultChatEndpoint)
  const apiModelId = useMemo(() => (model ? getModelApiId(model) : ''), [model])
  const savedClassification = useMemo(() => getInitialModelClassification(model), [model])
  const hasClassificationChanges = !areModelClassificationsEqual(classification, savedClassification)

  useLayoutEffect(() => {
    if (!open || !model) return

    setActiveTab('general')
    setName(model.name)
    setGroup(model.group ?? '')
    setEndpointTypes(model.endpointTypes?.length ? [...model.endpointTypes] : [])
    setPurposeFields({
      endpointTypes: model.endpointTypes,
      capabilities: model.capabilities,
      inputModalities: model.inputModalities,
      outputModalities: model.outputModalities
    })
    setClassification(getInitialModelClassification(model))
    setSupportsStreaming(model.supportsStreaming)
    setContextWindow(model.contextWindow != null ? String(model.contextWindow) : '')
    setMaxInputTokens(model.maxInputTokens != null ? String(model.maxInputTokens) : '')
    setMaxOutputTokens(model.maxOutputTokens != null ? String(model.maxOutputTokens) : '')
    setPricingOverride(undefined)
    setIsPricingValid(true)
    setShowPricingValidation(false)
    setSaveError(null)
    setInitializedModel(model)
  }, [model, open])

  const buildPatch = useCallback((): UpdateModelDto => {
    if (!model) return {}

    const classifiedCapabilities = buildModelCapabilities(model.capabilities ?? [], classification)
    const classifiedInputModalities = buildModelInputModalities(model.inputModalities ?? [], classification)
    const resolvedPurposeFields =
      mode === 'purpose'
        ? applyModelPurpose(
            {
              ...purposeFields,
              capabilities: classifiedCapabilities,
              inputModalities: classifiedInputModalities
            },
            modelPurpose,
            {
              previousPurpose: modelPurpose,
              chatEndpointType
            }
          )
        : null

    return {
      name: name || model.name,
      group: group || model.group,
      ...(resolvedPurposeFields
        ? {
            endpointTypes: [...resolvedPurposeFields.endpointTypes],
            capabilities: resolvedPurposeFields.capabilities,
            inputModalities: resolvedPurposeFields.inputModalities,
            outputModalities: resolvedPurposeFields.outputModalities
          }
        : {
            ...(mode === 'endpoint-types' ? { endpointTypes: [...endpointTypes] } : {}),
            capabilities: classifiedCapabilities,
            inputModalities: classifiedInputModalities
          }),
      supportsStreaming,
      contextWindow: Number(contextWindow) || undefined,
      maxInputTokens: Number(maxInputTokens) || undefined,
      maxOutputTokens: Number(maxOutputTokens) || undefined,
      ...(pricingOverride !== undefined ? { pricing: pricingOverride } : {})
    }
  }, [
    chatEndpointType,
    classification,
    contextWindow,
    endpointTypes,
    group,
    maxInputTokens,
    maxOutputTokens,
    mode,
    model,
    modelPurpose,
    name,
    pricingOverride,
    purposeFields,
    supportsStreaming
  ])

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!model || saveInFlightRef.current) return
      if (!isPricingValid) {
        setShowPricingValidation(true)
        setActiveTab('pricing.rules')
        return
      }

      saveInFlightRef.current = true
      setIsSaving(true)
      setSaveError(null)
      const { modelId } = parseUniqueModelId(model.id)

      try {
        await updateModel(model.providerId ?? providerId, modelId, buildPatch())
        onClose()
      } catch {
        setSaveError(t('settings.models.manage.operation_failed'))
      } finally {
        saveInFlightRef.current = false
        setIsSaving(false)
      }
    },
    [buildPatch, isPricingValid, model, onClose, providerId, t, updateModel]
  )

  const handleClose = useCallback(() => {
    if (!isSaving) onClose()
  }, [isSaving, onClose])

  const handlePrimaryTypeChange = useCallback((primaryType: ModelPrimaryType) => {
    setClassification((current) => ({ ...current, primaryType }))
  }, [])

  const handleToggleCapability = useCallback((capability: ModelCapabilityToggle) => {
    setClassification((current) => {
      const capabilities = new Set(current.capabilities)
      if (capabilities.has(capability)) capabilities.delete(capability)
      else capabilities.add(capability)
      return { ...current, capabilities }
    })
  }, [])

  const handleToggleInputModality = useCallback((modality: ModelInputModality) => {
    setClassification((current) => {
      const inputModalities = new Set(current.inputModalities)
      if (inputModalities.has(modality)) inputModalities.delete(modality)
      else inputModalities.add(modality)
      return { ...current, inputModalities }
    })
  }, [])

  const handleResetClassification = useCallback(() => {
    setClassification({
      ...savedClassification,
      capabilities: new Set(savedClassification.capabilities),
      inputModalities: new Set(savedClassification.inputModalities)
    })
  }, [savedClassification])

  if (!provider || !model || initializedModel !== model) {
    return <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()} />
  }

  const effectivePricingSource =
    pricingOverride === undefined ? model.pricingSource : pricingOverride === null ? 'provider' : 'user'
  const pricingSection = activeTab.startsWith('pricing.')
    ? (activeTab.slice('pricing.'.length) as ModelPricingSection)
    : null

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <DialogContent
        size="xl"
        aria-describedby={undefined}
        closeOnOverlayClick={!isSaving}
        data-testid="provider-settings-model-edit-dialog"
        className="flex h-[min(640px,calc(100vh-4rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[800px]">
        <form
          id="provider-settings-model-edit-form"
          data-testid="provider-settings-model-edit-dialog-content"
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => void handleSubmit(event)}>
          <DialogHeader className="shrink-0 border-border-subtle border-b px-6 py-4 pr-12">
            <DialogTitle className="text-base leading-5">{t('models.edit')}</DialogTitle>
          </DialogHeader>

          <fieldset disabled={isSaving} className="min-h-0 flex-1 border-0 p-0">
            <Tabs
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as ModelDialogTab)}
              orientation="vertical"
              className="h-full min-h-0 gap-0 overflow-hidden">
              <div className="flex w-44 shrink-0 flex-col border-border border-r-[0.5px] bg-background-subtle">
                <TabsList asChild className="h-auto w-full items-stretch justify-start rounded-none bg-transparent p-3">
                  <MenuList aria-label={t('models.edit')}>
                    {(
                      [
                        ['general', t('settings.general.title')],
                        ['capabilities', t('settings.models.add.capabilities.label')],
                        ['limits', t('settings.models.add.context_window.label')]
                      ] as const
                    ).map(([value, label]) => (
                      <TabsTrigger key={value} value={value} asChild>
                        <MenuItem label={label} active={activeTab === value} className={railItemClassName} />
                      </TabsTrigger>
                    ))}
                    <div className="grid gap-1">
                      <MenuItem
                        label={t('models.price.title')}
                        aria-expanded={pricingSection != null}
                        className={railItemClassName}
                        onClick={() => {
                          if (!pricingSection) setActiveTab('pricing.base')
                        }}
                      />
                      {pricingSection ? (
                        <div className="grid gap-0.5">
                          {(
                            [
                              ['base', t('models.price.base_title')],
                              ['rules', t('models.price.rule.title')],
                              ['preview', t('models.price.preview.title')]
                            ] as const
                          ).map(([section, label]) => {
                            const value = `pricing.${section}` as const
                            return (
                              <TabsTrigger key={value} value={value} asChild>
                                <MenuItem
                                  label={label}
                                  active={activeTab === value}
                                  className={railSecondaryItemClassName}
                                />
                              </TabsTrigger>
                            )
                          })}
                        </div>
                      ) : null}
                    </div>
                  </MenuList>
                </TabsList>
              </div>

              <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-5">
                <TabsContent forceMount value="general" className="mt-0 space-y-4 data-[state=inactive]:hidden">
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
                      layout="horizontal"
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
                      onGroupChange={setGroup}
                      onEndpointTypesChange={(next) => setEndpointTypes([...next])}
                    />
                    {mode === 'purpose' ? (
                      <ModelPurposeFieldsControl
                        purpose={modelPurpose}
                        chatEndpointType={chatEndpointType}
                        chatEndpointTypes={providerChatEndpointTypes}
                        onPurposeChange={(nextPurpose) => {
                          setPurposeFields((current) =>
                            applyModelPurpose(current, nextPurpose, {
                              previousPurpose: inferModelPurpose(current),
                              chatEndpointType
                            })
                          )
                          if (nextPurpose !== 'chat') {
                            setClassification((current) => ({ ...current, primaryType: 'image' }))
                          }
                        }}
                        onChatEndpointTypeChange={(nextEndpointType) => {
                          setPurposeFields((current) =>
                            applyModelPurpose(current, 'chat', {
                              previousPurpose: inferModelPurpose(current),
                              chatEndpointType: nextEndpointType
                            })
                          )
                        }}
                      />
                    ) : null}
                  </div>
                </TabsContent>

                <TabsContent forceMount value="capabilities" className="mt-0 space-y-4 data-[state=inactive]:hidden">
                  <ModelClassificationControls
                    value={classification}
                    hasChanges={hasClassificationChanges}
                    onPrimaryTypeChange={handlePrimaryTypeChange}
                    onCapabilityToggle={handleToggleCapability}
                    onInputModalityToggle={handleToggleInputModality}
                    onReset={handleResetClassification}
                  />

                  <div className="border-border-subtle border-t pt-4">
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="font-normal text-[13px] text-muted-foreground leading-5">
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
                        onCheckedChange={setSupportsStreaming}
                      />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent forceMount value="limits" className="mt-0 space-y-3.5 data-[state=inactive]:hidden">
                  <ModelContextWindowFields
                    contextWindow={contextWindow}
                    maxInputTokens={maxInputTokens}
                    maxOutputTokens={maxOutputTokens}
                    onContextWindowChange={setContextWindow}
                    onMaxInputTokensChange={setMaxInputTokens}
                    onMaxOutputTokensChange={setMaxOutputTokens}
                  />
                </TabsContent>

                <div className={pricingSection ? 'block' : 'hidden'}>
                  <ModelPricingFields
                    key={`${providerId}:${model.id}`}
                    pricing={model.pricing}
                    pricingSource={effectivePricingSource}
                    section={pricingSection ?? 'base'}
                    showValidation={showPricingValidation}
                    onCommit={setPricingOverride}
                    onValidityChange={(valid) => {
                      setIsPricingValid(valid)
                      if (valid) setShowPricingValidation(false)
                    }}
                    onRestoreProviderPricing={
                      model.presetModelId != null && effectivePricingSource === 'user'
                        ? () => {
                            setPricingOverride(null)
                            setIsPricingValid(true)
                            setShowPricingValidation(false)
                          }
                        : undefined
                    }
                  />
                </div>
              </div>
            </Tabs>
          </fieldset>

          <DialogFooter className="shrink-0 border-border-subtle border-t px-6 py-4">
            {saveError ? (
              <div role="alert" className="mr-auto self-center text-error-subtle-foreground text-xs leading-4">
                {saveError}
              </div>
            ) : null}
            <Button type="button" variant="outline" disabled={isSaving} onClick={handleClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={isSaving} aria-busy={isSaving || undefined}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
