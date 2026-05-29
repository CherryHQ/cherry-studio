import { cn } from '@renderer/utils'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderField from '../../primitives/ProviderField'
import { drawerClasses } from '../../primitives/ProviderSettingsPrimitives'
import { ModelEndpointTypeChips } from './ModelEndpointTypeChips'
import type { ModelBasicFormState, ModelDrawerEndpointType } from './types'

interface ModelBasicFieldsProps {
  values: ModelBasicFormState
  showEndpointType: boolean
  modelIdDisabled?: boolean
  modelIdAction?: ReactNode
  endpointTypeError?: string
  onModelIdChange: (value: string) => void
  onNameChange: (value: string) => void
  onGroupChange: (value: string) => void
  onEndpointTypesChange: (next: readonly ModelDrawerEndpointType[]) => void
}

const drawerFieldTitleClassName = 'text-[13px] text-foreground/85'

export function ModelBasicFields({
  values,
  showEndpointType,
  modelIdDisabled = false,
  modelIdAction,
  endpointTypeError,
  onModelIdChange,
  onNameChange,
  onGroupChange,
  onEndpointTypesChange
}: ModelBasicFieldsProps) {
  const { t } = useTranslation()

  return (
    <>
      <ProviderField title={t('settings.models.add.model_id.label')} titleClassName={drawerFieldTitleClassName}>
        <div className={drawerClasses.valueRow}>
          <input
            required
            spellCheck={false}
            maxLength={200}
            aria-label={t('settings.models.add.model_id.label')}
            value={values.modelId}
            disabled={modelIdDisabled}
            placeholder={t('settings.models.add.model_id.placeholder')}
            className={cn(drawerClasses.input, modelIdDisabled && drawerClasses.inputDisabled)}
            onChange={(event) => onModelIdChange(event.target.value)}
          />
          {modelIdAction}
        </div>
      </ProviderField>

      <ProviderField title={t('settings.models.add.model_name.label')} titleClassName={drawerFieldTitleClassName}>
        <input
          spellCheck={false}
          aria-label={t('settings.models.add.model_name.label')}
          value={values.name}
          placeholder={t('settings.models.add.model_name.placeholder')}
          className={drawerClasses.input}
          onChange={(event) => onNameChange(event.target.value)}
        />
      </ProviderField>

      <ProviderField title={t('settings.models.add.group_name.label')} titleClassName={drawerFieldTitleClassName}>
        <input
          spellCheck={false}
          aria-label={t('settings.models.add.group_name.label')}
          value={values.group}
          placeholder={t('settings.models.add.group_name.placeholder')}
          className={drawerClasses.input}
          onChange={(event) => onGroupChange(event.target.value)}
        />
      </ProviderField>

      {showEndpointType && (
        <ProviderField
          title={t('settings.models.add.endpoint_type.label')}
          titleClassName={drawerFieldTitleClassName}
          help={endpointTypeError ? <div className={drawerClasses.errorText}>{endpointTypeError}</div> : null}>
          <div data-testid="provider-settings-model-endpoint-type-field">
            <ModelEndpointTypeChips value={values.endpointTypes ?? []} onChange={onEndpointTypesChange} />
          </div>
        </ProviderField>
      )}
    </>
  )
}
