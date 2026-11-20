import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import type { ModelSelectorFilter } from '@renderer/components/ModelSelector'
import { TextInputField } from '@renderer/components/resourceCatalog/dialogs/components/EditDialogShared'

import type { ResourceCreateWizardFormValues, ResourceCreateWizardKind } from '../types'
import { CreateModelField } from './BasicInfoStep'
import { CreateAvatarPicker } from './CreateAvatarPicker'

const ENTRY_LABEL_CLASS = 'text-muted-foreground text-xs'

type AutoCreateEntryProps = {
  kind: ResourceCreateWizardKind
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
  fallbackAvatar: string
  modelFilter?: ModelSelectorFilter
  includeAgentOnlyModels: boolean
  /** Locks the fields while the resource is being created. */
  disabled: boolean
  onImagePendingChange: (pending: boolean) => void
  onSettingsNavigate?: (navigate: () => void) => void
}

/**
 * First page of the create flow. The name is required; the purpose (the `description` field) is optional.
 * "Manual create" keeps both as typed, and "Auto create" turns them into a full configuration.
 */
export function AutoCreateEntry({
  kind,
  form,
  portalContainer,
  fallbackAvatar,
  modelFilter,
  includeAgentOnlyModels,
  disabled,
  onImagePendingChange,
  onSettingsNavigate
}: AutoCreateEntryProps) {
  const { t } = useTranslation()

  return (
    <fieldset disabled={disabled} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
      <div className="flex justify-center pb-1">
        <CreateAvatarPicker
          form={form}
          size="lg"
          fallbackAvatar={fallbackAvatar}
          portalContainer={portalContainer}
          avatarClassName="rounded-[28%]"
          disabled={disabled}
          onPendingChange={onImagePendingChange}
        />
      </div>
      <TextInputField
        form={form}
        name="name"
        required
        label={t('common.name')}
        labelClassName={ENTRY_LABEL_CLASS}
        placeholder={
          kind === 'agent'
            ? t('library.config.dialogs.create.auto.agent_name_placeholder')
            : t('library.config.dialogs.create.auto.assistant_name_placeholder')
        }
      />
      <TextInputField
        form={form}
        name="description"
        rows={3}
        textareaClassName="min-h-20 resize-none"
        label={t('library.config.dialogs.create.auto.purpose_label')}
        labelClassName={ENTRY_LABEL_CLASS}
        placeholder={
          kind === 'agent'
            ? t('library.config.dialogs.create.auto.agent_purpose_placeholder')
            : t('library.config.dialogs.create.auto.assistant_purpose_placeholder')
        }
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
