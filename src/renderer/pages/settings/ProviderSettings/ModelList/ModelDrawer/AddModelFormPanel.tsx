import { Button } from '@cherrystudio/ui'
import { useModelMutations, useModels } from '@renderer/hooks/useModel'
import { useProvider, useProviderPreset } from '@renderer/hooks/useProvider'
import { getDefaultGroupName } from '@renderer/utils/naming'
import { createUniqueModelId, ENDPOINT_TYPE, type EndpointType, type UniqueModelId } from '@shared/data/types/model'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderActions from '../../primitives/ProviderActions'
import ProviderSection from '../../primitives/ProviderSection'
import { drawerClasses } from '../../primitives/ProviderSettingsPrimitives'
import {
  buildModelCapabilities,
  buildModelInputModalities,
  getInitialAddModelFormState,
  getInitialModelClassification,
  getModelApiId,
  splitModelIds
} from './helpers'
import { ModelBasicFields } from './ModelBasicFields'
import { ModelClassificationControls } from './ModelClassificationControls'
import { ModelContextWindowFields } from './ModelContextWindowFields'
import {
  getModelDrawerMode,
  getProviderChatEndpointTypes,
  resolveEndpointTypeOptions,
  resolvePreferredEndpointOptions
} from './modelEndpointRouting'
import type {
  AddModelDrawerPrefill,
  EditableModelOperationCapability,
  ModelBasicFormState,
  ModelCapabilityToggle,
  ModelDrawerMode,
  ModelInputModality
} from './types'

const PROVIDER_PRESET_MODEL_FIELDS = ['models'] as const

export interface AddModelDrawerFooterBinding {
  isSubmitting: boolean
  cancel: () => void
  submit: () => void
}

export interface AddModelFormPanelProps {
  providerId: string
  prefill: AddModelDrawerPrefill | null
  onSuccess: (modelIds: UniqueModelId[]) => void
  onCancel: () => void
  showPurposeSelection?: boolean
  onDrawerFooterBinding?: (binding: AddModelDrawerFooterBinding | null) => void
  formId?: string
  'data-testid'?: string
}

