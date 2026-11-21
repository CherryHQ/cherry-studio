import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Field, FieldError, FieldLabel, Input, HelpTooltip } from '@cherrystudio/ui'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { buildEndpointRequestPreview } from '../utils/endpointRequestPreview'
import type { ProviderImageEndpointDraft, ProviderImageEndpointDraftField } from '../utils/providerImageEndpoints'
import { EndpointPathModeControl } from './EndpointPathModeControl'

interface ProviderImageEndpointFieldsProps {
  showExactPathToggle?: boolean
  value: ProviderImageEndpointDraft
  invalidField?: ProviderImageEndpointDraftField | null
  onChange: (value: ProviderImageEndpointDraft) => void
}

export function ProviderImageEndpointFields({
  value,
  invalidField,
  onChange,
  showExactPathToggle
}: ProviderImageEndpointFieldsProps) {
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
          <HelpTooltip content={t('settings.provider.image_endpoints.image_generation_base_url.help')} />
        </div>
        <Input
          id={generationInputId}
          value={value.imageGenerationBaseUrl}
          placeholder={t('settings.provider.base_url.placeholder')}
          aria-invalid={invalidField === 'imageGenerationBaseUrl'}
          aria-describedby={invalidField === 'imageGenerationBaseUrl' ? generationErrorId : generationHelpId}
          onChange={(event) => onChange({ ...value, imageGenerationBaseUrl: event.target.value })}
        />
        {showExactPathToggle && (
          <>
            <EndpointPathModeControl
              endpointLabel={t('settings.provider.image_endpoints.image_generation_base_url.label')}
              checked={value.imageGenerationPathMode === 'complete'}
              onCheckedChange={(checked) =>
                onChange({ ...value, imageGenerationPathMode: checked ? 'complete' : 'host' })
              }
            />
            <p className="text-xs break-all text-muted-foreground">
              {t('settings.provider.api_host_preview', {
                url:
                  buildEndpointRequestPreview(
                    value.imageGenerationBaseUrl,
                    ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION,
                    value.imageGenerationPathMode
                  ) || '—'
              })}
            </p>
          </>
        )}
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
          <HelpTooltip content={t('settings.provider.image_endpoints.image_edit_base_url.help')} />
        </div>
        <Input
          id={editInputId}
          value={value.imageEditBaseUrl}
          placeholder={t('settings.provider.base_url.placeholder')}
          aria-invalid={invalidField === 'imageEditBaseUrl'}
          aria-describedby={invalidField === 'imageEditBaseUrl' ? editErrorId : editHelpId}
          onChange={(event) => onChange({ ...value, imageEditBaseUrl: event.target.value })}
        />
        {showExactPathToggle && (
          <>
            <EndpointPathModeControl
              endpointLabel={t('settings.provider.image_endpoints.image_edit_base_url.label')}
              checked={value.imageEditPathMode === 'complete'}
              onCheckedChange={(checked) => onChange({ ...value, imageEditPathMode: checked ? 'complete' : 'host' })}
            />
            <p className="text-xs break-all text-muted-foreground">
              {t('settings.provider.api_host_preview', {
                url:
                  buildEndpointRequestPreview(
                    value.imageEditBaseUrl,
                    ENDPOINT_TYPE.OPENAI_IMAGE_EDIT,
                    value.imageEditPathMode
                  ) || '—'
              })}
            </p>
          </>
        )}
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
