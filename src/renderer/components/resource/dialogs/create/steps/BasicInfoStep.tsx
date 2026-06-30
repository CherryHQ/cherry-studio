import {
  AvatarField,
  CompactModelField,
  type ModelLabels,
  TextInputField
} from '@renderer/components/resource/dialogs/edit/EditDialogShared'
import type { Model } from '@shared/data/types/model'
import { useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import type { ResourceCreateWizardFormValues } from '../types'

const EMPTY_MODEL_LABELS: ModelLabels = { modelId: null, planModelId: null, smallModelId: null }

type BasicInfoStepProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
  fallbackAvatar: string
  modelFilter?: (model: Model) => boolean
}

/**
 * Step 1 (shared by assistant + agent): avatar, name, model, description.
 * Reuses the edit-dialog field components verbatim — field names match. Owns its
 * own emoji-picker and model-label state so selecting a model/avatar re-renders
 * only this step, never the dialog shell (keeps DialogContent's ref stable).
 */
export function BasicInfoStep({ form, portalContainer, fallbackAvatar, modelFilter }: BasicInfoStepProps) {
  const { t } = useTranslation()
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [modelLabels, setModelLabels] = useState<ModelLabels>(EMPTY_MODEL_LABELS)

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
      />

      <TextInputField
        form={form}
        name="description"
        label={t('common.description')}
        placeholder={t('library.config.dialogs.create.description_placeholder')}
      />
    </div>
  )
}
