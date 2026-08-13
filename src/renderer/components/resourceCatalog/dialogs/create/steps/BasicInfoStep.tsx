import { PermissionModeSelect } from '@renderer/components/PermissionModeSelect'
import {
  AvatarField,
  CompactModelField,
  type ModelLabels,
  TextInputField
} from '@renderer/components/resourceCatalog/dialogs/components/EditDialogShared'
import type { Model } from '@shared/data/types/model'
import { useEffect, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import type { ResourceCreateWizardFormValues } from '../types'

const EMPTY_MODEL_LABELS: ModelLabels = {
  modelId: null,
  planModelId: null,
  smallModelId: null,
  contextCompressModelId: null
}

type BasicInfoStepProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
  fallbackAvatar: string
  showPermissionMode: boolean
  modelFilter?: (model: Model) => boolean
  onSettingsNavigate?: (navigate: () => void) => void
}

/**
 * Step 1 (shared by assistant + agent): avatar, name, model, the agent-only
 * permission mode, and description.
 * Reuses the edit-dialog field components verbatim — field names match. Owns its
 * own emoji-picker and model-label state so selecting a model/avatar re-renders
 * only this step, never the dialog shell (keeps DialogContent's ref stable).
 */
export function BasicInfoStep({
  form,
  portalContainer,
  fallbackAvatar,
  showPermissionMode,
  modelFilter,
  onSettingsNavigate
}: BasicInfoStepProps) {
  const { t } = useTranslation()
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [modelLabels, setModelLabels] = useState<ModelLabels>(EMPTY_MODEL_LABELS)

  useEffect(() => {
    form.setFocus('name')
  }, [form])

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[auto_1fr] items-start gap-3">
        <AvatarField
          form={form}
          emojiPickerOpen={emojiPickerOpen}
          setEmojiPickerOpen={setEmojiPickerOpen}
          fallback={fallbackAvatar}
          portalContainer={portalContainer}
          size="sm"
        />
        <TextInputField
          form={form}
          name="name"
          label={t('common.name')}
          placeholder={t('library.config.dialogs.create.name_placeholder')}
          required
        />
      </div>

      <CompactModelField
        form={form}
        name="modelId"
        label={t('common.model')}
        filter={modelFilter}
        portalContainer={portalContainer}
        modelLabels={modelLabels}
        setModelLabels={setModelLabels}
        onSettingsNavigate={onSettingsNavigate}
        triggerClassName="h-9 rounded-md border border-input bg-transparent px-3 hover:bg-accent/50 aria-expanded:bg-accent/50"
      />

      {showPermissionMode ? (
        <div className="flex flex-col gap-2">
          <span className="font-normal text-muted-foreground text-sm">
            {t('library.config.agent.field.permission_mode.label')}
          </span>
          <PermissionModeSelect
            value={form.watch('permissionMode')}
            onValueChange={(value) => form.setValue('permissionMode', value, { shouldDirty: true })}
            portalContainer={portalContainer}
          />
        </div>
      ) : null}

      <TextInputField
        form={form}
        name="description"
        label={t('common.description')}
        placeholder={t('library.config.dialogs.create.description_placeholder')}
      />
    </div>
  )
}
