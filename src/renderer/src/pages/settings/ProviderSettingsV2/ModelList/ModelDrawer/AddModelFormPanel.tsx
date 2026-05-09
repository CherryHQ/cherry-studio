import { Button } from '@cherrystudio/ui'
import { useModelMutations, useModels } from '@renderer/hooks/useModels'
import { useProvider } from '@renderer/hooks/useProviders'
import { getDefaultGroupName } from '@renderer/utils'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderActions from '../../shared/primitives/ProviderActions'
import ProviderSection from '../../shared/primitives/ProviderSection'
import { drawerClasses } from '../../shared/primitives/ProviderSettingsPrimitives'
import { isNewApiProvider } from '../../utils/provider'
import { ModelBasicFields, ModelContextWindowFields } from './content'
import { getInitialAddModelFormState, splitModelIds } from './helpers'
import type { AddModelDrawerPrefill, ModelBasicFormState, ModelDrawerMode } from './types'

export interface AddModelFormPanelProps {
  providerId: string
  prefill: AddModelDrawerPrefill | null
  onSuccess: () => void
  onCancel: () => void
  formId?: string
  'data-testid'?: string
}

/**
 * Domain container: add-model form + create mutation (no drawer chrome).
 * Used inside `ManageModelsDrawer` and optionally wrapped by `AddModelDrawer` for tests/legacy.
 */
export default function AddModelFormPanel({
  providerId,
  prefill,
  onSuccess,
  onCancel,
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
  const [endpointTypeTouched, setEndpointTypeTouched] = useState(false)
  const [showMoreSettings, setShowMoreSettings] = useState(false)

  const mode: ModelDrawerMode = provider && isNewApiProvider(provider) ? 'new-api' : 'legacy'

  useEffect(() => {
    setFormState(getInitialAddModelFormState(prefill, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS))
    setEndpointTypeTouched(false)
    setShowMoreSettings(false)
  }, [prefill])

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
        window.toast.error(t('error.model.exists'))
        return false
      }

      await createModel({
        providerId,
        modelId,
        name: values.name ? values.name : modelId.toUpperCase(),
        group: values.group || getDefaultGroupName(modelId),
        endpointTypes: mode === 'new-api' && values.endpointTypes?.length ? [...values.endpointTypes] : undefined,
        ...(values.maxInputTokens ? { maxInputTokens: Number(values.maxInputTokens) } : {}),
        ...(values.maxOutputTokens ? { maxOutputTokens: Number(values.maxOutputTokens) } : {})
      })

      return true
    },
    [createModel, mode, models, provider, providerId, t]
  )

  const submitAddModel = useCallback(async () => {
    if (mode === 'new-api' && !(formState.endpointTypes?.length ?? 0)) {
      setEndpointTypeTouched(true)
      return
    }

    const normalizedId = formState.modelId.trim().replaceAll('，', ',')

    if (normalizedId.includes(',')) {
      let addedCount = 0
      for (const singleId of splitModelIds(normalizedId)) {
        const added = await addSingleModel({
          modelId: singleId,
          name: singleId,
          group: '',
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
  }, [addSingleModel, formState, mode, onSuccess])

  const handleFormSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      await submitAddModel()
    },
    [submitAddModel]
  )

  if (!provider) {
    return null
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <form
        id={formId}
        data-testid={dataTestId}
        className={drawerClasses.form}
        onSubmit={(event) => void handleFormSubmit(event)}>
        <ProviderSection className={drawerClasses.section}>
          <div className={drawerClasses.fieldList}>
            <ModelBasicFields
              values={formState}
              showEndpointType={mode === 'new-api'}
              endpointTypeError={endpointTypeTouched ? t('settings.models.add.endpoint_type.required') : undefined}
              onModelIdChange={handleModelIdChange}
              onNameChange={(value) => setFormState((current) => ({ ...current, name: value }))}
              onGroupChange={(value) => setFormState((current) => ({ ...current, group: value }))}
              onEndpointTypesChange={(next) => {
                setEndpointTypeTouched(false)
                setFormState((current) => ({ ...current, endpointTypes: [...next] }))
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
            <div className={drawerClasses.fieldList}>
              <ModelContextWindowFields
                maxInputTokens={formState.maxInputTokens}
                maxOutputTokens={formState.maxOutputTokens}
                onMaxInputTokensChange={(value) => setFormState((current) => ({ ...current, maxInputTokens: value }))}
                onMaxOutputTokensChange={(value) => setFormState((current) => ({ ...current, maxOutputTokens: value }))}
              />
            </div>
          </ProviderSection>
        )}
      </form>
      <ProviderActions className={`${drawerClasses.footer} mt-auto pt-2`}>
        <Button variant="outline" type="button" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="button" onClick={() => void submitAddModel()}>
          {t('settings.models.add.add_model')}
        </Button>
      </ProviderActions>
    </div>
  )
}
