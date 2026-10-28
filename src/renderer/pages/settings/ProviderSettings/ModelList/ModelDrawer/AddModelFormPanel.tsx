import { ChevronDown, ChevronUp } from 'lucide-react'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { useModelMutations, useModels } from '@renderer/hooks/useModel'
import { useProvider } from '@renderer/hooks/useProvider'
import { getDefaultGroupName } from '@renderer/utils/naming'
import type { CreateModelDto } from '@shared/data/api/schemas/models'
import type { Model } from '@shared/data/types/model'
import { createUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import ProviderActions from '../../primitives/ProviderActions'
import ProviderSection from '../../primitives/ProviderSection'
import { drawerClasses } from '../../primitives/ProviderSettingsPrimitives'
import { resolveProviderModelDefaults } from '../../utils/modelSync'
import { getInitialAddModelFormState, splitModelIds } from './helpers'
import { ModelBasicFields } from './ModelBasicFields'
import { ModelConnectionDetails } from './ModelConnectionDetails'
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
  const { createModels } = useModelMutations()
  const [formState, setFormState] = useState<ModelBasicFormState>(() => getInitialAddModelFormState(null))
  const [overrides, setOverrides] = useState<Partial<ModelMetadata> & Pick<CreateModelDto, 'endpointTypes'>>({})
  const [defaults, setDefaults] = useState<Model | null>(null)
  const identityRef = useRef('')
  identityRef.current = `${providerId}::${formState.modelId.trim()}`
  const resolutionRef = useRef(0)
  const metadata: ModelMetadata = { capabilities: [], ...defaults, ...overrides }
  const endpointTypes = overrides.endpointTypes ?? defaults?.endpointTypes ?? formState.endpointTypes
  const [modelIdTouched, setModelIdTouched] = useState(false)
  const [showMoreSettings, setShowMoreSettings] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const submitInFlightRef = useRef(false)
  const modelIdInputRef = useRef<HTMLInputElement>(null)

  const defaultEndpointType = provider?.defaultChatEndpoint

  useEffect(() => {
    setFormState(getInitialAddModelFormState(prefill, defaultEndpointType))
    setDefaults(prefill?.model ?? null)
    setOverrides({
      ...(prefill?.endpointTypes
        ? { endpointTypes: prefill.endpointTypes }
        : prefill?.endpointType
          ? { endpointTypes: [prefill.endpointType] }
          : {})
    })
    resolutionRef.current++
    setModelIdTouched(false)
    setShowMoreSettings(false)
    setSubmitError(null)
  }, [defaultEndpointType, prefill, providerId])

  const handleModelIdChange = useCallback(
    (value: string) => {
      if (!provider) {
        return
      }

      resolutionRef.current++
      setDefaults(null)
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

  const resolveDefaults = useCallback(
    async (ids: string[]) => {
      const identity = identityRef.current
      const generation = ++resolutionRef.current
      const resolved = await resolveProviderModelDefaults(providerId, ids)
      if (resolved.length !== ids.length) throw new Error('Incomplete model defaults')
      if (generation === resolutionRef.current && identity === identityRef.current && ids.length === 1) {
        setDefaults(resolved[0])
        setSubmitError(null)
      }
      return resolved
    },
    [providerId]
  )

  const submitAddModel = useCallback(async () => {
    if (submitInFlightRef.current) return
    const ids = splitModelIds(formState.modelId.trim().replaceAll('，', ','))
    if (!ids.length) {
      setModelIdTouched(true)
      modelIdInputRef.current?.focus()
      return
    }
    if (ids.some((id) => models.some((model) => model.id === createUniqueModelId(providerId, id)))) {
      setSubmitError(t('error.model.exists'))
      return
    }
    const identity = identityRef.current
    submitInFlightRef.current = true
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      await resolveDefaults(ids)
      if (identity !== identityRef.current) return
      const dtos = ids.map(
        (modelId): CreateModelDto => ({
          providerId,
          modelId,
          ...(ids.length === 1
            ? {
                name: formState.name || undefined,
                group: formState.group || undefined,
                ...(formState.contextWindow !== null ? { contextWindow: formState.contextWindow } : {}),
                ...(formState.maxInputTokens !== null ? { maxInputTokens: formState.maxInputTokens } : {}),
                ...(formState.maxOutputTokens !== null ? { maxOutputTokens: formState.maxOutputTokens } : {})
              }
            : {}),
          ...overrides
        })
      )
      await createModels(dtos)
      if (identity === identityRef.current) onSuccess(ids.map((id) => createUniqueModelId(providerId, id)))
    } catch {
      if (identity === identityRef.current) setSubmitError(t('settings.models.manage.operation_failed'))
    } finally {
      submitInFlightRef.current = false
      setIsSubmitting(false)
    }
  }, [createModels, formState, models, onSuccess, overrides, providerId, resolveDefaults, t])

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
      onBlur={(event) => {
        if (!Object.is(event.target, modelIdInputRef.current)) return
        const ids = splitModelIds(formState.modelId.trim().replaceAll('，', ','))
        if (!ids.length) return
        const identity = identityRef.current
        void resolveDefaults(ids).catch(() => {
          if (identity === identityRef.current) setSubmitError(t('settings.models.manage.operation_failed'))
        })
      }}
      onSubmit={(event) => void handleFormSubmit(event)}>
      <fieldset disabled={isSubmitting} className="contents">
        <ProviderSection className={drawerClasses.section}>
          <div className={drawerClasses.fieldList}>
            <ModelBasicFields
              values={{ ...formState, endpointTypes }}
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
                setOverrides((current) => ({ ...current, endpointTypes: [...next] }))
              }}
            />
            <ModelConnectionDetails provider={provider} endpoints={endpointTypes ?? []} />
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
                  onChange={(patch) => setOverrides((current) => ({ ...current, ...patch }))}
                />
              </div>

              <div className={drawerClasses.sectionCard}>
                <ModelContextWindowFields
                  contextWindow={formState.contextWindow}
                  maxInputTokens={formState.maxInputTokens}
                  maxOutputTokens={formState.maxOutputTokens}
                  onContextWindowChange={(value) => setFormState((current) => ({ ...current, contextWindow: value }))}
                  onMaxInputTokensChange={(value) => setFormState((current) => ({ ...current, maxInputTokens: value }))}
                  onMaxOutputTokensChange={(value) =>
                    setFormState((current) => ({ ...current, maxOutputTokens: value }))
                  }
                />
              </div>
            </div>
          </ProviderSection>
        )}
      </fieldset>
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
