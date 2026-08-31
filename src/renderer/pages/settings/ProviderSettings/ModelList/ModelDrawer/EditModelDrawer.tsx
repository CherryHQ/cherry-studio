import { Button, Switch, Tooltip } from '@cherrystudio/ui'
import CopyIcon from '@renderer/components/icons/CopyIcon'
import { useModelMutations } from '@renderer/hooks/useModel'
import { useProvider } from '@renderer/hooks/useProvider'
import { toast } from '@renderer/services/toast'
import { getDefaultGroupName } from '@renderer/utils/naming'
import {
  endpointDefaultOperationCapability,
  type EndpointType,
  type Model,
  MODEL_CAPABILITY,
  parseUniqueModelId
} from '@shared/data/types/model'
import { getModelPreferredEndpoint } from '@shared/utils/provider'
import { ChevronDown, ChevronUp, CircleHelp } from 'lucide-react'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
import { getModelDrawerMode, resolveEndpointTypeOptions, resolvePreferredEndpointOptions } from './modelEndpointRouting'
import { ModelPricingFields } from './ModelPricingFields'
import type {
  EditableModelOperationCapability,
  ModelCapabilityToggle,
  ModelClassificationState,
  ModelDrawerMode,
  ModelInputModality
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
  /** `null` clears the pin; `undefined` leaves it untouched. */
  preferredEndpointType?: EndpointType | null
  classification?: ModelClassificationState
  supportsStreaming?: boolean
  pricing?: Model['pricing']
  contextWindow?: string
  maxInputTokens?: string
  maxOutputTokens?: string
}

/** `preferredEndpointType` widens to `null` so the drawer can clear the pin, which `Model` cannot express. */
type ModelPatch = Omit<Partial<Model>, 'preferredEndpointType'> & { preferredEndpointType?: EndpointType | null }

