import { ChevronDown, ChevronUp } from 'lucide-react'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { useModelMutations, useModels } from '@renderer/hooks/useModel'
import { useProvider } from '@renderer/hooks/useProvider'
import { getDefaultGroupName } from '@renderer/utils/naming'
import { createUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import ProviderActions from '../../primitives/ProviderActions'
import ProviderSection from '../../primitives/ProviderSection'
import { drawerClasses } from '../../primitives/ProviderSettingsPrimitives'
import { getInitialAddModelFormState, splitModelIds } from './helpers'
import { ModelBasicFields } from './ModelBasicFields'
import { ModelContextWindowFields } from './ModelContextWindowFields'
import { ModelMetadataControls } from './ModelMetadataControls'
import type { AddModelDrawerPrefill, ModelBasicFormState, ModelMetadata } from './types'

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
  const [formState, setFormState] = useState<ModelBasicFormState>(() => getInitialAddModelFormState(null))
  const [metadata, setMetadata] = useState<ModelMetadata>({ capabilities: [] })
  const [modelIdTouched, setModelIdTouched] = useState(false)
  const [showMoreSettings, setShowMoreSettings] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const submitInFlightRef = useRef(false)
  const modelIdInputRef = useRef<HTMLInputElement>(null)

  const defaultEndpointType = provider?.defaultChatEndpoint

  useEffect(() => {
    setFormState(getInitialAddModelFormState(prefill, defaultEndpointType))
    setMetadata({
      capabilities: prefill?.model?.capabilities ?? [],
      inputModalities: prefill?.model?.inputModalities,
      outputModalities: prefill?.model?.outputModalities
    })
    setModelIdTouched(false)
    setShowMoreSettings(false)
    setSubmitError(null)
  }, [defaultEndpointType, prefill])

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

      await createModel({
        providerId,
        modelId,
        name: values.name ? values.name : modelId.toUpperCase(),
        group: values.group || getDefaultGroupName(modelId),
        endpointTypes: values.endpointTypes?.length ? [...values.endpointTypes] : undefined,
        capabilities: metadata.capabilities,
        ...(metadata.inputModalities !== undefined ? { inputModalities: metadata.inputModalities } : {}),
        ...(metadata.outputModalities !== undefined ? { outputModalities: metadata.outputModalities } : {}),
        ...(values.contextWindow !== null ? { contextWindow: values.contextWindow } : {}),
        ...(values.maxInputTokens !== null ? { maxInputTokens: values.maxInputTokens } : {}),
        ...(values.maxOutputTokens !== null ? { maxOutputTokens: values.maxOutputTokens } : {})
      })

      return createUniqueModelId(providerId, modelId)
    },
    [metadata, createModel, models, provider, providerId, t]
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
            contextWindow: null,
            maxInputTokens: null,
            maxOutputTokens: null,
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
  }, [addSingleModel, formState, onSuccess, t])

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
            showEndpointType
            showRequiredIndicator
            layout="horizontal"
            modelIdAutoFocus
            modelIdInputRef={modelIdInputRef}
            modelIdError={
              modelIdTouched && !formState.modelId.trim() ? t('settings.models.add.model_id.required') : undefined
            }
            onModelIdChange={handleModelIdChange}
            onNameChange={(value) => setFormState((current) => ({ ...current, name: value }))}
            onGroupChange={(value) => setFormState((current) => ({ ...current, group: value }))}
            onEndpointTypesChange={(next) => {
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
              <ModelMetadataControls
                value={metadata}
                onChange={(patch) => setMetadata((current) => ({ ...current, ...patch }))}
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
