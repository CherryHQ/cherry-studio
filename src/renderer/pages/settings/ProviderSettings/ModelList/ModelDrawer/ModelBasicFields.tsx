import { Input } from '@cherrystudio/ui'
import ProviderField from '@renderer/pages/settings/ProviderSettings/primitives/ProviderField'
import { drawerClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { cn } from '@renderer/utils/style'
import type { ReactNode, Ref } from 'react'
import { useTranslation } from 'react-i18next'

import { ModelEndpointTypeChips } from './ModelEndpointTypeChips'
import { ModelEndpointTypeSelect } from './ModelEndpointTypeSelect'
import type { ModelBasicFormState, ModelDrawerEndpointType } from './types'

interface ModelBasicFieldsProps {
  values: ModelBasicFormState
  showEndpointType: boolean
  endpointTypeControl?: 'select' | 'chips'
  showRequiredIndicator?: boolean
  layout?: 'vertical' | 'horizontal'
  modelIdDisabled?: boolean
  modelIdInputRef?: Ref<HTMLInputElement>
  modelIdAction?: ReactNode
  modelIdError?: string
  endpointTypeError?: string
  onModelIdChange: (value: string) => void
  onNameChange: (value: string) => void
  onNameBlur?: () => void
  onGroupChange: (value: string) => void
  onGroupBlur?: () => void
  onEndpointTypesChange: (next: readonly ModelDrawerEndpointType[]) => void
}

export function ModelBasicFields({
  values,
  showEndpointType,
  endpointTypeControl = 'select',
  showRequiredIndicator = false,
  layout = 'vertical',
  modelIdDisabled = false,
  modelIdInputRef,
  modelIdAction,
  modelIdError,
  endpointTypeError,
  onModelIdChange,
  onNameChange,
  onNameBlur,
  onGroupChange,
  onGroupBlur,
  onEndpointTypesChange
}: ModelBasicFieldsProps) {
  const { t } = useTranslation()

  return (
    <>
      <ProviderField
        title={
          showRequiredIndicator ? (
            <span className="inline-flex items-baseline gap-1">
              <span>{t('settings.models.add.model_id.label')}</span>
              <span aria-hidden className="text-destructive">
                *
              </span>
            </span>
          ) : (
            t('settings.models.add.model_id.label')
          )
        }
        titleClassName={drawerClasses.fieldTitle}
        layout={layout}
        className={drawerClasses.field}
        help={modelIdError ? <div className={drawerClasses.errorText}>{modelIdError}</div> : null}>
        <div className={drawerClasses.valueRow}>
          <Input
            ref={modelIdInputRef}
            required
            spellCheck={false}
            maxLength={200}
            aria-label={t('settings.models.add.model_id.label')}
            value={values.modelId}
            readOnly={modelIdDisabled}
            aria-readonly={modelIdDisabled}
            aria-invalid={Boolean(modelIdError)}
            placeholder={t('settings.models.add.model_id.placeholder')}
            className={cn(drawerClasses.input, modelIdDisabled && drawerClasses.inputDisabled)}
            onChange={(event) => onModelIdChange(event.target.value)}
          />
          {modelIdAction}
        </div>
      </ProviderField>

      <ProviderField
        title={t('settings.models.add.model_name.label')}
        titleClassName={drawerClasses.fieldTitle}
        layout={layout}
        className={drawerClasses.field}>
        <Input
          spellCheck={false}
          aria-label={t('settings.models.add.model_name.label')}
          value={values.name}
          placeholder={t('settings.models.add.model_name.placeholder')}
          className={drawerClasses.input}
          onChange={(event) => onNameChange(event.target.value)}
          onBlur={onNameBlur}
        />
      </ProviderField>

      <ProviderField
        title={t('settings.models.add.group_name.label')}
        titleClassName={drawerClasses.fieldTitle}
        layout={layout}
        className={drawerClasses.field}>
        <Input
          spellCheck={false}
          aria-label={t('settings.models.add.group_name.label')}
          value={values.group}
          placeholder={t('settings.models.add.group_name.placeholder')}
          className={drawerClasses.input}
          onChange={(event) => onGroupChange(event.target.value)}
          onBlur={onGroupBlur}
        />
      </ProviderField>

      {showEndpointType && (
        <ProviderField
          title={t('settings.models.add.endpoint_type.label')}
          titleClassName={drawerClasses.fieldTitle}
          layout={layout}
          className={drawerClasses.field}
          help={endpointTypeError ? <div className={drawerClasses.errorText}>{endpointTypeError}</div> : null}>
          <div data-testid="provider-settings-model-endpoint-type-field">
            {endpointTypeControl === 'chips' ? (
              <ModelEndpointTypeChips value={values.endpointTypes ?? []} onChange={onEndpointTypesChange} />
            ) : (
              <ModelEndpointTypeSelect value={values.endpointTypes ?? []} onChange={onEndpointTypesChange} />
            )}
          </div>
        </ProviderField>
      )}
    </>
  )
}
