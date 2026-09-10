import { Button, Switch, Tooltip } from '@cherrystudio/ui'
import CopyIcon from '@renderer/components/icons/CopyIcon'
import { useModelMutations } from '@renderer/hooks/useModel'
import { useProvider } from '@renderer/hooks/useProvider'
import { toast } from '@renderer/services/toast'
import { getDefaultGroupName } from '@renderer/utils/naming'
import type { UpdateModelDto } from '@shared/data/api/schemas/models'
import { type EndpointType, type Model, MODEL_OVERRIDE_FIELDS, parseUniqueModelId } from '@shared/data/types/model'
import { getModelPreferredEndpoint } from '@shared/utils/provider'
import { ChevronDown, ChevronUp, CircleHelp, X } from 'lucide-react'
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
import {
  resolveEndpointTypeOptions,
  resolveInheritedOperationCapability,
  resolvePreferredEndpointOptions
} from './modelEndpointRouting'
import { ModelPricingFields } from './ModelPricingFields'
import type {
  EditableModelOperationCapability,
  ModelCapabilityToggle,
  ModelClassificationState,
  ModelInputModality
} from './types'

interface EditModelDrawerProps {
  providerId: string
  open: boolean
  model: Model | null
  onClose: () => void
}

type ModelOverrideField = (typeof MODEL_OVERRIDE_FIELDS)[number]

/** Label key per override field; the drawer already names most of them as inputs. */
const OVERRIDE_FIELD_LABEL_KEYS: Record<ModelOverrideField, string> = {
  name: 'settings.models.add.model_name.label',
  description: 'settings.models.edit.overrides.field.description',
  group: 'settings.models.add.group_name.label',
  capabilities: 'settings.models.add.capabilities.label',
  inputModalities: 'settings.models.add.input_modalities.label',
  outputModalities: 'settings.models.edit.overrides.field.output_modalities',
  endpointTypes: 'settings.models.add.endpoint_type.label',
  preferredEndpointType: 'settings.models.add.preferred_endpoint.label',
  contextWindow: 'settings.models.add.context_window.label',
  maxInputTokens: 'settings.models.add.max_input_tokens.label',
  maxOutputTokens: 'settings.models.add.max_output_tokens.label',
  supportsStreaming: 'settings.models.add.supported_text_delta.label',
  parameterSupport: 'settings.models.edit.overrides.field.parameter_support',
  pricing: 'settings.models.edit.overrides.field.pricing'
}

interface BuildPatchOverrides {
  /** Hand one field back to the registry (`null`). */
  followRegistry?: ModelOverrideField
  name?: string
  group?: string
  endpointTypes?: EndpointType[]
  /** `null` clears the pin; `undefined` leaves it untouched. */
  preferredEndpointType?: EndpointType | null
  /** `null` hands capabilities and input modalities back to the registry. */
  classification?: ModelClassificationState | null
  supportsStreaming?: boolean
  pricing?: Model['pricing']
  contextWindow?: number | null
  maxInputTokens?: number | null
  maxOutputTokens?: number | null
}

interface AutoSaveQueueItem {
  providerId: string
  modelId: string
  patch: UpdateModelDto
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
  const [contextWindow, setContextWindow] = useState<number | null>(null)
  const [maxInputTokens, setMaxInputTokens] = useState<number | null>(null)
  const [maxOutputTokens, setMaxOutputTokens] = useState<number | null>(null)
  const [initializedModel, setInitializedModel] = useState<Model | null>(null)
  const autoSavePendingItemsRef = useRef(new Map<string, AutoSaveQueueItem>())
  const autoSaveRunningRef = useRef(false)