interface AutoSaveQueueItem {
  providerId: string
  modelId: string
  patch: ModelPatch
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
  // Tri-state: `undefined` = untouched this session, `null` = explicitly cleared, otherwise pinned.
  const [preferredEndpointType, setPreferredEndpointType] = useState<EndpointType | null | undefined>(undefined)
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
  const endpointTypeOptions = resolveEndpointTypeOptions(provider, classification.operationCapabilities)
  const preferredEndpointOptions = resolvePreferredEndpointOptions(
    provider,
    mode,
    endpointTypes,
    classification.operationCapabilities
  )
  // State holds this session's choice only; everything else derives from the model, so the picker
  // still shows the right chip when the provider resolves after the first render.
  const storedPreferredEndpoint =
    preferredEndpointType === undefined ? model?.preferredEndpointType : preferredEndpointType
  const pinnedPreferredEndpoint =
    storedPreferredEndpoint != null && preferredEndpointOptions.includes(storedPreferredEndpoint)
      ? storedPreferredEndpoint
      : undefined
  const inheritedOperation = endpointTypes[0]
    ? endpointDefaultOperationCapability(endpointTypes[0])
    : classification.operationCapabilities.has(MODEL_CAPABILITY.TEXT_GENERATION)
      ? MODEL_CAPABILITY.TEXT_GENERATION
      : [...classification.operationCapabilities][0]
  // What clearing the pin resolves to, so the inherit chip can name it rather than being a blind choice.
  const inheritedEndpoint =
    model && provider && inheritedOperation
      ? getModelPreferredEndpoint({ ...model, preferredEndpointType: undefined }, provider, inheritedOperation)
      : undefined
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
    setPreferredEndpointType(undefined)
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
        preferredEndpointType: patch.preferredEndpointType,
        contextWindow: patch.contextWindow,
        maxInputTokens: patch.maxInputTokens,
        maxOutputTokens: patch.maxOutputTokens,
        ...(Object.hasOwn(patch, 'pricing') ? { pricing: patch.pricing } : {})
      })
    },
    [updateModel]
  )

  const buildPatch = useCallback(
    (overrides?: BuildPatchOverrides): ModelPatch => {
      if (!model) {
        return {}
      }

      const nextName = overrides?.name ?? name
      const nextGroup = overrides?.group ?? group
      const hasEndpointTypesOverride = overrides != null && Object.hasOwn(overrides, 'endpointTypes')
      const hasPricingOverride = overrides != null && Object.hasOwn(overrides, 'pricing')
      const nextClassification = overrides?.classification
      const effectiveClassification = nextClassification ?? classification
      const classifiedCapabilities = nextClassification
        ? buildModelCapabilities(model.capabilities ?? [], effectiveClassification)
        : undefined
      const classifiedInputModalities = nextClassification
        ? buildModelInputModalities(model.inputModalities ?? [], effectiveClassification)
        : undefined

      return {
        name: nextName || model.name,
        group: nextGroup || model.group,
        ...(hasEndpointTypesOverride
          ? { endpointTypes: mode === 'endpoint-types' ? [...(overrides.endpointTypes ?? [])] : undefined }
          : {}),
        // `null` is a real value here (clear the pin), so test for presence, not truthiness.
        ...(overrides != null && Object.hasOwn(overrides, 'preferredEndpointType')
          ? { preferredEndpointType: overrides.preferredEndpointType }
          : {}),
        ...(nextClassification && classifiedCapabilities && classifiedInputModalities
          ? { capabilities: classifiedCapabilities, inputModalities: classifiedInputModalities }
          : {}),
        supportsStreaming: overrides?.supportsStreaming ?? supportsStreaming,
        contextWindow: Number(overrides?.contextWindow ?? contextWindow) || undefined,
        maxInputTokens: Number(overrides?.maxInputTokens ?? maxInputTokens) || undefined,
        maxOutputTokens: Number(overrides?.maxOutputTokens ?? maxOutputTokens) || undefined,
        ...(hasPricingOverride ? { pricing: overrides.pricing } : {})
      }
    },
    [group, contextWindow, maxInputTokens, maxOutputTokens, mode, model, name, classification, supportsStreaming]
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

  const handleOperationCapabilityToggle = useCallback(
    (operationCapability: EditableModelOperationCapability) => {
      const operationCapabilities = new Set(classification.operationCapabilities)
      if (operationCapabilities.has(operationCapability)) {
        if (operationCapabilities.size === 1) return
        operationCapabilities.delete(operationCapability)
      } else {
        operationCapabilities.add(operationCapability)
      }

      const nextClassification = { ...classification, operationCapabilities }
      const allowedEndpoints = new Set(resolveEndpointTypeOptions(provider, operationCapabilities))
      const nextEndpointTypes = endpointTypes.filter((endpointType) => allowedEndpoints.has(endpointType))
      const shouldClearPreference =
        storedPreferredEndpoint != null && !nextEndpointTypes.includes(storedPreferredEndpoint)
      setClassification(nextClassification)
      setEndpointTypes(nextEndpointTypes)
      if (shouldClearPreference) setPreferredEndpointType(null)
      autoSave({
        classification: nextClassification,
        endpointTypes: nextEndpointTypes,
        ...(shouldClearPreference ? { preferredEndpointType: null } : {})
      })
    },
    [autoSave, classification, endpointTypes, provider, storedPreferredEndpoint]
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
              endpointTypeOptions={endpointTypeOptions}
              preferredEndpointOptions={preferredEndpointOptions}
              preferredEndpointType={pinnedPreferredEndpoint}
              inheritedEndpointType={inheritedEndpoint}
              onPreferredEndpointTypeChange={(next) => {
                setPreferredEndpointType(next ?? null)
                autoSave({ preferredEndpointType: next ?? null })
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
                const shouldClearPreference =
                  storedPreferredEndpoint != null && !nextEndpointTypes.includes(storedPreferredEndpoint)
                setEndpointTypes(nextEndpointTypes)
                if (shouldClearPreference) setPreferredEndpointType(null)
                autoSave({
                  endpointTypes: nextEndpointTypes,
                  ...(shouldClearPreference ? { preferredEndpointType: null } : {})
                })
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
                <ModelClassificationControls
                  value={classification}
                  hasChanges={hasClassificationChanges}
                  onOperationCapabilityToggle={handleOperationCapabilityToggle}
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
