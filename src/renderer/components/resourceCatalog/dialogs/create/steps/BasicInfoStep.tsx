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
  InputGroupInput,
  Switch
} from '@cherrystudio/ui'
import type { ModelSelectorFilter } from '@renderer/components/ModelSelector'
import { PermissionModeSelect } from '@renderer/components/PermissionModeOption'
import { AgentCustomCliSection } from '@renderer/components/resourceCatalog/dialogs/components/AgentCustomCliSection'
import { EmojiAvatarPicker } from '@renderer/components/resourceCatalog/dialogs/components/DialogFormFields'
import {
  CompactModelField,
  type ModelLabels,
  TextInputField
} from '@renderer/components/resourceCatalog/dialogs/components/EditDialogShared'
import { getPermissionModeCards } from '@renderer/utils/agent'

import { DraftAgentAvatarPicker } from '../DraftAgentAvatarPicker'
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
  active: boolean
  disabled: boolean
  onImagePendingChange: (pending: boolean) => void
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

/** Collects shared basic fields while Agent image selection stays in the creation draft. */
export function BasicInfoStep({
  active,
  disabled,
  onImagePendingChange,
  form,
  portalContainer,
  fallbackAvatar,
  modelFilter,
  isModelDisabled,
  showAgentFields = false,
  onSettingsNavigate
}: BasicInfoStepProps) {
  const { t } = useTranslation()
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [modelLabels, setModelLabels] = useState<ModelLabels>(EMPTY_MODEL_LABELS)
  const avatar = useWatch({ control: form.control, name: 'avatar' })
  const avatarImage = useWatch({ control: form.control, name: 'avatarImage' })

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
                {showAgentFields ? (
                  <DraftAgentAvatarPicker
                    emoji={avatar || fallbackAvatar}
                    fallback={fallbackAvatar}
                    image={avatarImage}
                    active={active}
                    disabled={disabled}
                    portalContainer={portalContainer}
                    onPendingChange={onImagePendingChange}
                    onChange={(emoji, image) => {
                      form.setValue('avatar', emoji, { shouldDirty: true })
                      form.setValue('avatarImage', image, { shouldDirty: true })
                    }}
                  />
                ) : (
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
                )}
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

      {showAgentFields ? (
        <>
          <AgentRuntimeModelFields
            form={form}
            portalContainer={portalContainer}
            modelLabels={modelLabels}
            setModelLabels={setModelLabels}
            modelFilter={modelFilter}
            isModelDisabled={isModelDisabled}
            onSettingsNavigate={onSettingsNavigate}
          />
          <CustomCliCreateFields form={form} />
        </>
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

/** Custom Code CLI executable registration (issue #19966): opt-in toggle, then
 *  the shared path/args/validation fields. A non-empty executable switches the
 *  created Agent to the claude-code runtime at submit time. */
function CustomCliCreateFields({ form }: { form: UseFormReturn<ResourceCreateWizardFormValues> }) {
  const { t } = useTranslation()
  const enabled = useWatch({ control: form.control, name: 'customCliEnabled' })
  const executable = useWatch({ control: form.control, name: 'customCliExecutable' })
  const argsText = useWatch({ control: form.control, name: 'customCliArgsText' })

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <FormLabel className="font-medium">{t('library.config.agent.field.custom_cli.toggle_label')}</FormLabel>
        <Switch
          checked={enabled ?? false}
          onCheckedChange={(checked) => form.setValue('customCliEnabled', checked, { shouldDirty: true })}
          aria-label={t('library.config.agent.field.custom_cli.toggle_label')}
        />
      </div>
      {enabled ? (
        <AgentCustomCliSection
          executable={executable ?? ''}
          argsText={argsText ?? ''}
          onExecutableChange={(value) => form.setValue('customCliExecutable', value, { shouldDirty: true })}
          onArgsTextChange={(value) => form.setValue('customCliArgsText', value, { shouldDirty: true })}
        />
      ) : null}
    </div>
  )
}