export default function AddModelFormPanel({
  providerId,
  prefill,
  onSuccess,
  onCancel,
  onDrawerFooterBinding,
  formId = 'provider-settings-model-add-form',
  'data-testid': dataTestId = 'provider-settings-model-add-drawer-content'
}: AddModelFormPanelProps) {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)
  const { models } = useModels({ providerId })
  const { createModel } = useModelMutations()
  const [formState, setFormState] = useState<ModelBasicFormState>(() =>
    getInitialAddModelFormState(null, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
  )
  const [classification, setClassification] = useState(() => getInitialModelClassification())
  const [modelIdTouched, setModelIdTouched] = useState(false)
  const [endpointTypeTouched, setEndpointTypeTouched] = useState(false)
  // Undefined until the user picks: an untouched picker must not pin the model to today's default.
  const [preferredEndpointType, setPreferredEndpointType] = useState<EndpointType | undefined>(undefined)
  const [classificationTouched, setClassificationTouched] = useState(false)
  const [inputModalitiesTouched, setInputModalitiesTouched] = useState(false)
  const [showMoreSettings, setShowMoreSettings] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const submitInFlightRef = useRef(false)
  const modelIdInputRef = useRef<HTMLInputElement>(null)

  const mode: ModelDrawerMode = provider ? getModelDrawerMode(provider) : 'legacy'
  const providerChatEndpointTypes = provider ? getProviderChatEndpointTypes(provider) : []
  const defaultChatEndpoint = providerChatEndpointTypes[0] ?? ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  const endpointTypeOptions = resolveEndpointTypeOptions(provider, classification.operationCapabilities)
  const { data: providerPreset } = useProviderPreset(
    provider && mode === 'legacy' ? providerId : null,
    PROVIDER_PRESET_MODEL_FIELDS
  )
  const enteredPresetEndpointTypes = splitModelIds(formState.modelId.trim().replaceAll('，', ',')).reduce<
    EndpointType[] | undefined
  >((commonEndpointTypes, modelId) => {
    const endpointTypes = providerPreset?.models?.find((model) => getModelApiId(model) === modelId)?.endpointTypes
    if (!endpointTypes?.length) return commonEndpointTypes
    if (commonEndpointTypes === undefined) return [...endpointTypes]
    return commonEndpointTypes.filter((endpointType) => endpointTypes.includes(endpointType))
  }, undefined)
  // An aggregator's multi-select IS the declaration; elsewhere the form seeds `endpointTypes` with the
  // provider default, which says nothing about the model, so it is not passed as one.
  const preferredEndpointOptions =
    mode === 'legacy' && enteredPresetEndpointTypes?.length === 0
      ? []
      : resolvePreferredEndpointOptions(
          provider,
          mode,
          mode === 'endpoint-types' ? formState.endpointTypes : enteredPresetEndpointTypes,
          classification.operationCapabilities
        )
  const pinnedPreferredEndpoint = preferredEndpointOptions.find((candidate) => candidate === preferredEndpointType)

  useEffect(() => {
    setFormState(getInitialAddModelFormState(prefill, defaultChatEndpoint))
    setClassification(getInitialModelClassification(prefill?.model))
    setModelIdTouched(false)
    setEndpointTypeTouched(false)
    setPreferredEndpointType(undefined)
    setClassificationTouched(false)
    setInputModalitiesTouched(false)
    setShowMoreSettings(false)
    setSubmitError(null)
  }, [defaultChatEndpoint, prefill])

  const handleModelIdChange = useCallback(
    (value: string) => {
      if (!provider) {
        return
      }

      setFormState((current) => ({
        ...current,
        modelId: value,
        name: value,
        group: getDefaultGroupName(value, provider.id)
      }))
      setSubmitError(null)
      if (value.trim()) {
        setModelIdTouched(false)
      }
    },
    [provider]
  )

  const addSingleModel = useCallback(
    async (values: ModelBasicFormState) => {
      if (!provider) {
        return null
      }

      const modelId = values.modelId.trim()

      if (models.some((model) => model.id.endsWith(`::${modelId}`))) {
        setSubmitError(t('error.model.exists'))
        return null
      }

      const classifiedCapabilities = buildModelCapabilities(prefill?.model?.capabilities ?? [], classification)
      const classifiedInputModalities = buildModelInputModalities(prefill?.model?.inputModalities ?? [], classification)
      const submittedInputModalities = classifiedInputModalities
      const isRegistryModel = providerPreset?.models?.some((model) => getModelApiId(model) === modelId) ?? false
      const shouldSubmitCapabilities =
        mode === 'endpoint-types' || prefill?.model != null || classificationTouched || !isRegistryModel
      const shouldSubmitInputModalities =
        inputModalitiesTouched ||
        prefill?.model?.inputModalities !== undefined ||
        (submittedInputModalities?.length ?? 0) > 0

      await createModel({
        providerId,
        modelId,
        name: values.name ? values.name : modelId.toUpperCase(),
        group: values.group || getDefaultGroupName(modelId),
        endpointTypes:
          mode === 'endpoint-types' && values.endpointTypes?.length ? [...values.endpointTypes] : undefined,
        ...(pinnedPreferredEndpoint ? { preferredEndpointType: pinnedPreferredEndpoint } : {}),
        ...(shouldSubmitCapabilities ? { capabilities: classifiedCapabilities } : {}),
        ...(shouldSubmitInputModalities ? { inputModalities: submittedInputModalities } : {}),
        outputModalities: prefill?.model?.outputModalities,
        ...(values.contextWindow ? { contextWindow: Number(values.contextWindow) } : {}),
        ...(values.maxInputTokens ? { maxInputTokens: Number(values.maxInputTokens) } : {}),
        ...(values.maxOutputTokens ? { maxOutputTokens: Number(values.maxOutputTokens) } : {})
      })

      return createUniqueModelId(providerId, modelId)
    },
    [
      classification,
      classificationTouched,
      createModel,
      mode,
      models,
      pinnedPreferredEndpoint,
      inputModalitiesTouched,
      prefill?.model,
      provider,
      providerId,
      providerPreset?.models,
      t
    ]
  )

  const submitAddModel = useCallback(async () => {
    if (submitInFlightRef.current) {
      return
    }

    const normalizedId = formState.modelId.trim().replaceAll('，', ',')
    if (!normalizedId) {
      setModelIdTouched(true)
      modelIdInputRef.current?.focus()
      return
    }

    if (mode === 'endpoint-types' && !(formState.endpointTypes?.length ?? 0)) {
      setEndpointTypeTouched(true)
      return
    }

    submitInFlightRef.current = true
    setIsSubmitting(true)
    setSubmitError(null)

    try {
      if (normalizedId.includes(',')) {
        const addedModelIds: UniqueModelId[] = []
        for (const singleId of splitModelIds(normalizedId)) {
          const addedModelId = await addSingleModel({
            modelId: singleId,
            name: singleId,
            group: '',
            contextWindow: '',
            maxInputTokens: '',
            maxOutputTokens: '',
            endpointTypes: formState.endpointTypes
          })

          if (addedModelId) {
            addedModelIds.push(addedModelId)
          }
        }

        if (addedModelIds.length > 0) {
          onSuccess(addedModelIds)
        }
        return
      }

      const addedModelId = await addSingleModel({
        ...formState,
        modelId: normalizedId
      })
      if (addedModelId) {
        onSuccess([addedModelId])
      }
    } catch {
      setSubmitError(t('settings.models.manage.operation_failed'))
    } finally {
      submitInFlightRef.current = false
      setIsSubmitting(false)
    }
  }, [addSingleModel, formState, mode, onSuccess, t])

  const handleOperationCapabilityToggle = useCallback(
    (operationCapability: EditableModelOperationCapability) => {
      const operationCapabilities = new Set(classification.operationCapabilities)
      if (operationCapabilities.has(operationCapability)) {
        if (operationCapabilities.size === 1) return
        operationCapabilities.delete(operationCapability)
      } else {
        operationCapabilities.add(operationCapability)
      }
      const allowedEndpoints = new Set(resolveEndpointTypeOptions(provider, operationCapabilities))
      setClassificationTouched(true)
      setClassification({ ...classification, operationCapabilities })
      setFormState((form) => ({
        ...form,
        endpointTypes: form.endpointTypes?.filter((endpointType) => allowedEndpoints.has(endpointType))
      }))
      setPreferredEndpointType((endpointType) =>
        endpointType && allowedEndpoints.has(endpointType) ? endpointType : undefined
      )
    },
    [classification, provider]
  )

  const handleCapabilityToggle = useCallback((capability: ModelCapabilityToggle) => {
    setClassificationTouched(true)
    setClassification((current) => {
      const capabilities = new Set(current.capabilities)
      if (capabilities.has(capability)) {
        capabilities.delete(capability)
      } else {
        capabilities.add(capability)
      }
      return { ...current, capabilities }
    })
  }, [])

  const handleInputModalityToggle = useCallback((modality: ModelInputModality) => {
    setClassificationTouched(true)
    setInputModalitiesTouched(true)
    setClassification((current) => {
      const inputModalities = new Set(current.inputModalities)
      if (inputModalities.has(modality)) {
        inputModalities.delete(modality)
      } else {
        inputModalities.add(modality)
      }
      return { ...current, inputModalities }
    })
  }, [])

  const handleFormSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      await submitAddModel()
    },
    [submitAddModel]
  )

  const submitRunnerRef = useRef(submitAddModel)
  submitRunnerRef.current = submitAddModel

  const runSubmit = useCallback(() => {
    void submitRunnerRef.current()
  }, [])

  useLayoutEffect(() => {
    if (!onDrawerFooterBinding) {
      return
    }

    if (!provider) {
      onDrawerFooterBinding(null)
      return
    }

    onDrawerFooterBinding({
      isSubmitting,
      cancel: onCancel,
      submit: runSubmit
    })
  }, [provider, isSubmitting, onCancel, onDrawerFooterBinding, runSubmit])

  useEffect(() => {
    if (!onDrawerFooterBinding) {
      return
    }

    return () => {
      onDrawerFooterBinding(null)
    }
  }, [onDrawerFooterBinding])

  if (!provider) {
    return null
  }

  const form = (
    <form
      id={formId}
      data-testid={dataTestId}
      className="flex min-h-0 flex-col gap-4 py-0"
      onSubmit={(event) => void handleFormSubmit(event)}>
      <ProviderSection className={drawerClasses.section}>
        <div className={drawerClasses.fieldList}>
          <ModelBasicFields
            values={formState}
            showEndpointType={mode === 'endpoint-types'}
            endpointTypeOptions={endpointTypeOptions}
            preferredEndpointOptions={preferredEndpointOptions}
            preferredEndpointType={pinnedPreferredEndpoint}
            inheritedEndpointType={preferredEndpointOptions[0]}
            onPreferredEndpointTypeChange={setPreferredEndpointType}
            showRequiredIndicator
            layout="horizontal"
            modelIdAutoFocus
            modelIdInputRef={modelIdInputRef}
            modelIdError={
              modelIdTouched && !formState.modelId.trim() ? t('settings.models.add.model_id.required') : undefined
            }
            endpointTypeError={endpointTypeTouched ? t('settings.models.add.endpoint_type.required') : undefined}
            onModelIdChange={handleModelIdChange}
            onNameChange={(value) => setFormState((current) => ({ ...current, name: value }))}
            onGroupChange={(value) => setFormState((current) => ({ ...current, group: value }))}
            onEndpointTypesChange={(next) => {
              setEndpointTypeTouched(false)
              setPreferredEndpointType((current) => (current && next.includes(current) ? current : undefined))
              setFormState((current) => ({ ...current, endpointTypes: [...next] }))
            }}
          />
        </div>
      </ProviderSection>

      {submitError && (
        <div
          role="alert"
          className="rounded-md border border-error-border bg-error-subtle px-3 py-2 text-error-subtle-foreground text-xs leading-4">
          {submitError}
        </div>
      )}

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
          <div className="space-y-4">
            <div className={drawerClasses.sectionCard}>
              <ModelClassificationControls
                value={classification}
                onOperationCapabilityToggle={handleOperationCapabilityToggle}
                onCapabilityToggle={handleCapabilityToggle}
                onInputModalityToggle={handleInputModalityToggle}
              />
            </div>

            <div className={drawerClasses.sectionCard}>
              <ModelContextWindowFields
                contextWindow={formState.contextWindow}
                maxInputTokens={formState.maxInputTokens}
                maxOutputTokens={formState.maxOutputTokens}
                onContextWindowChange={(value) => setFormState((current) => ({ ...current, contextWindow: value }))}
                onMaxInputTokensChange={(value) => setFormState((current) => ({ ...current, maxInputTokens: value }))}
                onMaxOutputTokensChange={(value) => setFormState((current) => ({ ...current, maxOutputTokens: value }))}
              />
            </div>
          </div>
        </ProviderSection>
      )}
    </form>
  )

  if (!onDrawerFooterBinding) {
    return (
      <>
        {form}
        <ProviderActions className={drawerClasses.footer}>
          <Button variant="outline" type="button" disabled={isSubmitting} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="button" loading={isSubmitting} onClick={() => void submitAddModel()}>
            {t('settings.models.add.add_model')}
          </Button>
        </ProviderActions>
      </>
    )
  }

  return form
}