  const endpointTypeOptions = resolveEndpointTypeOptions(provider, classification.operationCapabilities)
  // A pin must name a declared endpoint; offering the provider's list to an undeclared model would
  // need that list written into the row first. Declare endpoints, then pin.
  const preferredEndpointOptions = endpointTypes.length
    ? resolvePreferredEndpointOptions(provider, endpointTypes, classification.operationCapabilities)
    : []
  // State holds this session's choice only; everything else derives from the model, so the picker
  // still shows the right chip when the provider resolves after the first render.
  const storedPreferredEndpoint =
    preferredEndpointType === undefined ? model?.preferredEndpointType : preferredEndpointType
  const pinnedPreferredEndpoint =
    storedPreferredEndpoint != null && preferredEndpointOptions.includes(storedPreferredEndpoint)
      ? storedPreferredEndpoint
      : undefined
  const inheritedOperation = resolveInheritedOperationCapability(endpointTypes, classification.operationCapabilities)
  // What clearing the pin resolves to, so the inherit chip can name it rather than being a blind choice.
  const inheritedEndpoint =
    model && provider && inheritedOperation
      ? getModelPreferredEndpoint(
          {
            ...model,
            endpointTypes: endpointTypes.length ? endpointTypes : undefined,
            preferredEndpointType: undefined
          },
          provider,
          inheritedOperation
        )
      : undefined
  const apiModelId = useMemo(() => (model ? getModelApiId(model) : ''), [model])
  const overriddenFields = MODEL_OVERRIDE_FIELDS.filter((field) => model?.overrides?.[field])
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
    setContextWindow(model.contextWindow ?? null)
    setMaxInputTokens(model.maxInputTokens ?? null)
    setMaxOutputTokens(model.maxOutputTokens ?? null)
    setInitializedModel(model)
  }, [model, open])

  const handleUpdateModel = useCallback(
    async ({ providerId, modelId, patch }: AutoSaveQueueItem) => {
      await updateModel(providerId, modelId, patch)
    },
    [updateModel]
  )

  const buildPatch = useCallback(
    (overrides: BuildPatchOverrides): UpdateModelDto => {
      if (!model) {
        return {}
      }
      // Every field present here is stored as an override, so only what the user touched goes out.
      const has = (key: keyof BuildPatchOverrides) => Object.hasOwn(overrides, key)
      const nextClassification = overrides.classification

      return {
        ...(overrides.followRegistry ? { [overrides.followRegistry]: null } : {}),
        ...(has('name') ? { name: overrides.name || model.name } : {}),
        ...(has('group') ? { group: overrides.group || model.group } : {}),
        ...(has('endpointTypes') ? { endpointTypes: [...(overrides.endpointTypes ?? [])] } : {}),
        // `null` is a real value here (clear the pin), so test for presence, not truthiness.
        ...(has('preferredEndpointType') ? { preferredEndpointType: overrides.preferredEndpointType } : {}),
        ...(nextClassification === null ? { capabilities: null, inputModalities: null } : {}),
        ...(nextClassification
          ? {
              capabilities: buildModelCapabilities(model.capabilities ?? [], nextClassification),
              inputModalities: buildModelInputModalities(model.inputModalities ?? [], nextClassification)
            }
          : {}),
        ...(has('supportsStreaming') ? { supportsStreaming: overrides.supportsStreaming } : {}),
        ...(has('contextWindow') ? { contextWindow: overrides.contextWindow } : {}),
        ...(has('maxInputTokens') ? { maxInputTokens: overrides.maxInputTokens } : {}),
        ...(has('maxOutputTokens') ? { maxOutputTokens: overrides.maxOutputTokens } : {}),
        ...(has('pricing') ? { pricing: overrides.pricing } : {})
      }
    },
    [model]
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
    (overrides: BuildPatchOverrides) => {
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
      // An inherited list narrows itself on read; only a list the row owns is rewritten.
      const ownsEndpointTypes = !model?.presetModelId || Boolean(model.overrides?.endpointTypes)
      autoSave({
        classification: nextClassification,
        ...(ownsEndpointTypes && nextEndpointTypes.length !== endpointTypes.length
          ? { endpointTypes: nextEndpointTypes }
          : {}),
        ...(shouldClearPreference ? { preferredEndpointType: null } : {})
      })
    },
    [autoSave, classification, endpointTypes, model, provider, storedPreferredEndpoint]
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
    autoSave(model?.presetModelId ? { classification: null } : { classification: nextClassification })
  }, [autoSave, model?.presetModelId, savedClassification])

  const handlePreferredEndpointTypeChange = useCallback(
    (next: EndpointType | undefined) => {
      setPreferredEndpointType(next ?? null)
      autoSave({ preferredEndpointType: next ?? null })
    },
    [autoSave]
  )

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
              showEndpointType={endpointTypeOptions.length > 0}
              endpointTypeOptions={endpointTypeOptions}
              preferredEndpointOptions={preferredEndpointOptions}
              preferredEndpointType={pinnedPreferredEndpoint}
              inheritedEndpointType={inheritedEndpoint}
              onPreferredEndpointTypeChange={handlePreferredEndpointTypeChange}
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
              {overriddenFields.length > 0 && (
                <div className={drawerClasses.sectionCard}>
                  <div className={drawerClasses.fieldTitle}>{t('settings.models.edit.overrides.label')}</div>
                  <p className="text-muted-foreground text-xs">{t('settings.models.edit.overrides.hint')}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {overriddenFields.map((field) => {
                      const label = t(OVERRIDE_FIELD_LABEL_KEYS[field])
                      return (
                        <Button
                          key={field}
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={t('settings.models.edit.overrides.remove', { field: label })}
                          onClick={() => autoSave({ followRegistry: field })}>
                          {label}
                          <X size={12} />
                        </Button>
                      )
                    })}
                  </div>
                </div>
              )}
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
                  // The committed value is passed through rather than read back
                  // from state, which has not re-rendered yet at this point.
                  onContextWindowCommit={(contextWindow) => autoSave({ contextWindow })}
                  onMaxInputTokensChange={setMaxInputTokens}
                  onMaxInputTokensCommit={(maxInputTokens) => autoSave({ maxInputTokens })}
                  onMaxOutputTokensChange={setMaxOutputTokens}
                  onMaxOutputTokensCommit={(maxOutputTokens) => autoSave({ maxOutputTokens })}
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
