import { useState } from 'react'
import { type UseFormReturn, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import type { ModelSelectorFilter } from '@renderer/components/ModelSelector'
import { EmojiAvatarPicker } from '@renderer/components/resourceCatalog/dialogs/components/DialogFormFields'
import { TextInputField } from '@renderer/components/resourceCatalog/dialogs/components/EditDialogShared'

import type { ResourceCreateWizardFormValues } from '../types'
import { CreateModelField } from './BasicInfoStep'

const ENTRY_LABEL_CLASS = 'text-muted-foreground text-xs'

type AutoCreateEntryProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
  fallbackAvatar: string
  modelFilter?: ModelSelectorFilter
  includeAgentOnlyModels: boolean
  /** Locks the fields while auto create is generating. */
  disabled: boolean
  onSettingsNavigate?: (navigate: () => void) => void
}

/**
 * First page of the create flow. The purpose is the `description` field, so "Manual create"
 * carries it into the basic step unchanged; "Auto create" turns it into a full configuration.
 */
export function AutoCreateEntry({
  form,
  portalContainer,
  fallbackAvatar,
  modelFilter,
  includeAgentOnlyModels,
  disabled,
  onSettingsNavigate
}: AutoCreateEntryProps) {
  const { t } = useTranslation()
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false)
  const avatar = useWatch({ control: form.control, name: 'avatar' })

  return (
    <fieldset disabled={disabled} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
      <div className="flex justify-center pb-1">
        <EmojiAvatarPicker
          size="lg"
          value={avatar}
          fallback={fallbackAvatar}
          open={avatarPickerOpen}
          onOpenChange={setAvatarPickerOpen}
          onChange={(value) => form.setValue('avatar', value, { shouldDirty: true })}
          ariaLabel={t('library.config.dialogs.create.avatar_aria')}
          portalContainer={portalContainer}
          avatarClassName="rounded-[28%] border-0"
          disabled={disabled}
        />
      </div>
      <TextInputField
        form={form}
        name="name"
        label={t('common.name')}
        labelClassName={ENTRY_LABEL_CLASS}
        placeholder={t('library.config.dialogs.create.auto.name_placeholder')}
      />
      <TextInputField
        form={form}
        name="description"
        rows={3}
        label={t('library.config.dialogs.create.auto.purpose_label')}
        labelClassName={ENTRY_LABEL_CLASS}
        placeholder={t('library.config.dialogs.create.auto.purpose_placeholder')}
      />
      <CreateModelField
        form={form}
        portalContainer={portalContainer}
        modelFilter={modelFilter}
        includeAgentOnlyModels={includeAgentOnlyModels}
        onSettingsNavigate={onSettingsNavigate}
        labelClassName={ENTRY_LABEL_CLASS}
      />
    </fieldset>
  )
}
