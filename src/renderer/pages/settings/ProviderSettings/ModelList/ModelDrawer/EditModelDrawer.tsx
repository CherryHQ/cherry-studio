import { ChevronDown, ChevronUp, CircleHelp } from 'lucide-react'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Switch, Tooltip } from '@cherrystudio/ui'
import CopyIcon from '@renderer/components/icons/CopyIcon'
import { useModelMutations } from '@renderer/hooks/useModel'
import { useProvider } from '@renderer/hooks/useProvider'
import { toast } from '@renderer/services/toast'
import { getDefaultGroupName } from '@renderer/utils/naming'
import { type EndpointType, type Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'

import ProviderActions from '../../primitives/ProviderActions'
import ProviderSection from '../../primitives/ProviderSection'
import ProviderSettingsDrawer from '../../primitives/ProviderSettingsDrawer'
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

interface BuildPatchOverrides {
  name?: string
  group?: string
  endpointTypes?: EndpointType[]
  purposeFields?: ModelPurposeFields
  classification?: ModelClassificationState
  supportsStreaming?: boolean
  pricing?: Model['pricing']
  contextWindow?: string
  maxInputTokens?: string
  maxOutputTokens?: string
}

interface AutoSaveQueueItem {
  providerId: string
  modelId: string
  patch: Partial<Model>
}

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
  const [purposeFields, setPurposeFields] = useState<ModelPurposeFields>({})
  const [showMoreSettings, setShowMoreSettings] = useState(true)
  const [classification, setClassification] = useState<ModelClassificationState>(() => getInitialModelClassification())
  const [supportsStreaming, setSupportsStreaming] = useState<Model['supportsStreaming']>(true)
  const [contextWindow, setContextWindow] = useState('')
  const [maxInputTokens, setMaxInputTokens] = useState('')
  const [maxOutputTokens, setMaxOutputTokens] = useState('')
  const [initializedModel, setInitializedModel] = useState<Model | null>(null)
  const autoSavePendingItemsRef = useRef(new Map<string, AutoSaveQueueItem>())
  const autoSaveRunningRef = useRef(false)

  const mode: ModelDrawerMode = provider ? getModelDrawerMode(provider) : 'legacy'
  const providerChatEndpointTypes = provider ? getProviderChatEndpointTypes(provider) : []
  const defaultChatEndpoint = providerChatEndpointTypes[0]
  const modelPurpose = inferModelPurpose(purposeFields)
  const chatEndpointType = getInitialChatEndpointType(purposeFields, defaultChatEndpoint)
  const apiModelId = useMemo(() => (model ? getModelApiId(model) : ''), [model])
  const savedClassification = useMemo(() => getInitialModelClassification(model), [model])
  const hasClassificationChanges = !areModelClassificationsEqual(classification, savedClassification)

  useLayoutEffect(() => {
    if (!open || !model) {
      return
    }

    setName(model.name)
    setGroup(model.group ?? '')
    setEndpointTypes(model.endpointTypes?.length ? [...model.endpointTypes] : [])
    setPurposeFields({
      endpointTypes: model.endpointTypes,
      capabilities: model.capabilities,
      inputModalities: model.inputModalities,
      outputModalities: model.outputModalities
    })
    setShowMoreSettings(true)
    setClassification(getInitialModelClassification(model))
    setSupportsStreaming(model.supportsStreaming)
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
        contextWindow: patch.contextWindow,
        maxInputTokens: patch.maxInputTokens,
        maxOutputTokens: patch.maxOutputTokens,
        ...(Object.hasOwn(patch, 'pricing') ? { pricing: patch.pricing } : {})
      })
    },
    [updateModel]
  )

  const buildPatch = useCallback(
    (overrides?: BuildPatchOverrides): Partial<Model> => {
      if (!model) {
        return {}
      }

      const nextName = overrides?.name ?? name
      const nextGroup = overrides?.group ?? group
      const hasEndpointTypesOverride = overrides != null && Object.hasOwn(overrides, 'endpointTypes')
      const hasPurposeFieldsOverride = overrides != null && Object.hasOwn(overrides, 'purposeFields')
      const hasPricingOverride = overrides != null && Object.hasOwn(overrides, 'pricing')
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
        ...(hasPricingOverride ? { pricing: overrides.pricing } : {})
      }
    },
    [
      group,
      contextWindow,
      maxInputTokens,
      maxOutputTokens,
      mode,
      model,
      name,
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
      const queueKey = `${item.providerId}/${item.modelId}`
      const pendingItem = autoSavePendingItemsRef.current.get(queueKey)
      autoSavePendingItemsRef.current.set(
        queueKey,
        pendingItem ? { ...item, patch: { ...pendingItem.patch, ...item.patch } } : item
      )
      void processAutoSaveQueue()
    },
    [buildPatch, model, processAutoSaveQueue, providerId]
  )

  const handlePricingCommit = useCallback(
    (pricing: NonNullable<Model['pricing']>) => {
      autoSave({ pricing })
    },
    [autoSave]
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
                  onContextWindowCommit={(value) => autoSave({ contextWindow: value })}
                  onMaxInputTokensChange={setMaxInputTokens}
                  onMaxInputTokensCommit={(value) => autoSave({ maxInputTokens: value })}
                  onMaxOutputTokensChange={setMaxOutputTokens}
                  onMaxOutputTokensCommit={(value) => autoSave({ maxOutputTokens: value })}
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
                <ModelPricingFields
                  key={`${providerId}:${model.id}`}
                  pricing={model.pricing}
                  onCommit={handlePricingCommit}
                />
              </div>
            </div>
          </ProviderSection>
        )}
      </form>
    </ProviderSettingsDrawer>
  )
}
