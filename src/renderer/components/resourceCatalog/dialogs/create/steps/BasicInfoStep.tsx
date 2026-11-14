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
import {
  CompactModelField,
  type ModelLabels
} from '@renderer/components/resourceCatalog/dialogs/components/EditDialogShared'
import { getPermissionModeCards } from '@renderer/utils/agent'

import type { ResourceCreateWizardFormValues } from '../types'
import { CreateAvatarPicker } from './CreateAvatarPicker'

const EMPTY_MODEL_LABELS: ModelLabels = {
  modelId: null,
  planModelId: null,
  smallModelId: null,
  contextCompressModelId: null
}

type ModelFieldProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
  modelFilter?: ModelSelectorFilter
  isModelDisabled?: ModelSelectorFilter
  onSettingsNavigate?: (navigate: () => void) => void
}

/** Model picker shared by the basic step and the auto-create entry; owns its label state. */
export function CreateModelField({
  form,
  portalContainer,
  modelFilter,
  isModelDisabled,
  onSettingsNavigate,
  includeAgentOnlyModels = false,
  labelClassName = 'font-medium'
}: ModelFieldProps & { includeAgentOnlyModels?: boolean; labelClassName?: string }) {
  const { t } = useTranslation()
  const [modelLabels, setModelLabels] = useState<ModelLabels>(EMPTY_MODEL_LABELS)

  return (
    <CompactModelField
      form={form}
      name="modelId"
      includeAgentOnlyModels={includeAgentOnlyModels}
      label={t('common.model')}
      labelClassName={labelClassName}
      filter={modelFilter}
      isModelDisabled={isModelDisabled}
      portalContainer={portalContainer}
      modelLabels={modelLabels}
      setModelLabels={setModelLabels}
      onSettingsNavigate={onSettingsNavigate}
      triggerClassName="h-9 rounded-md border border-input bg-transparent px-3 hover:bg-accent/50 aria-expanded:bg-accent/50"
    />
  )
}

type BasicInfoStepProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
  fallbackAvatar: string
  modelFilter?: ModelSelectorFilter
  isModelDisabled?: ModelSelectorFilter
  showAgentFields?: boolean
  onSettingsNavigate?: (navigate: () => void) => void
}

function AgentRuntimeModelFields({
  form,
  portalContainer,
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
      <CreateModelField
        form={form}
        portalContainer={portalContainer}
        modelFilter={modelFilter}
        isModelDisabled={isModelDisabled}
        onSettingsNavigate={onSettingsNavigate}
        includeAgentOnlyModels
      />
    </>
  )
}

/** Emoji avatar + name input. The auto-create entry leaves the name optional (it is generated). */
function AvatarNameField({
  form,
  portalContainer,
  fallbackAvatar,
  required = false,
  placeholder
}: {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
  fallbackAvatar: string
  required?: boolean
  placeholder?: string
}) {
  const { t } = useTranslation()

  return (
    <FormField
      control={form.control}
      name="name"
      rules={required ? { validate: (value) => value.trim().length > 0 || t('common.required_field') } : undefined}
      render={({ field }) => (
        <FormItem>
          <FormLabel className="font-medium">{t('library.config.dialogs.create.avatar_name_label')}</FormLabel>
          <InputGroup>
            <InputGroupAddon className="py-0">
              <CreateAvatarPicker
                form={form}
                fallbackAvatar={fallbackAvatar}
                portalContainer={portalContainer}
                avatarClassName="border-0"
                avatarFontSize={18}
              />
            </InputGroupAddon>
            <FormControl>
              <InputGroupInput
                {...field}
                className="pl-1!"
                placeholder={placeholder ?? t('library.config.dialogs.create.name_placeholder')}
              />
            </FormControl>
          </InputGroup>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

/**
 * Step 1 (shared by assistant + agent): avatar, name, model. The entry's purpose is the description.
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
  showAgentFields = false,
  onSettingsNavigate
}: BasicInfoStepProps) {
  useEffect(() => {
    form.setFocus('name')
  }, [form])

  return (
    <div className="flex flex-col gap-4">
      <AvatarNameField form={form} portalContainer={portalContainer} fallbackAvatar={fallbackAvatar} required />

      {showAgentFields ? (
        <AgentRuntimeModelFields
          form={form}
          portalContainer={portalContainer}
          modelFilter={modelFilter}
          isModelDisabled={isModelDisabled}
          onSettingsNavigate={onSettingsNavigate}
        />
      ) : (
        <CreateModelField
          form={form}
          portalContainer={portalContainer}
          modelFilter={modelFilter}
          isModelDisabled={isModelDisabled}
          onSettingsNavigate={onSettingsNavigate}
        />
      )}
    </div>
  )
}
