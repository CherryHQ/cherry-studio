import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import type { ModelSelectorFilter } from '@renderer/components/ModelSelector'
import { TextInputField } from '@renderer/components/resourceCatalog/dialogs/components/EditDialogShared'

import type { ResourceCreateWizardFormValues } from '../types'
import { AvatarNameField, CreateModelField } from './BasicInfoStep'

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

  return (
    <fieldset disabled={disabled} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
      <AvatarNameField
        form={form}
        portalContainer={portalContainer}
        fallbackAvatar={fallbackAvatar}
        placeholder={t('library.config.dialogs.create.auto.name_placeholder')}
      />
      <TextInputField
        form={form}
        name="description"
        label={t('library.config.dialogs.create.auto.purpose_label')}
        labelClassName="font-medium"
        placeholder={t('library.config.dialogs.create.auto.purpose_placeholder')}
        description={t('library.config.dialogs.create.auto.purpose_hint')}
      />
      <CreateModelField
        form={form}
        portalContainer={portalContainer}
        modelFilter={modelFilter}
        includeAgentOnlyModels={includeAgentOnlyModels}
        onSettingsNavigate={onSettingsNavigate}
      />
    </fieldset>
  )
}
