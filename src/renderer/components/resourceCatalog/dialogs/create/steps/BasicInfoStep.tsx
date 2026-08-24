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
import { AgentRuntimeTiles } from '@renderer/components/AgentRuntimeOption'
import { PermissionModeSelect } from '@renderer/components/PermissionModeOption'
import { EmojiAvatarPicker } from '@renderer/components/resourceCatalog/dialogs/components/DialogFormFields'
import {
  CompactModelField,
  type ModelLabels,
  TextInputField
} from '@renderer/components/resourceCatalog/dialogs/components/EditDialogShared'
import { getPermissionModeCards } from '@renderer/utils/agent'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { AgentType } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import { useEffect, useState } from 'react'
import { type UseFormReturn, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

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
  modelFilter?: (model: Model) => boolean
  onSettingsNavigate?: (navigate: () => void) => void
}

type BasicInfoStepProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
  fallbackAvatar: string
  modelFilter?: (model: Model) => boolean
  /** Agent create flows expose a runtime selector that drives the model filter (D8). */
  runtimeSelectable?: boolean
  onSettingsNavigate?: (navigate: () => void) => void
}

/**
 * Runtime selector + model picker for agent create flows. Isolated into its own
 * component so `useAgentModelFilter` (and its provider subscription) only mounts
 * for agents — assistants keep using the static `modelFilter` prop and never
 * touch the agent-runtime filter.
 */
function AgentRuntimeModelFields({
  form,
  portalContainer,
  modelLabels,
  setModelLabels,
  modelFilter,
  onSettingsNavigate
}: ModelFieldProps) {
  const { t } = useTranslation()
  const agentType = useWatch({ control: form.control, name: 'agentType' })
  const permissionModeCards = getPermissionModeCards(agentType)

  const handleRuntimeChange = (next: AgentType) => {
    form.setValue('agentType', next, { shouldDirty: true })
    form.setValue('permissionMode', AGENT_RUNTIME_CAPABILITIES[next].createDefaults.permissionMode, {
      shouldDirty: true
    })
    // A model compatible with one runtime may be unsupported by another, so
    // clear the current pick to force a re-select against the new filter.
    form.setValue('modelId', null, { shouldDirty: true })
    setModelLabels(EMPTY_MODEL_LABELS)
  }

  return (
    <>
      <FormField
        control={form.control}
        name="agentType"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="gap-1.5 font-medium">
              {t('library.config.agent.field.runtime.label')}
              <span className="font-normal text-muted-foreground text-xs">
                {t('library.config.agent.field.runtime.immutable_hint')}
              </span>
            </FormLabel>
            <FormControl>
              <AgentRuntimeTiles
                value={field.value}
                onValueChange={handleRuntimeChange}
                ariaLabel={t('library.config.agent.field.runtime.label')}
                t={t}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
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
              t={t}
            />
            <FormMessage />
          </FormItem>
        )}
      />
      <CompactModelField
        form={form}
        name="modelId"
        label={t('common.model')}
        labelClassName="font-medium"
        filter={modelFilter}
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
  runtimeSelectable = false,
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

      {runtimeSelectable ? (
        <AgentRuntimeModelFields
          form={form}
          portalContainer={portalContainer}
          modelLabels={modelLabels}
          setModelLabels={setModelLabels}
          modelFilter={modelFilter}
          onSettingsNavigate={onSettingsNavigate}
        />
      ) : (
        <CompactModelField
          form={form}
          name="modelId"
          label={t('common.model')}
          labelClassName="font-medium"
          filter={modelFilter}
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
