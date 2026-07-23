import { Field, FieldError, FieldLabel, Input, Switch } from '@cherrystudio/ui'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import type { ProviderImageEndpointDraft, ProviderImageEndpointDraftField } from '../utils/providerImageEndpoints'

interface ProviderImageEndpointFieldsProps {
  value: ProviderImageEndpointDraft
  invalidField?: ProviderImageEndpointDraftField | null
  onChange: (value: ProviderImageEndpointDraft) => void
}

export function ProviderImageEndpointFields({ value, invalidField, onChange }: ProviderImageEndpointFieldsProps) {
  const { t } = useTranslation()
  const uid = useId()
  const imagesInputId = `${uid}-images-base-url`
  const imagesHelpId = `${uid}-images-base-url-help`
  const imagesErrorId = `${uid}-images-base-url-error`
  const separateEditId = `${uid}-separate-image-edit-url`
  const editInputId = `${uid}-image-edit-base-url`
  const editHelpId = `${uid}-image-edit-base-url-help`
  const editErrorId = `${uid}-image-edit-base-url-error`

  return (
    <div className="flex flex-col gap-4">
      <Field className="gap-2">
        <FieldLabel htmlFor={imagesInputId} className="text-[13px] text-foreground">
          {t('settings.provider.image_endpoints.images_base_url.label')}
        </FieldLabel>
        <Input
          id={imagesInputId}
          value={value.imagesBaseUrl}
          placeholder={t('settings.provider.base_url.placeholder')}
          aria-invalid={invalidField === 'imagesBaseUrl'}
          aria-describedby={invalidField === 'imagesBaseUrl' ? imagesErrorId : imagesHelpId}
          onChange={(event) => onChange({ ...value, imagesBaseUrl: event.target.value })}
        />
        <p id={imagesHelpId} className="text-foreground-muted text-xs leading-tight">
          {t('settings.provider.image_endpoints.images_base_url.help')}
        </p>
        <FieldError
          id={imagesErrorId}
          className="text-xs"
          errors={invalidField === 'imagesBaseUrl' ? [{ message: t('settings.provider.base_url.invalid') }] : undefined}
        />
      </Field>

      <div className="flex min-h-10 items-center justify-between gap-3">
        <label htmlFor={separateEditId} className="min-w-0 flex-1 cursor-pointer">
          <span className="block text-[13px] text-foreground">
            {t('settings.provider.image_endpoints.separate_edit.label')}
          </span>
          <span className="block text-foreground-muted text-xs leading-tight">
            {t('settings.provider.image_endpoints.separate_edit.help')}
          </span>
        </label>
        <Switch
          id={separateEditId}
          checked={value.useSeparateImageEditUrl}
          onCheckedChange={(checked) => onChange({ ...value, useSeparateImageEditUrl: checked })}
        />
      </div>

      {value.useSeparateImageEditUrl && (
        <Field className="gap-2">
          <FieldLabel htmlFor={editInputId} className="text-[13px] text-foreground">
            {t('settings.provider.image_endpoints.image_edit_base_url.label')}
          </FieldLabel>
          <Input
            id={editInputId}
            value={value.imageEditBaseUrl}
            placeholder={t('settings.provider.base_url.placeholder')}
            aria-invalid={invalidField === 'imageEditBaseUrl'}
            aria-describedby={invalidField === 'imageEditBaseUrl' ? editErrorId : editHelpId}
            onChange={(event) => onChange({ ...value, imageEditBaseUrl: event.target.value })}
          />
          <p id={editHelpId} className="text-foreground-muted text-xs leading-tight">
            {t('settings.provider.image_endpoints.image_edit_base_url.help')}
          </p>
          <FieldError
            id={editErrorId}
            className="text-xs"
            errors={
              invalidField === 'imageEditBaseUrl' ? [{ message: t('settings.provider.base_url.invalid') }] : undefined
            }
          />
        </Field>
      )}
    </div>
  )
}
