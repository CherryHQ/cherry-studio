import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Field, FieldError, FieldLabel, Input, HelpTooltip } from '@cherrystudio/ui'

import type { ProviderImageEndpointDraft, ProviderImageEndpointDraftField } from '../utils/providerImageEndpoints'

interface ProviderImageEndpointFieldsProps {
  value: ProviderImageEndpointDraft
  invalidField?: ProviderImageEndpointDraftField | null
  onChange: (value: ProviderImageEndpointDraft) => void
}

export function ProviderImageEndpointFields({ value, invalidField, onChange }: ProviderImageEndpointFieldsProps) {
  const { t } = useTranslation()
  const uid = useId()
  const generationInputId = `${uid}-image-generation-base-url`
  const generationHelpId = `${uid}-image-generation-base-url-help`
  const generationErrorId = `${uid}-image-generation-base-url-error`
  const editInputId = `${uid}-image-edit-base-url`
  const editHelpId = `${uid}-image-edit-base-url-help`
  const editErrorId = `${uid}-image-edit-base-url-error`

  return (
    <div className="flex flex-col gap-4">
      <Field className="gap-2">
        <div className="flex items-center gap-1.5">
          <FieldLabel htmlFor={generationInputId} className="text-[13px] text-foreground">
            {t('settings.provider.image_endpoints.image_generation_base_url.label')}
            <span id={generationHelpId} className="sr-only">
              {t('settings.provider.image_endpoints.image_generation_base_url.help')}
            </span>
          </FieldLabel>
          <HelpTooltip content={t('settings.provider.image_endpoints.image_generation_base_url.help')} delay={1000} />
        </div>
        <Input
          id={generationInputId}
          value={value.imageGenerationBaseUrl}
          placeholder={t('settings.provider.base_url.placeholder')}
          aria-invalid={invalidField === 'imageGenerationBaseUrl'}
          aria-describedby={invalidField === 'imageGenerationBaseUrl' ? generationErrorId : generationHelpId}
          onChange={(event) => onChange({ ...value, imageGenerationBaseUrl: event.target.value })}
        />
        <FieldError
          id={generationErrorId}
          className="text-xs"
          errors={
            invalidField === 'imageGenerationBaseUrl'
              ? [{ message: t('settings.provider.base_url.invalid') }]
              : undefined
          }
        />
      </Field>
      <Field className="gap-2">
        <div className="flex items-center gap-1.5">
          <FieldLabel htmlFor={editInputId} className="text-[13px] text-foreground">
            {t('settings.provider.image_endpoints.image_edit_base_url.label')}
            <span id={editHelpId} className="sr-only">
              {t('settings.provider.image_endpoints.image_edit_base_url.help')}
            </span>
          </FieldLabel>
          <HelpTooltip content={t('settings.provider.image_endpoints.image_edit_base_url.help')} delay={1000} />
        </div>
        <Input
          id={editInputId}
          value={value.imageEditBaseUrl}
          placeholder={t('settings.provider.base_url.placeholder')}
          aria-invalid={invalidField === 'imageEditBaseUrl'}
          aria-describedby={invalidField === 'imageEditBaseUrl' ? editErrorId : editHelpId}
          onChange={(event) => onChange({ ...value, imageEditBaseUrl: event.target.value })}
        />
        <FieldError
          id={editErrorId}
          className="text-xs"
          errors={
            invalidField === 'imageEditBaseUrl' ? [{ message: t('settings.provider.base_url.invalid') }] : undefined
          }
        />
      </Field>
    </div>
  )
}
