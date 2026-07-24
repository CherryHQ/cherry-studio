import { Button } from '@cherrystudio/ui'
import { useModelMutations, useModels } from '@renderer/hooks/useModel'
import { useProvider } from '@renderer/hooks/useProvider'
import { getDefaultGroupName } from '@renderer/utils/naming'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
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
  splitModelIds
} from './helpers'
import { ModelBasicFields } from './ModelBasicFields'
import { ModelClassificationControls } from './ModelClassificationControls'
import { ModelContextWindowFields } from './ModelContextWindowFields'
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
  AddModelDrawerPrefill,
  ModelBasicFormState,
  ModelCapabilityToggle,
  ModelDrawerMode,
  ModelInputModality,
  ModelPrimaryType
} from './types'

function getInitialPurposeFields(
  prefill: AddModelDrawerPrefill | null,
  defaultEndpointType: EndpointType
): ModelPurposeFields {
  const initialForm = getInitialAddModelFormState(prefill, defaultEndpointType)
  return {
    endpointTypes: initialForm.endpointTypes,
    capabilities: prefill?.model?.capabilities,
    inputModalities: prefill?.model?.inputModalities,
    outputModalities: prefill?.model?.outputModalities
  }
}

export interface AddModelDrawerFooterBinding {
  isSubmitting: boolean
  cancel: () => void
  submit: () => void
}

export interface AddModelFormPanelProps {
  providerId: string
  prefill: AddModelDrawerPrefill | null
  onSuccess: () => void
  onCancel: () => void
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
  const [purposeFields, setPurposeFields] = useState<ModelPurposeFields>(() =>
    getInitialPurposeFields(null, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
  )
  const [classification, setClassification] = useState(() => getInitialModelClassification())
  const [modelIdTouched, setModelIdTouched] = useState(false)
  const [endpointTypeTouched, setEndpointTypeTouched] = useState(false)
  const [showMoreSettings, setShowMoreSettings] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const submitInFlightRef = useRef(false)
  const modelIdInputRef = useRef<HTMLInputElement>(null)

  const mode: ModelDrawerMode = provider ? getModelDrawerMode(provider) : 'legacy'
  const providerChatEndpointTypes = provider ? getProviderChatEndpointTypes(provider) : []
  const defaultChatEndpoint = providerChatEndpointTypes[0] ?? ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  const modelPurpose = inferModelPurpose(purposeFields)
  const chatEndpointType = getInitialChatEndpointType(purposeFields, defaultChatEndpoint)

  useEffect(() => {
    setFormState(getInitialAddModelFormState(prefill, defaultChatEndpoint))
    setPurposeFields(getInitialPurposeFields(prefill, defaultChatEndpoint))
    setClassification(getInitialModelClassification(prefill?.model))
    setModelIdTouched(false)
    setEndpointTypeTouched(false)
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
        return false
      }

      const modelId = values.modelId.trim()

      if (models.some((model) => model.id.endsWith(`::${modelId}`))) {
        setSubmitError(t('error.model.exists'))
        return false
      }

      const classifiedCapabilities = buildModelCapabilities(prefill?.model?.capabilities ?? [], classification)
      const classifiedInputModalities = buildModelInputModalities(prefill?.model?.inputModalities ?? [], classification)
      const submittedPurposeFields =
        mode === 'purpose'
          ? applyModelPurpose(
              {
                ...purposeFields,
                capabilities: classifiedCapabilities,
                inputModalities: classifiedInputModalities
              },
              modelPurpose,
              {
                previousPurpose: 'chat',
                chatEndpointType
              }
            )
          : null

      await createModel({
        providerId,
        modelId,
        name: values.name ? values.name : modelId.toUpperCase(),
        group: values.group || getDefaultGroupName(modelId),
        endpointTypes:
          submittedPurposeFields != null
            ? [...submittedPurposeFields.endpointTypes]
            : mode === 'endpoint-types' && values.endpointTypes?.length
              ? [...values.endpointTypes]
              : undefined,
        capabilities: submittedPurposeFields?.capabilities ?? classifiedCapabilities,
        inputModalities: submittedPurposeFields?.inputModalities ?? classifiedInputModalities,
        outputModalities: submittedPurposeFields?.outputModalities,
        ...(values.contextWindow ? { contextWindow: Number(values.contextWindow) } : {}),
        ...(values.maxInputTokens ? { maxInputTokens: Number(values.maxInputTokens) } : {}),
        ...(values.maxOutputTokens ? { maxOutputTokens: Number(values.maxOutputTokens) } : {})
      })

      return true
    },
    [
      chatEndpointType,
      classification,
      createModel,
      mode,
      modelPurpose,
      models,
      prefill?.model,
      provider,
      providerId,
      purposeFields,
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
        let addedCount = 0
        for (const singleId of splitModelIds(normalizedId)) {
          const added = await addSingleModel({
            modelId: singleId,
            name: singleId,
            group: '',
            contextWindow: '',
            maxInputTokens: '',
            maxOutputTokens: '',
            endpointTypes: formState.endpointTypes
          })

          if (added) {
            addedCount += 1
          }
        }

        if (addedCount > 0) {
          onSuccess()
        }
        return
      }

      if (
        await addSingleModel({
          ...formState,
          modelId: normalizedId
        })
      ) {
        onSuccess()
      }
    } catch {
      setSubmitError(t('settings.models.manage.operation_failed'))
    } finally {
      submitInFlightRef.current = false
      setIsSubmitting(false)
    }
  }, [addSingleModel, formState, mode, onSuccess, t])

  const handlePrimaryTypeChange = useCallback((primaryType: ModelPrimaryType) => {
    setClassification((current) => ({ ...current, primaryType }))
  }, [])

  const handleCapabilityToggle = useCallback((capability: ModelCapabilityToggle) => {
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
            showRequiredIndicator
            layout="horizontal"
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
              setFormState((current) => ({ ...current, endpointTypes: [...next] }))
            }}
          />
          {mode === 'purpose' && (
            <ModelPurposeFieldsControl
              purpose={modelPurpose}
              chatEndpointType={chatEndpointType}
              chatEndpointTypes={providerChatEndpointTypes}
              onPurposeChange={(nextPurpose) => {
                setClassification((current) => ({
                  ...current,
                  primaryType:
                    nextPurpose === 'chat' ? (current.primaryType === 'image' ? 'text' : current.primaryType) : 'image'
                }))
                setPurposeFields((current) =>
                  applyModelPurpose(current, nextPurpose, {
                    previousPurpose: inferModelPurpose(current),
                    chatEndpointType
                  })
                )
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
          )}
        </div>
      </ProviderSection>

      {submitError && (
        <div
          role="alert"
          className="rounded-md border border-error-border bg-error-bg px-3 py-2 text-error-text text-xs leading-4">
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
                onPrimaryTypeChange={handlePrimaryTypeChange}
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
