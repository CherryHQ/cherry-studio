import { useEffect, useState } from 'react'
import { type UseFormReturn, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  InputGroup,
  InputGroupAddon,
  InputGroupInput
} from '@cherrystudio/ui'
import type { ModelSelectorFilter } from '@renderer/components/ModelSelector'
import { PermissionModeSelect } from '@renderer/components/PermissionModeOption'
import { EmojiAvatarPicker } from '@renderer/components/resourceCatalog/dialogs/components/DialogFormFields'
import {
  CompactModelField,
  type ModelLabels,
  TextInputField
} from '@renderer/components/resourceCatalog/dialogs/components/EditDialogShared'
import { getPermissionModeCards } from '@renderer/utils/agent'

import type { ResourceCreateWizardFormValues } from '../types'

const EMPTY_MODEL_LABELS: ModelLabels = {
  modelId: null,
  planModelId: null,
  smallModelId: null,
  contextCompressModelId: null
}

type ModelFieldProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
  modelLabels: ModelLabels
  setModelLabels: (labels: ModelLabels) => void
  modelFilter?: ModelSelectorFilter
  isModelDisabled?: ModelSelectorFilter
  onSettingsNavigate?: (navigate: () => void) => void
}

type BasicInfoStepProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
  fallbackAvatar: string
  modelFilter?: ModelSelectorFilter
  isModelDisabled?: ModelSelectorFilter
  /** Agent create flows add the permission mode and the Pi model filter. */
  isAgent?: boolean
  onSettingsNavigate?: (navigate: () => void) => void
}

/**
 * Permission mode + model picker for agent create flows. Every new Agent runs on Pi, so there is no
 * runtime choice. Isolated so `useAgentModelFilter` (and its provider subscription) only mounts for
 * agents — assistants keep using the static `modelFilter` prop.
 */
function AgentModelFields({
  form,
  portalContainer,
  modelLabels,
  setModelLabels,
  modelFilter,
  isModelDisabled,
  onSettingsNavigate
}: ModelFieldProps) {
  const { t } = useTranslation()
  const agentType = useWatch({ control: form.control, name: 'agentType' })
  const agentName = useWatch({ control: form.control, name: 'name' })
  const permissionModeCards = getPermissionModeCards(agentType)

  return (
    <>
      <FormField
        control={form.control}
        name="permissionMode"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="font-medium">{t('library.config.agent.field.permission_mode.label')}</FormLabel>
            <PermissionModeSelect
              cards={permissionModeCards}
              value={field.value}
              onValueChange={field.onChange}
              portalContainer={portalContainer}
              ariaLabel={t('library.config.agent.field.permission_mode.label')}
              scopeName={agentName?.trim() || undefined}
              t={t}
            />
            <FormMessage />
          </FormItem>
        )}
      />
      <CompactModelField
        form={form}
        name="modelId"
        includeAgentOnlyModels
        label={t('common.model')}
        labelClassName="font-medium"
        filter={modelFilter}
        isModelDisabled={isModelDisabled}
        portalContainer={portalContainer}
        modelLabels={modelLabels}
        setModelLabels={setModelLabels}
        onSettingsNavigate={onSettingsNavigate}
        triggerClassName="h-9 rounded-md border border-input bg-transparent px-3 hover:bg-accent/50 aria-expanded:bg-accent/50"
      />
    </>
  )
}

/**
 * Step 1 (shared by assistant + agent): avatar, name, model, description.
 * Reuses the edit-dialog field components verbatim — field names match. Owns its
 * own emoji-picker and model-label state so selecting a model/avatar re-renders
 * only this step, never the dialog shell (keeps DialogContent's ref stable).
 */
export function BasicInfoStep({
  form,
  portalContainer,
  fallbackAvatar,
  modelFilter,
  isModelDisabled,
  isAgent = false,
  onSettingsNavigate
}: BasicInfoStepProps) {
  const { t } = useTranslation()
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [modelLabels, setModelLabels] = useState<ModelLabels>(EMPTY_MODEL_LABELS)
  const avatar = useWatch({ control: form.control, name: 'avatar' })

  useEffect(() => {
    form.setFocus('name')
  }, [form])

  return (
    <div className="flex flex-col gap-4">
      <FormField
        control={form.control}
        name="name"
        rules={{ validate: (value) => value.trim().length > 0 || t('common.required_field') }}
        render={({ field }) => (
          <FormItem>
            <FormLabel className="font-medium">{t('library.config.dialogs.create.avatar_name_label')}</FormLabel>
            <InputGroup>
              <InputGroupAddon className="py-0">
                <EmojiAvatarPicker
                  value={avatar}
                  fallback={fallbackAvatar}
                  open={emojiPickerOpen}
                  onOpenChange={setEmojiPickerOpen}
                  onChange={(value) => form.setValue('avatar', value, { shouldDirty: true })}
                  ariaLabel={t('library.config.dialogs.create.avatar_aria')}
                  portalContainer={portalContainer}
                  avatarClassName="border-0"
                  avatarFontSize={18}
                />
              </InputGroupAddon>
              <FormControl>
                <InputGroupInput
                  {...field}
                  className="pl-1!"
                  placeholder={t('library.config.dialogs.create.name_placeholder')}
                />
              </FormControl>
            </InputGroup>
            <FormMessage />
          </FormItem>
        )}
      />

      {isAgent ? (
        <AgentModelFields
          form={form}
          portalContainer={portalContainer}
          modelLabels={modelLabels}
          setModelLabels={setModelLabels}
          modelFilter={modelFilter}
          isModelDisabled={isModelDisabled}
          onSettingsNavigate={onSettingsNavigate}
        />
      ) : (
        <CompactModelField
          form={form}
          name="modelId"
          label={t('common.model')}
          labelClassName="font-medium"
          filter={modelFilter}
          isModelDisabled={isModelDisabled}
          portalContainer={portalContainer}
          modelLabels={modelLabels}
          setModelLabels={setModelLabels}
          onSettingsNavigate={onSettingsNavigate}
          triggerClassName="h-9 rounded-md border border-input bg-transparent px-3 hover:bg-accent/50 aria-expanded:bg-accent/50"
        />
      )}

      <TextInputField
        form={form}
        name="description"
        label={t('common.description')}
        labelClassName="font-medium"
        placeholder={t('library.config.dialogs.create.description_placeholder')}
      />
    </div>
  )
}
